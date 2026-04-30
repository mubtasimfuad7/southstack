// ============================================================
// SCHEDULER: Worker selection + dependency-gated dispatch
// tick() is called on every subtask/peer state change.
// Only dispatches subtasks whose ALL dependencies are 'completed'.
// Multi-peer cascade: tries ranked peers in order until one accepts.
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

interface PendingOffer {
  timeout: ReturnType<typeof setTimeout>
  remainingWorkers: string[]   // peer IDs not yet tried
  onOfferResult: OfferResultCallback
  subtask: Subtask
}

export class Scheduler {
  private localPeerId: string
  private pendingOffers = new Map<string, PendingOffer>()
  private retryTab: Map<string, ReturnType<typeof setInterval>> = new Map()
  private readonly RETRY_INTERVAL_MS = 5_000

  constructor(localPeerId: string) {
    this.localPeerId = localPeerId
  }

  // ── Main dispatch tick ─────────────────────────────────

  tick(
    rootTask: RootTask,
    subtasks: SubtaskMap,
    onOfferResult: OfferResultCallback,
  ): void {
    const dispatchable = getDispatchableSubtasks(subtasks)
    console.debug(`[Scheduler] Tick: ${dispatchable.length} dispatchable subtasks`)

    for (const subtask of dispatchable) {
      if (this.pendingOffers.has(subtask.id)) continue  // already in-flight
      this._startOfferCascade(subtask, onOfferResult)
    }
  }

  // ── Cascade: try peers one at a time in ranked order ──

  private _startOfferCascade(subtask: Subtask, onOfferResult: OfferResultCallback): void {
    const workers = getRankedWorkers()
    console.debug(`[Scheduler] Starting cascade for "${subtask.title}": ${workers.length} eligible workers`)

    if (workers.length === 0) {
      // No remote workers — poll and immediately self-assign
      this._startRetryPolling(subtask)
      onOfferResult(subtask.id, true, this.localPeerId)
      return
    }

    const remainingWorkers = workers.map(w => w.peerId)
    this._offerToNext(subtask, remainingWorkers, onOfferResult)
  }

  private _offerToNext(
    subtask: Subtask,
    remainingWorkers: string[],
    onOfferResult: OfferResultCallback,
  ): void {
    // All peers have rejected — fall back to self
    if (remainingWorkers.length === 0) {
      console.debug(`[Scheduler] All peers rejected "${subtask.title}", self-assigning`)
      this.pendingOffers.delete(subtask.id)
      onOfferResult(subtask.id, true, this.localPeerId)
      return
    }

    const [targetPeerId, ...rest] = remainingWorkers
    const lease = leaseManager.createLease(subtask.id, targetPeerId)

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
      targetPeerId,
    )

    const sent = peerNetworkManager.sendToPeer(targetPeerId, offer)
    if (!sent) {
      // Channel not open — skip to next peer immediately
      leaseManager.releaseLease(subtask.id)
      this._offerToNext(subtask, rest, onOfferResult)
      return
    }

    console.debug(`[Scheduler] Offered "${subtask.title}" to peer ${targetPeerId}`)

    // Timeout: if peer doesn't respond, try next one
    const timeout = setTimeout(() => {
      console.debug(`[Scheduler] Offer to ${targetPeerId} timed out for "${subtask.title}", trying next peer`)
      this.pendingOffers.delete(subtask.id)
      leaseManager.releaseLease(subtask.id)
      this._offerToNext(subtask, rest, onOfferResult)
    }, OFFER_TIMEOUT_MS)

    this.pendingOffers.set(subtask.id, {
      timeout,
      remainingWorkers: rest,
      onOfferResult,
      subtask,
    })
  }

  // ── Called when task/accept or task/reject arrives ─────

  handleOfferResponse(
    subtaskId: string,
    accepted: boolean,
    fromPeerId: string,
    onOfferResult: OfferResultCallback,
  ): void {
    const pending = this.pendingOffers.get(subtaskId)
    if (!pending) return

    clearTimeout(pending.timeout)
    this.pendingOffers.delete(subtaskId)

    if (accepted) {
      // Clear retry polling if peer accepted
      const retry = this.retryTab.get(subtaskId)
      if (retry) {
        clearInterval(retry)
        this.retryTab.delete(subtaskId)
      }
      onOfferResult(subtaskId, true, fromPeerId)
    } else {
      // Peer rejected — cascade to next one in the remaining list
      console.debug(`[Scheduler] Peer ${fromPeerId} rejected "${subtaskId}", cascading to next`)
      leaseManager.releaseLease(subtaskId)
      this._offerToNext(pending.subtask, pending.remainingWorkers, pending.onOfferResult)
    }
  }

  cancelPending(subtaskId: string): void {
    const pending = this.pendingOffers.get(subtaskId)
    if (pending) {
      clearTimeout(pending.timeout)
      this.pendingOffers.delete(subtaskId)
    }
    const retry = this.retryTab.get(subtaskId)
    if (retry) {
      clearInterval(retry)
      this.retryTab.delete(subtaskId)
    }
  }

  private _startRetryPolling(subtask: Subtask): void {
    if (this.retryTab.has(subtask.id)) return
    const interval = setInterval(() => {
      const available = getRankedWorkers()
      if (available.length > 0) {
        console.debug(`[Scheduler] Workers now available for "${subtask.title}", stopping retry polling`)
        clearInterval(interval)
        this.retryTab.delete(subtask.id)
      }
    }, this.RETRY_INTERVAL_MS)
    this.retryTab.set(subtask.id, interval)
  }

  destroy(): void {
    this.pendingOffers.forEach(p => clearTimeout(p.timeout))
    this.pendingOffers.clear()
    this.retryTab.forEach(interval => clearInterval(interval))
    this.retryTab.clear()
  }
}
