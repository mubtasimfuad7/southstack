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

    // Get file tree context for planner
    const tree = await fileSystemService.getTree()
    const treeContext = JSON.stringify(tree, null, 2).slice(0, 1500)

    // Plan
    const subtasks = await this.planner.plan(
      this.rootTask.prompt,
      treeContext,
      this.rootTask.id,
      this.localPeerId,
    )
    subtasks.forEach((s) => this.subtasks.set(s.id, s))
    this._updateRootTask({ status: 'running', subtaskIds: subtasks.map((s) => s.id) })
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
    this._updateRootTask({ status: 'cancelled' })
    this.subtasks.forEach((s) => {
      if (s.status !== 'completed') {
        this._updateSubtask(s.id, { status: 'cancelled' })
        leaseManager.releaseLease(s.id)
        fileLocks.releaseBySubtask(s.id)
      }
    })
    this._cleanup()
  }

  // ── Event subscriptions ────────────────────────────────

  private _subscribe(): void {
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
        this._updateSubtask(msg.payload.subtaskId, {
          progress: msg.payload.progress,
          statusText: msg.payload.statusText,
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

    if (accepted && byPeerId === this.localPeerId) {
      // Self-assign: run locally
      this._updateSubtask(subtaskId, { status: 'in_progress', assignedPeerId: this.localPeerId })
      this._emit()
      this._runLocally(subtaskId)
    } else if (!accepted) {
      // All peers rejected — fallback to self
      this._updateSubtask(subtaskId, { status: 'in_progress', assignedPeerId: this.localPeerId })
      this._emit()
      this._runLocally(subtaskId)
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
      this._updateSubtask(subtaskId, {
        status: result.success ? 'completed' : 'failed',
        resultSummary: result.resultSummary,
        filesWritten: result.filesWritten,
        progress: result.success ? 100 : undefined,
      })
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
      this._updateSubtask(subtaskId, { status: 'failed' })
    }
  }

  private _scheduleTick(): void {
    this.scheduler.tick(this.rootTask, this.subtasks, this._onOfferResult)
  }

  private _checkCompletion(): void {
    const all = [...this.subtasks.values()]
    const done = all.every((s) => s.status === 'completed' || s.status === 'cancelled')
    const anyFailed = all.some((s) => s.status === 'failed')

    if (done) {
      this._updateRootTask({ status: anyFailed ? 'failed' : 'verifying' })
      peerStateStore.setLocalState('idle')
      if (!anyFailed) this._runVerification()
    }
  }

  private async _runVerification(): Promise<void> {
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
  }
}
