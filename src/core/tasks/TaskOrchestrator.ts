// ============================================================
// TASK ORCHESTRATOR: Coordinator main loop per root task
// Drives: plan → schedule → monitor leases → verify → complete
// ============================================================

import { TaskPlanner } from './TaskPlanner'
import { Scheduler } from './Scheduler'
import { leaseManager } from './leaseManager'
import { messageBus } from '@/core/network/messageBus'
import { peerStateStore } from '@/core/peers/PeerStateStore'
import { peerNetworkManager } from '@/core/network/PeerNetworkManager'
import { remoteToolBridge } from '@/core/tools/RemoteToolBridge'
import { createMessage } from '@/core/network/protocol'
import type {
  TaskAcceptPayload,
  TaskRejectPayload,
  TaskResultPayload,
  TaskCancelPayload,
  TaskProgressPayload,
  LeaseRenewPayload,
  GoodbyePayload,
  StatusPayload,
} from '@/core/network/protocol'
import type { RootTask, Subtask } from './taskTypes'
import type { ModelProvider } from '@/core/interfaces/IModelProvider'
import { fileSystemService } from '@/core/services/FileSystemService'
import { fileLocks } from '@/core/tools/fileLocks'
import { useFSStore } from '@/application/store'

type OrchestratorChangeCallback = (rootTask: RootTask, subtasks: Map<string, Subtask>) => void

export class TaskOrchestrator {
  private rootTask: RootTask
  private subtasks = new Map<string, Subtask>()
  private scheduler: Scheduler
  private planner: TaskPlanner
  private changeCallbacks = new Set<OrchestratorChangeCallback>()
  private unsubs: Array<() => void> = []
  private localPeerId: string

  constructor(rootTask: RootTask, model: ModelProvider) {
    this.rootTask = rootTask
    this.localPeerId = rootTask.ownerPeerId
    this.scheduler = new Scheduler(this.localPeerId)
    this.planner = new TaskPlanner(model)
    this._subscribe()
  }

  // ── Public ─────────────────────────────────────────────

  async start(): Promise<void> {
    this._updateRootTask({ status: 'planning' })
    peerStateStore.setLocalState('busy_self')
    
    // Enable the tool bridge so remote workers can call tools
    remoteToolBridge.startHosting(this.localPeerId)
    console.log('[Orchestrator] Tool bridge enabled for peer', this.localPeerId)

    // Get file tree context for planner
    const tree = await fileSystemService.getTree()
    const treeContext = JSON.stringify(tree, null, 2).slice(0, 1500)

    // Plan with progress callback - accumulate tokens
    const tokenBuffer: string[] = []
    
    const subtasks = await this.planner.plan(
      this.rootTask.prompt,
      treeContext,
      this.rootTask.id,
      this.localPeerId,
      (progress) => {
        console.log('[Orchestrator] Planning progress:', progress)
        tokenBuffer.push(progress.token)
        // Keep last 100 tokens to avoid memory bloat
        const displayTokens = tokenBuffer.slice(-100)
        this._updateRootTask({ 
          metadata: {
            planningProgress: {
              tokenCount: progress.tokenCount,
              elapsed: progress.elapsed,
              status: progress.status,
              tokens: displayTokens
            }
          }
        })
        this._emit()
      }
    )
    subtasks.forEach((s) => this.subtasks.set(s.id, s))
    
    // Preserve final planning progress with completion flag
    const finalProgress = {
      tokenCount: tokenBuffer.length,
      elapsed: Date.now() - (this.rootTask.createdAt),
      status: `Plan complete: ${subtasks.length} subtasks generated`,
      tokens: tokenBuffer.slice(-100),
      finished: true
    }
    
    this._updateRootTask({ 
      status: 'running', 
      subtaskIds: subtasks.map((s) => s.id),
      metadata: {
        planningProgress: finalProgress
      }
    })
    this._emit()

    // Initial scheduling tick
    this._scheduleTick()
  }

  getRootTask(): RootTask { return { ...this.rootTask } }
  getSubtasks(): Map<string, Subtask> { return new Map(this.subtasks) }

  onChange(cb: OrchestratorChangeCallback): () => void {
    this.changeCallbacks.add(cb)
    return () => this.changeCallbacks.delete(cb)
  }

