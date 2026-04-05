// ============================================================
// WORKER AGENT RUNTIME: Executes remote subtasks on this peer
// Runs local model loop, calls remote tools via messageBus
// ============================================================

import type { ModelProvider } from '@/core/interfaces/IModelProvider'
import type { Subtask } from '@/core/tasks/taskTypes'
import { buildWorkerMessages } from './workerPrompting'
import { messageBus } from '@/core/network/messageBus'
import { peerNetworkManager } from '@/core/network/PeerNetworkManager'
import { peerStateStore } from '@/core/peers/PeerStateStore'
import { createMessage } from '@/core/network/protocol'
import type {
  TaskProgressPayload,
  TaskResultPayload,
  TaskCancelPayload,
  LeaseRenewPayload,
  ToolRequestPayload,
  ToolName,
} from '@/core/network/protocol'
import type { ChatMessage } from '@/core/interfaces/IModelProvider'

const MAX_ITERATIONS = 15
const PROGRESS_INTERVAL_MS = 6_000

export interface WorkerResult {
  success: boolean
  resultSummary: string
  filesWritten: string[]
}

export class WorkerAgentRuntime {
  private progressTimer: ReturnType<typeof setInterval> | null = null
  private stopped = false

  constructor(
    private workerId: string,
    private initiatorId: string,
    private model: ModelProvider,
    private isLocal = false,
  ) {}

  async execute(subtask: Subtask): Promise<WorkerResult> {
    if (!this.isLocal) {
      peerStateStore.setLocalState('busy_remote')
    }

    this._startProgressTimer(subtask)

    const history: ChatMessage[] = buildWorkerMessages(subtask, this.initiatorId)
    const filesWritten: string[] = []

    try {
      for (let i = 0; i < MAX_ITERATIONS; i++) {
        if (this.stopped) break

        const raw = await this.model.generate(history, { maxTokens: 2000, temperature: 0.2 })
        history.push({ role: 'assistant', content: raw })

        const parsed = this._parseResponse(raw)
        if (!parsed) {
          history.push({ role: 'user', content: 'Invalid response format. Please respond with valid JSON.' })
          continue
        }

        if (parsed.status === 'done') {
          this._stopProgressTimer()
          if (!this.isLocal) peerStateStore.setLocalState('idle')
          this._sendResult(subtask, true, parsed.summary ?? 'Completed', parsed.filesWritten ?? filesWritten)
          return {
            success: true,
            resultSummary: parsed.summary ?? 'Completed',
            filesWritten: parsed.filesWritten ?? filesWritten,
          }
        }

        if (parsed.status === 'failed') {
          this._stopProgressTimer()
          if (!this.isLocal) peerStateStore.setLocalState('idle')
          this._sendResult(subtask, false, parsed.reason ?? 'Failed', filesWritten)
          return { success: false, resultSummary: parsed.reason ?? 'Failed', filesWritten }
        }

        if (parsed.status === 'continue' && parsed.action) {
          try {
            const toolResult = await this._callTool(
              subtask,
              parsed.action.tool as ToolName,
              parsed.action.input ?? {},
            )
            if (parsed.action.tool === 'writeFile') {
              const path = (parsed.action.input as Record<string, string>)?.path
              if (path && !filesWritten.includes(path)) filesWritten.push(path)
            }
            history.push({ role: 'user', content: `Tool result: ${JSON.stringify(toolResult).slice(0, 1000)}` })
          } catch (err) {
            history.push({ role: 'user', content: `Tool error: ${err instanceof Error ? err.message : String(err)}` })
          }
        }
      }

      // Max iterations reached
      this._stopProgressTimer()
      if (!this.isLocal) peerStateStore.setLocalState('idle')
      return { success: false, resultSummary: 'Max iterations reached', filesWritten }
    } catch (err) {
      this._stopProgressTimer()
      if (!this.isLocal) peerStateStore.setLocalState('idle')
      const msg = err instanceof Error ? err.message : String(err)
      this._sendCancel(subtask, msg)
      return { success: false, resultSummary: msg, filesWritten }
    }
  }

