// ============================================================
// WORKER OFFER HANDLER: Listens for task/offer, accept/reject
// Also cancels remote work cleanly when local task starts
// ============================================================

import { messageBus } from '@/core/network/messageBus'
import { peerNetworkManager } from '@/core/network/PeerNetworkManager'
import { peerStateStore } from '@/core/peers/PeerStateStore'
import { createMessage } from '@/core/network/protocol'
import type { TaskOfferPayload, TaskAcceptPayload, TaskRejectPayload } from '@/core/network/protocol'
import type { Subtask } from '@/core/tasks/taskTypes'
import { WorkerAgentRuntime } from './WorkerAgentRuntime'

class WorkerOfferHandler {
  private activeRuntime: WorkerAgentRuntime | null = null
  private activeSubtask: Subtask | null = null
  private getModel: (() => import('@/core/interfaces/IModelProvider').ModelProvider | null) = () => null
  private unsub: (() => void) | null = null

  init(getModel: () => import('@/core/interfaces/IModelProvider').ModelProvider | null): void {
    this.getModel = getModel
    this.unsub = messageBus.on<TaskOfferPayload>('task/offer', async (msg) => {
      const offer = msg.payload
      const localPeerId = peerNetworkManager.getLocalPeerId()

      // Only accept if directed to us
      if (msg.toPeerId && msg.toPeerId !== localPeerId) {
        console.debug(`[WorkerOfferHandler] Ignoring offer not directed to us: ${msg.toPeerId}`)
        return
      }

      console.log(`[WorkerOfferHandler] Received task/offer: ${offer.subtaskId} (${offer.title})`)

      const state = peerStateStore.getLocalState()
      if (state !== 'idle' || !peerStateStore.getAcceptsRemoteTasks()) {
        console.log(`[WorkerOfferHandler] Rejecting: state=${state}, acceptsRemote=${peerStateStore.getAcceptsRemoteTasks()}`)
        const reject = createMessage<TaskRejectPayload>('task/reject', localPeerId, {
          subtaskId: offer.subtaskId,
          reason: `Peer not available: state=${state}`,
        }, msg.fromPeerId)
        peerNetworkManager.sendToPeer(msg.fromPeerId, reject)
        return
      }

      const model = this.getModel()
      if (!model || !model.isReady()) {
        console.log(`[WorkerOfferHandler] Rejecting: model not ready`)
        const reject = createMessage<TaskRejectPayload>('task/reject', localPeerId, {
          subtaskId: offer.subtaskId,
          reason: 'Model not ready',
        }, msg.fromPeerId)
        peerNetworkManager.sendToPeer(msg.fromPeerId, reject)
        return
      }

      // Accept
      console.log(`[WorkerOfferHandler] ACCEPTING task: ${offer.subtaskId}`)
      const accept = createMessage<TaskAcceptPayload>('task/accept', localPeerId, {
        subtaskId: offer.subtaskId,
        leaseId: offer.leaseId,
      }, msg.fromPeerId)
      const sent = peerNetworkManager.sendToPeer(msg.fromPeerId, accept)
      console.log(`[WorkerOfferHandler] Sent task/accept, success=${sent}`)

      // Build subtask object from offer
      const subtask: Subtask = {
        id: offer.subtaskId,
        rootTaskId: offer.rootTaskId,
        initiatorPeerId: offer.initiatorPeerId,
        assignedPeerId: localPeerId,
        title: offer.title,
        description: offer.description,
        expectedOutput: offer.expectedOutput,
        targetPaths: offer.targetPaths,
        allowedTools: offer.allowedTools,
        dependencies: offer.dependencies,
        lockedFiles: offer.lockedFiles,
        leaseId: offer.leaseId,
        leaseExpiresAt: offer.leaseExpiresAt,
        status: 'in_progress',
        retryCount: 0,
        maxRetries: offer.maxRetries,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      this.activeSubtask = subtask

      // Update UI store
      import('@/application/store').then(({ useP2PTaskStore }) => {
        useP2PTaskStore.getState().setRemoteSubtask(subtask)
      }).catch(() => {})

      const runtime = new WorkerAgentRuntime(localPeerId, msg.fromPeerId, model, false)
      this.activeRuntime = runtime

      await runtime.execute(subtask)

      this.activeRuntime = null
      this.activeSubtask = null
      import('@/application/store').then(({ useP2PTaskStore }) => {
        useP2PTaskStore.getState().clearRemoteSubtask()
      }).catch(() => {})
    })
  }

  /** Called when user starts their own task — cleanly relinquish remote work */
  relinquishRemoteWork(): void {
    if (this.activeRuntime && this.activeSubtask) {
      this.activeRuntime.stop()
      // cancel message is sent by the runtime itself
    }
  }

  getActiveSubtask(): Subtask | null { return this.activeSubtask }

  dispose(): void {
    this.unsub?.()
    this.activeRuntime?.stop()
  }
}

export const workerOfferHandler = new WorkerOfferHandler()
