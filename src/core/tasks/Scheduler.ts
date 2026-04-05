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

    if (workers.length === 0) {
      // No remote workers — assign to self
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
  }
}