  cancel(): void {
    console.log(`[Orchestrator] Cancelling root task: ${this.rootTask.id}`)
    this._updateRootTask({ status: 'cancelled' })
    
    // Cancel all non-completed subtasks
    for (const [id, s] of this.subtasks.entries()) {
      if (s.status !== 'completed' && s.status !== 'failed') {
        this._updateSubtask(id, { status: 'cancelled' })
        
        // If assigned to a remote peer, notify them
        if (s.assignedPeerId && s.assignedPeerId !== this.localPeerId) {
          const cancelMsg = createMessage<TaskCancelPayload>('task/cancel', this.localPeerId, {
            subtaskId: id,
            leaseId: s.leaseId ?? '',
            reason: 'Root task cancelled by initiator'
          }, s.assignedPeerId)
          peerNetworkManager.sendToPeer(s.assignedPeerId, cancelMsg)
        }
        
        leaseManager.releaseLease(id)
        this.scheduler.cancelPending(id)
      }
    }
    
    fileLocks.releaseBySubtask('*') // Release all locks held by this orchestrator context
    remoteToolBridge.stopHosting()
    peerStateStore.setLocalState('idle')
    this._cleanup()
    this._emit()
  }

  // ── Event subscriptions ────────────────────────────────

  private _subscribe(): void {
    // Subscribe to peer registry changes to reschedule if new workers appear
    this.unsubs.push(
      peerStateStore.onRegistryChange((_peers) => {
        // Check if there are now eligible workers for queued subtasks
        const dispatchable = [...this.subtasks.values()].filter((s) => s.status === 'queued')
        if (dispatchable.length > 0) {
          console.debug('[Orchestrator] Peer registry changed, rescheduling...')
          this._scheduleTick()
        }
      }),
    )

    this.unsubs.push(
      messageBus.on<TaskAcceptPayload>('task/accept', (msg) => {
        if (!this.subtasks.has(msg.payload.subtaskId)) return
        if (!leaseManager.isValidLease(msg.payload.subtaskId, msg.payload.leaseId)) return
        this.scheduler.handleOfferResponse(msg.payload.subtaskId, true, msg.fromPeerId, this._onOfferResult)
        this._updateSubtask(msg.payload.subtaskId, {
          status: 'in_progress',
          assignedPeerId: msg.fromPeerId,
          leaseId: msg.payload.leaseId,
        })
        this._emit()
      }),

      messageBus.on<TaskRejectPayload>('task/reject', (msg) => {
        if (!this.subtasks.has(msg.payload.subtaskId)) return
        this.scheduler.handleOfferResponse(msg.payload.subtaskId, false, msg.fromPeerId, this._onOfferResult)
      }),

      messageBus.on<TaskProgressPayload>('task/progress', (msg) => {
        const s = this.subtasks.get(msg.payload.subtaskId)
        if (!s || s.assignedPeerId !== msg.fromPeerId) return
        
        let newHistory = s.workerThinkingHistory ? [...s.workerThinkingHistory] : []
        if (msg.payload.workerThinking) {
           const existingIndex = newHistory.findIndex(h => h.iteration === msg.payload.workerThinking!.iteration)
           if (existingIndex !== -1) {
             newHistory[existingIndex] = msg.payload.workerThinking
           } else {
             newHistory.push(msg.payload.workerThinking)
           }
        }

        this._updateSubtask(msg.payload.subtaskId, {
          progress: msg.payload.progress,
          statusText: msg.payload.statusText,
          workerThinking: msg.payload.workerThinking,
          workerThinkingHistory: newHistory
        })
        this._emit()
      }),

      messageBus.on<TaskResultPayload>('task/result', (msg) => {
        const s = this.subtasks.get(msg.payload.subtaskId)
        if (!s) return
        if (!leaseManager.isValidLease(msg.payload.subtaskId, msg.payload.leaseId)) {
          console.warn('[Orchestrator] Stale result rejected', msg.payload.subtaskId)
          return
        }
        
        console.log(`[Orchestrator] Task result from ${msg.fromPeerId}: success=${msg.payload.success}, filesWritten=${JSON.stringify(msg.payload.filesWritten)}`)
        
        leaseManager.releaseLease(msg.payload.subtaskId)
        fileLocks.releaseBySubtask(msg.payload.subtaskId)
        peerStateStore.updatePeerReliability(msg.fromPeerId, msg.payload.success)

        if (msg.payload.success) {
          this._updateSubtask(msg.payload.subtaskId, {
            status: 'completed',
            resultSummary: msg.payload.resultSummary,
            filesWritten: msg.payload.filesWritten,
            progress: 100,
          })
        } else {
          this._requeueOrFail(msg.payload.subtaskId)
        }

        this._emit()
        this._scheduleTick()
        this._checkCompletion()
      }),

      messageBus.on<TaskCancelPayload>('task/cancel', (msg) => {
        const s = this.subtasks.get(msg.payload.subtaskId)
        if (!s || s.assignedPeerId !== msg.fromPeerId) return
        leaseManager.releaseLease(msg.payload.subtaskId)
        fileLocks.releaseBySubtask(msg.payload.subtaskId)
        this._requeueOrFail(msg.payload.subtaskId)
        this._emit()
        this._scheduleTick()
      }),

      messageBus.on<LeaseRenewPayload>('lease/renew', (msg) => {
        leaseManager.renewLease(msg.payload.leaseId, msg.payload.extendByMs)
      }),

      messageBus.on<GoodbyePayload>('peer/goodbye', (msg) => {
        this._handlePeerOffline(msg.fromPeerId)
      }),

      messageBus.on<StatusPayload>('peer/status', (msg) => {
        if (msg.payload.state === 'busy_self') {
          this._handlePeerOffline(msg.fromPeerId)
        }
      }),

      leaseManager.onLeaseExpired((subtaskId) => {
        if (!this.subtasks.has(subtaskId)) return
        const s = this.subtasks.get(subtaskId)!
        if (s.status === 'in_progress' || s.status === 'assigned') {
          console.warn('[Orchestrator] Lease expired for', subtaskId)
          fileLocks.releaseBySubtask(subtaskId)
          this._requeueOrFail(subtaskId)
          this._emit()
          this._scheduleTick()
        }
      }),
    )
  }

