// ============================================================
// EXECUTION: ToolExecutor
// Sandboxed tool execution layer. All tools run here.
// Remote peers (providers) CANNOT call this directly.
// Only authorized /tool-rpc/1.0.0 requests from the requester
// peer itself are processed.
// ============================================================

import type { Libp2p } from '@libp2p/interface'
import type { AgentTool } from '@/core/interfaces/IAgentService'
import type { ToolRPCRequest, ToolRPCResponse, PeerIdStr } from '@/infrastructure/p2p/types'
import type { PeerRegistry } from '@/infrastructure/p2p/PeerRegistry'
import { StreamReader, StreamWriter } from '@/infrastructure/p2p/StreamManager'

export const TOOL_RPC_PROTOCOL = '/tool-rpc/1.0.0'

// ──────────────────────────────────────────────────────────
// Input validation schemas (basic structural validation)
// ──────────────────────────────────────────────────────────

const ALLOWED_TOOLS = new Set([
  'write_file',
  'patch_file',
  'read_file',
  'list_dir',
  'run_command',
  'search_files',
])

function validateInput(toolName: string, input: Record<string, unknown>): void {
  if (!ALLOWED_TOOLS.has(toolName)) {
    throw new Error(`Tool "${toolName}" is not in the allowed tool list`)
  }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Tool input must be a plain object')
  }
  // Prevent path traversal
  const pathVal = input['path'] as string | undefined
  if (pathVal && (pathVal.includes('../') || pathVal.startsWith('/'))) {
    throw new Error(`Path traversal attempt detected: "${pathVal}"`)
  }
  // Prevent dangerous shell commands
  if (toolName === 'run_command' && typeof input['command'] === 'string') {
    const cmd = input['command'] as string
    const DANGEROUS = ['rm -rf', 'mkfs', 'dd if=', ':(){', 'wget', 'curl']
    for (const d of DANGEROUS) {
      if (cmd.includes(d)) throw new Error(`Dangerous command blocked: "${cmd}"`)
    }
  }
}

// ──────────────────────────────────────────────────────────
// Rate limiter (global, not per-peer, for tool execution)
// ──────────────────────────────────────────────────────────

class ToolRateLimiter {
  private counts = new Map<string, { window: number; count: number }>()
  allow(toolName: string, windowMs = 10_000, max = 20): boolean {
    const now = Date.now()
    const entry = this.counts.get(toolName)
    if (!entry || now - entry.window > windowMs) {
      this.counts.set(toolName, { window: now, count: 1 })
      return true
    }
    if (entry.count >= max) return false
    entry.count++
    return true
  }
}

const rateLimiter = new ToolRateLimiter()

// ──────────────────────────────────────────────────────────
// ToolExecutor
// ──────────────────────────────────────────────────────────

export class ToolExecutor {
  private tools = new Map<string, AgentTool>()

  constructor(
    private node: Libp2p,
    private registry: PeerRegistry,
    private selfPeerId: PeerIdStr
  ) {}

  // ──────────────────────────────────────────────────────────
  // Tool registration
  // ──────────────────────────────────────────────────────────

  registerTool(tool: AgentTool): void {
    this.tools.set(tool.name, tool)
  }

  // ──────────────────────────────────────────────────────────
  // Direct local execution (for AgentController on requester)
  // ──────────────────────────────────────────────────────────

  async executeTool(
    toolName: string,
    input: Record<string, unknown>,
    timeoutMs = 30_000
  ): Promise<unknown> {
    // Validate before executing
    validateInput(toolName, input)

    if (!rateLimiter.allow(toolName)) {
      throw new Error(`Rate limit exceeded for tool "${toolName}"`)
    }

    const tool = this.tools.get(toolName)
    if (!tool) throw new Error(`Tool "${toolName}" not registered`)

    // Execute with timeout
    return Promise.race([
      tool.execute(input),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Tool "${toolName}" timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ])
  }

  // ──────────────────────────────────────────────────────────
  // RPC handler: serve tool calls from the SAME machine only
  // (provider peers must NOT be able to trigger this)
  // ──────────────────────────────────────────────────────────

  startRPCServer(): void {
    this.node.handle(TOOL_RPC_PROTOCOL, async (stream, connection) => {
      const remotePeerId = connection.remotePeer.toString()

      // CRITICAL: Only allow tool RPC from the local requester's perspective.
      // In our architecture, providers do NOT call tool-rpc — requester does.
      // If for any reason a remote peer calls this, reject.
      if (remotePeerId !== this.selfPeerId) {
        console.warn(`[ToolExecutor] Remote peer ${remotePeerId} attempted tool RPC — REJECTED`)
        stream.abort(new Error('Tool RPC is only allowed from the local requester'))
        return
      }

      const reader = new StreamReader<ToolRPCRequest>(stream)
      const writer = new StreamWriter<ToolRPCResponse>(stream)

      for await (const req of reader) {
        if (!req || req.type !== 'tool_rpc_request') {
          await writer.write({
            type: 'tool_rpc_response',
            requestId: req?.requestId ?? '',
            error: 'Malformed RPC request',
          })
          continue
        }

        let response: ToolRPCResponse
        try {
          const result = await this.executeTool(req.toolName, req.input)
          response = { type: 'tool_rpc_response', requestId: req.requestId, result }
        } catch (err) {
          response = {
            type: 'tool_rpc_response',
            requestId: req.requestId,
            error: (err as Error).message,
          }
        }
        await writer.write(response)
      }

      writer.close()
    })
  }

  stopRPCServer(): Promise<void> {
    return this.node.unhandle(TOOL_RPC_PROTOCOL)
  }
}