  stop(): void {
    this.stopped = true
    this._stopProgressTimer()
    this.model.abort()
  }

  // ── Tool execution ─────────────────────────────────────

  private async _callTool(subtask: Subtask, tool: ToolName, args: Record<string, unknown>): Promise<unknown> {
    if (!subtask.allowedTools.includes(tool)) {
      throw new Error(`Tool "${tool}" is not allowed for this subtask`)
    }

    if (this.isLocal) {
      // Local execution — direct tool call
      const { toolExecutor } = await import('@/core/tools/toolExecutor')
      return toolExecutor.execute(tool, args, subtask.id)
    } else {
      // Remote execution — route through initiator's RemoteToolBridge
      const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const requestPayload: ToolRequestPayload = {
        requestId,
        taskId: subtask.rootTaskId,
        subtaskId: subtask.id,
        workerPeerId: this.workerId,
        tool,
        args,
        issuedAt: Date.now(),
      }
      const msg = createMessage('tool/request', this.workerId, requestPayload, this.initiatorId)

      return messageBus.request(
        requestId,
        () => peerNetworkManager.sendToPeer(this.initiatorId, msg),
        12_000,
      )
    }
  }

  // ── Progress / Lease ───────────────────────────────────

  private _startProgressTimer(subtask: Subtask): void {
    let iteration = 0
    this.progressTimer = setInterval(() => {
      iteration++
      const progress = Math.min(90, iteration * 10)

      if (!this.isLocal) {
        // Send progress to coordinator
        const progressMsg = createMessage<TaskProgressPayload>('task/progress', this.workerId, {
          subtaskId: subtask.id,
          leaseId: subtask.leaseId ?? '',
          progress,
          statusText: `Working... (${iteration * 6}s)`,
        }, this.initiatorId)
        peerNetworkManager.sendToPeer(this.initiatorId, progressMsg)

        // Renew lease
        if (subtask.leaseId) {
          const renewMsg = createMessage<LeaseRenewPayload>('lease/renew', this.workerId, {
            subtaskId: subtask.id,
            leaseId: subtask.leaseId,
            extendByMs: 25_000,
          }, this.initiatorId)
          peerNetworkManager.sendToPeer(this.initiatorId, renewMsg)
        }
      }
    }, PROGRESS_INTERVAL_MS)
  }

  private _stopProgressTimer(): void {
    if (this.progressTimer) {
      clearInterval(this.progressTimer)
      this.progressTimer = null
    }
  }

  // ── Message senders (remote only) ─────────────────────

  private _sendResult(subtask: Subtask, success: boolean, summary: string, filesWritten: string[]): void {
    if (this.isLocal) return
    const msg = createMessage<TaskResultPayload>('task/result', this.workerId, {
      subtaskId: subtask.id,
      leaseId: subtask.leaseId ?? '',
      success,
      resultSummary: summary,
      filesWritten,
    }, this.initiatorId)
    peerNetworkManager.sendToPeer(this.initiatorId, msg)
  }

  private _sendCancel(subtask: Subtask, reason: string): void {
    if (this.isLocal) return
    const msg = createMessage<TaskCancelPayload>('task/cancel', this.workerId, {
      subtaskId: subtask.id,
      leaseId: subtask.leaseId ?? '',
      reason,
    }, this.initiatorId)
    peerNetworkManager.sendToPeer(this.initiatorId, msg)
  }

  // ── Response parsing ───────────────────────────────────

  private _parseResponse(raw: string): {
    status: string
    action?: { tool: string; input?: Record<string, unknown> }
    summary?: string
    reason?: string
    filesWritten?: string[]
  } | null {
    try {
      const match = raw.match(/```json\s*([\s\S]*?)\s*```/) || raw.match(/(\{[\s\S]*\})/)
      const jsonStr = match ? match[1] : raw.trim()
      return JSON.parse(jsonStr)
    } catch {
      return null
    }
  }
}
