// ============================================================
// SCHEDULER: Worker selection + dependency-gated dispatch
// tick() is called on every subtask/peer state change.
// Only dispatches subtasks whose ALL dependencies are 'completed'.
// ============================================================

import { getRankedWorkers } from '@/core/peers/peerSelectors'
import { peerNetworkManager } from '@/core/network/PeerNetworkManager'
import { leaseManager } from './leaseManager'
import { createMessage } from '@/core/network/protocol'
import type { TaskOfferPayload } from '@/core/network/protocol'
import type { Subtask, RootTask } from './taskTypes'
import { getDispatchableSubtasks } from './taskTypes'

const OFFER_TIMEOUT_MS = 8_000

type SubtaskMap = Map<string, Subtask>
type OfferResultCallback = (subtaskId: string, accepted: boolean, byPeerId: string | null) => void

export class Scheduler {
  private localPeerId: string
  private pendingOffers = new Map<string, ReturnType<typeof setTimeout>>()  // subtaskId → timeout
  private retryTab: Map<string, ReturnType<typeof setInterval>> = new Map()  // subtaskId → retry interval
  private readonly RETRY_INTERVAL_MS = 5_000  // Re-check every 5 seconds if no workers available

  constructor(localPeerId: string) {
    this.localPeerId = localPeerId
  }

  // ── Main dispatch tick ─────────────────────────────────
  // Called whenever subtask state or peer state changes

  tick(
    rootTask: RootTask,
    subtasks: SubtaskMap,
    onOfferResult: OfferResultCallback,
  ): void {
    const dispatchable = getDispatchableSubtasks(subtasks)
    console.debug(`[Scheduler] Tick: ${dispatchable.length} dispatchable subtasks`);

    for (const subtask of dispatchable) {
      if (this.pendingOffers.has(subtask.id)) continue  // already offered

      this._dispatchSubtask(subtask, subtasks, onOfferResult)
    }
  }

  // ── Dispatch one subtask ───────────────────────────────

  private _dispatchSubtask(
    subtask: Subtask,
    _subtasks: SubtaskMap,
    onOfferResult: OfferResultCallback,
  ): void {
    const workers = getRankedWorkers()
    console.debug(`[Scheduler] Dispatching "${subtask.title}": ${workers.length} eligible workers found`);

    if (workers.length === 0) {
      // No remote workers available — set up retry polling
      console.debug(`[Scheduler] No workers for "${subtask.title}", enabling retry polling`);
      if (!this.retryTab.has(subtask.id)) {
        const interval = setInterval(() => {
          const availableNow = getRankedWorkers()
          if (availableNow.length > 0) {
            console.debug(`[Scheduler] Workers available for "${subtask.title}", stopping retry polling`);
            clearInterval(interval)
            this.retryTab.delete(subtask.id)
          }
        }, this.RETRY_INTERVAL_MS)
        this.retryTab.set(subtask.id, interval)
      }
      
      // Assign to self for now (will retry if workers appear later)
      onOfferResult(subtask.id, true, this.localPeerId)
      return
    }

    const worker = workers[0]
    const lease = leaseManager.createLease(subtask.id, worker.peerId)

    const offer = createMessage<TaskOfferPayload>(
      'task/offer',
      this.localPeerId,
      {
        subtaskId: subtask.id,
        rootTaskId: subtask.rootTaskId,
        initiatorPeerId: this.localPeerId,
        title: subtask.title,
        description: subtask.description,
        expectedOutput: subtask.expectedOutput,
        targetPaths: subtask.targetPaths,
        allowedTools: subtask.allowedTools,
        dependencies: subtask.dependencies,
        lockedFiles: subtask.lockedFiles,
        leaseId: lease.leaseId,
        leaseExpiresAt: lease.expiresAt,
        maxRetries: subtask.maxRetries,
      },
      worker.peerId,
    )

    const sent = peerNetworkManager.sendToPeer(worker.peerId, offer)
    if (!sent) {
      // Peer channel not open — assign to self
      leaseManager.releaseLease(subtask.id)
      onOfferResult(subtask.id, true, this.localPeerId)
      return
    }

    // Mark as pending + set timeout fallback
    const timeout = setTimeout(() => {
      this.pendingOffers.delete(subtask.id)
      leaseManager.releaseLease(subtask.id)
      // Try self as fallback
      onOfferResult(subtask.id, true, this.localPeerId)
    }, OFFER_TIMEOUT_MS)

    this.pendingOffers.set(subtask.id, timeout)
  }

  // ── Called when task/accept or task/reject arrives ─────

  handleOfferResponse(
    subtaskId: string,
    accepted: boolean,
    fromPeerId: string,
    onOfferResult: OfferResultCallback,
  ): void {
    const timeout = this.pendingOffers.get(subtaskId)
    if (timeout) {
      clearTimeout(timeout)
      this.pendingOffers.delete(subtaskId)
    }

    // Clear retry polling if accepted by remote
    if (accepted && fromPeerId !== this.localPeerId) {
      const retry = this.retryTab.get(subtaskId)
      if (retry) {
        clearInterval(retry)
        this.retryTab.delete(subtaskId)
      }
    }

    if (!accepted) {
      leaseManager.releaseLease(subtaskId)
    }

    onOfferResult(subtaskId, accepted, fromPeerId)
  }

  cancelPending(subtaskId: string): void {
    const timeout = this.pendingOffers.get(subtaskId)
    if (timeout) {
      clearTimeout(timeout)
      this.pendingOffers.delete(subtaskId)
    }
    
    const retry = this.retryTab.get(subtaskId)
    if (retry) {
      clearInterval(retry)
      this.retryTab.delete(subtaskId)
    }
  }

  destroy(): void {
    this.retryTab.forEach(interval => clearInterval(interval))
    this.retryTab.clear()
  }
}