  // ── Offer result callback ──────────────────────────────

  private _onOfferResult = (subtaskId: string, accepted: boolean, byPeerId: string | null): void => {
    if (!this.subtasks.has(subtaskId)) return

    console.log(`[Orchestrator] _onOfferResult: subtaskId=${subtaskId}, accepted=${accepted}, byPeerId=${byPeerId}, localPeerId=${this.localPeerId}`)

    if (accepted && byPeerId === this.localPeerId) {
      // Self-assign: run locally
      console.log(`[Orchestrator] Running subtask LOCALLY (self-assign)`)
      this._updateSubtask(subtaskId, { status: 'in_progress', assignedPeerId: this.localPeerId })
      this._emit()
      this._runLocally(subtaskId)
    } else if (!accepted && byPeerId === null) {
      console.log(`[Orchestrator] No remote peer is available for ${subtaskId}; keeping it queued`)
      this._updateSubtask(subtaskId, {
        status: 'queued',
        assignedPeerId: undefined,
        leaseId: undefined,
      })
      this._emit()
    } else {
      console.log(`[Orchestrator] Subtask assigned to remote peer: ${byPeerId}`)
    }
  }

  // ── Local execution ────────────────────────────────────

  private async _runLocally(subtaskId: string): Promise<void> {
    const subtask = this.subtasks.get(subtaskId)
    if (!subtask) return

    const { WorkerAgentRuntime } = await import('@/core/worker/WorkerAgentRuntime')
    const { localModelProvider } = await import('@/execution/llm/LocalModelProvider')

    if (!localModelProvider) {
      this._requeueOrFail(subtaskId)
      return
    }

    const runtime = new WorkerAgentRuntime(
      this.localPeerId,
      this.localPeerId,
      localModelProvider,
      true, // isLocal
    )

    try {
      const result = await runtime.execute(subtask)
      leaseManager.releaseLease(subtaskId)
      fileLocks.releaseBySubtask(subtaskId)
      if (result.success) {
        this._updateSubtask(subtaskId, {
          status: 'completed',
          resultSummary: result.resultSummary,
          filesWritten: result.filesWritten,
          progress: 100,
        })
      } else {
        this._updateSubtask(subtaskId, {
          resultSummary: result.resultSummary,
          filesWritten: result.filesWritten,
        })
        this._requeueOrFail(subtaskId)
      }
    } catch (e) {
      this._requeueOrFail(subtaskId)
    }

    this._emit()
    this._scheduleTick()
    this._checkCompletion()
  }

  // ── State helpers ──────────────────────────────────────

  private _handlePeerOffline(peerId: string): void {
    let changed = false
    for (const s of this.subtasks.values()) {
      if (
        s.assignedPeerId === peerId &&
        (s.status === 'in_progress' || s.status === 'assigned' || s.status === 'awaiting_tool_result')
      ) {
        leaseManager.releaseLease(s.id)
        fileLocks.releaseBySubtask(s.id)
        this._requeueOrFail(s.id)
        changed = true
      }
    }
    if (changed) {
      this._emit()
      this._scheduleTick()
    }
  }

