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

        console.log(`[WorkerRuntime] Iteration ${i + 1}/${MAX_ITERATIONS}, subtask=${subtask.id}`)
        const raw = await this.model.generate(history, { maxTokens: 2000, temperature: 0.2 })
        console.log(`[WorkerRuntime] Model response (first 500 chars):`, raw.slice(0, 500))
        history.push({ role: 'assistant', content: raw })

        const parsed = this._parseResponse(raw)
        if (!parsed) {
          console.warn(`[WorkerRuntime] Failed to parse model response. Raw: ${raw.slice(0, 300)}`)
          history.push({ role: 'user', content: 'Invalid response format. Please respond with valid JSON.' })
          continue
        }

        console.log(`[WorkerRuntime] Parsed response:`, parsed)

        // Send worker thinking update to orchestrator (for remote peers and local UI)
        this._sendThinkingUpdate(subtask, i + 1, raw.slice(0, 500), parsed.action)

        // CRITICAL: Process any action first, even if status is 'done'
        // This handles cases where model includes both action and done status
        if (parsed.action) {
          console.log(`[WorkerRuntime] Calling tool: ${parsed.action.tool}`, parsed.action.input)
          try {
            const toolResult = await this._callTool(
              subtask,
              parsed.action.tool as ToolName,
              parsed.action.input ?? {},
            )
            console.log(`[WorkerRuntime] Tool ${parsed.action.tool} result:`, toolResult)
            if (parsed.action.tool === 'writeFile') {
              const path = (parsed.action.input as Record<string, string>)?.path
              console.log(`[WorkerRuntime] writeFile completed for: ${path}`)
              if (path && !filesWritten.includes(path)) filesWritten.push(path)
            }
            history.push({ role: 'user', content: `Tool result: ${JSON.stringify(toolResult).slice(0, 1000)}` })
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err)
            console.error(`[WorkerRuntime] Tool error for ${parsed.action.tool}:`, errMsg)
            history.push({ role: 'user', content: `Tool error: ${errMsg}` })
          }
        }

        // Now check terminal states AFTER processing any actions
        if (parsed.status === 'done') {
          // CRITICAL: Validate that actual files were written
          // Don't trust the model's self-reported filesWritten - use actual tool calls
          if (subtask.targetPaths && subtask.targetPaths.length > 0 && filesWritten.length === 0) {
            // Task requires file creation but no tools were actually called
            console.warn(`[WorkerRuntime] Model claimed done but no write tool calls made. Rejecting.`)
            history.push({ 
              role: 'user', 
              content: `Your task requires writing files to ${subtask.targetPaths.join(', ')} but no writeFile tools were called. You must actually use the writeFile tool to create the required files before marking the task as done.` 
            })
            continue
          }

          this._stopProgressTimer()
          if (!this.isLocal) peerStateStore.setLocalState('idle')
          console.log(`[WorkerRuntime] Task DONE. filesWritten=${JSON.stringify(filesWritten)}, summary=${parsed.summary}`)
          this._sendResult(subtask, true, parsed.summary ?? 'Completed', filesWritten)
          return {
            success: true,
            resultSummary: parsed.summary ?? 'Completed',
            filesWritten: filesWritten,
          }
        }

        if (parsed.status === 'failed') {
          this._stopProgressTimer()
          if (!this.isLocal) peerStateStore.setLocalState('idle')
          console.warn(`[WorkerRuntime] Task FAILED. Reason: ${parsed.reason}`)
          this._sendResult(subtask, false, parsed.reason ?? 'Failed', filesWritten)
          return { success: false, resultSummary: parsed.reason ?? 'Failed', filesWritten }
        }

        if (parsed.status === 'continue' && !parsed.action) {
          console.warn(`[WorkerRuntime] Status is 'continue' but no action provided. Response:`, parsed)
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

      const progressMsg = createMessage<TaskProgressPayload>('task/progress', this.workerId, {
        subtaskId: subtask.id,
        leaseId: subtask.leaseId ?? '',
        progress,
        statusText: `Working... (${iteration * 6}s)`,
      }, this.initiatorId)

      if (!this.isLocal) {
        // Send progress to coordinator
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
      } else {
        // Local execution, just dispatch directly to messageBus
        messageBus.receive(progressMsg)
      }
    }, PROGRESS_INTERVAL_MS)
  }

  private _stopProgressTimer(): void {
    if (this.progressTimer) {
      clearInterval(this.progressTimer)
      this.progressTimer = null
    }
  }

  private _sendThinkingUpdate(
    subtask: Subtask,
    iteration: number,
    modelResponse: string,
    action?: { tool: string; input?: Record<string, unknown> }
  ): void {
    const progressMsg = createMessage<TaskProgressPayload>(
      'task/progress',
      this.workerId,
      {
        subtaskId: subtask.id,
        leaseId: subtask.leaseId ?? '',
        progress: Math.min(90, iteration * 15),
        statusText: `Iteration ${iteration}${action ? `: calling ${action.tool}` : ''}`,
        workerThinking: {
          iteration,
          modelResponse,
          toolCall: action ? {
            tool: action.tool,
            input: action.input ?? {},
          } : undefined,
          timeElapsed: Date.now() - (subtask.createdAt ?? 0),
        },
      },
      this.initiatorId
    )
    if (this.isLocal) {
      messageBus.receive(progressMsg)
    } else {
      peerNetworkManager.sendToPeer(this.initiatorId, progressMsg)
    }
  }

  // ── Message senders (remote only) ─────────────────────

  private _sendResult(subtask: Subtask, success: boolean, summary: string, filesWritten: string[]): void {
    if (this.isLocal) return
    console.log(`[WorkerRuntime] Sending task/result to ${this.initiatorId}: success=${success}, filesWritten=${JSON.stringify(filesWritten)}`)
    const msg = createMessage<TaskResultPayload>('task/result', this.workerId, {
      subtaskId: subtask.id,
      leaseId: subtask.leaseId ?? '',
      success,
      resultSummary: summary,
      filesWritten,
    }, this.initiatorId)
    const sent = peerNetworkManager.sendToPeer(this.initiatorId, msg)
    console.log(`[WorkerRuntime] task/result sent=${sent}`)
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
      let jsonStr = ''
      const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/) || 
                        raw.match(/```\s*([\s\S]*?)\s*```/)
      
      if (jsonMatch) {
        jsonStr = jsonMatch[1]
      } else {
        const firstBrace = raw.indexOf('{')
        const lastBrace = raw.lastIndexOf('}')
        if (firstBrace !== -1 && lastBrace !== -1) {
          jsonStr = raw.substring(firstBrace, lastBrace + 1)
        } else {
          jsonStr = raw.trim()
        }
      }
      return JSON.parse(jsonStr)
    } catch {
      return null
    }
  }
}