  private _requeueOrFail(subtaskId: string): void {
    const s = this.subtasks.get(subtaskId)
    if (!s) return
    if (s.retryCount < s.maxRetries) {
      this._updateSubtask(subtaskId, {
        status: 'requeued',
        retryCount: s.retryCount + 1,
        assignedPeerId: undefined,
        leaseId: undefined,
        progress: undefined,
      })
      // Reset to queued after a brief delay so it re-enters dispatch
      setTimeout(() => {
        const current = this.subtasks.get(subtaskId)
        if (current?.status === 'requeued') {
          this._updateSubtask(subtaskId, { status: 'queued' })
          this._emit()
          this._scheduleTick()
        }
      }, 2_000)
    } else {
      const fixDepth = (s.title.match(/Fix Error/g) || []).length
      if (fixDepth < 2) {
        // OPTION B: Auto-healing. Spawn a new subtask to fix the error.
        const fixSubtaskId = `st-fix-${Date.now()}`
        const newSubtask: Subtask = {
          id: fixSubtaskId,
          rootTaskId: s.rootTaskId,
          initiatorPeerId: s.initiatorPeerId,
          title: `Fix Error in: ${s.title}`,
          description: `The previous subtask "${s.title}" failed with the following error:
${s.resultSummary || 'Unknown error'}

Original Task Description:
${s.description}

Your task is to identify why it failed and fix the issue. Use the available tools to correct the files.`,
          expectedOutput: `The issue preventing "${s.title}" from completing is resolved.`,
          targetPaths: s.targetPaths,
          allowedTools: s.allowedTools,
          dependencies: s.dependencies, // inherit dependencies
          lockedFiles: s.lockedFiles,
          status: 'queued',
          retryCount: 0,
          maxRetries: 2,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
        
        this.subtasks.set(fixSubtaskId, newSubtask)
        
        // Mark the originally failed subtask as cancelled so it doesn't block completion
        this._updateSubtask(subtaskId, { 
          status: 'cancelled', 
          resultSummary: `Failed. Spawned recovery task: ${fixSubtaskId}` 
        })
        
        // Update downstream dependencies to point to the new fix task
        for (const [id, downstream] of this.subtasks.entries()) {
          if (downstream.dependencies.includes(subtaskId)) {
            const newDeps = downstream.dependencies.filter(d => d !== subtaskId)
            newDeps.push(fixSubtaskId)
            this._updateSubtask(id, { dependencies: newDeps })
          }
        }
        
        this._emit()
        this._scheduleTick()
      } else {
        // Max fix depth reached. Really fail.
        this._updateSubtask(subtaskId, { status: 'failed' })
        this._emit()
        this._scheduleTick()
        this._checkCompletion()
      }
    }
  }

  private _scheduleTick(): void {
    this.scheduler.tick(this.rootTask, this.subtasks, this._onOfferResult)
  }

  private _checkCompletion(): void {
    const all = [...this.subtasks.values()]
    const done = all.every((s) => s.status === 'completed' || s.status === 'cancelled' || s.status === 'failed')
    const anyFailed = all.some((s) => s.status === 'failed')

    if (done) {
      this._updateRootTask({ status: anyFailed ? 'failed' : 'verifying' })
      peerStateStore.setLocalState('idle')
      if (!anyFailed) this._runVerification()
    }
  }

  private async _runVerification(): Promise<void> {
    remoteToolBridge.stopHosting()
    
    // Sync written files to local OS filesystem
    try {
      console.log('[Orchestrator] Syncing files to local filesystem after task completion')
      await fileSystemService.syncToLocalFS()
      console.log('[Orchestrator] Files synced successfully')
      
      // Refresh file tree in UI
      try {
        const tree = await fileSystemService.getTree()
        useFSStore.getState().setProjectRoot(tree)
        console.log('[Orchestrator] File explorer refreshed with new files')
      } catch (err) {
        console.warn('[Orchestrator] Failed to refresh file explorer:', err)
      }
    } catch (err) {
      console.warn('[Orchestrator] Failed to sync to local filesystem:', err)
      // Continue with verification even if sync fails
    }

    const { VerificationEngine } = await import('@/core/verify/VerificationEngine')
    const allTargets = [...this.subtasks.values()].flatMap((s) => s.targetPaths)
    const result = await VerificationEngine.verify(allTargets)
    this._updateRootTask({
      status: result.pass ? 'completed' : 'failed',
      verificationResult: result,
    })
    this._emit()
  }

  private _updateRootTask(patch: Partial<RootTask>): void {
    this.rootTask = { ...this.rootTask, ...patch, updatedAt: Date.now() }
  }

  private _updateSubtask(id: string, patch: Partial<Subtask>): void {
    const s = this.subtasks.get(id)
    if (s) this.subtasks.set(id, { ...s, ...patch, updatedAt: Date.now() })
  }

  private _emit(): void {
    this.changeCallbacks.forEach((cb) => cb(this.getRootTask(), this.getSubtasks()))
  }

  private _cleanup(): void {
    this.unsubs.forEach((u) => u())
    this.unsubs = []
    this.scheduler.destroy()
  }
}
