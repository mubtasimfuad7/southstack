// ============================================================
// REMOTE TOOL BRIDGE: Routes worker tool calls ↔ coordinator
// Coordinator: listens for tool/request, executes, replies
// Worker: sends tool/request, awaits tool/response via messageBus
// ============================================================

import { messageBus } from '@/core/network/messageBus'
import { peerNetworkManager } from '@/core/network/PeerNetworkManager'
import { toolExecutor } from './toolExecutor'
import { createMessage } from '@/core/network/protocol'
import type { ToolRequestPayload, ToolResponsePayload, ToolErrorPayload } from '@/core/network/protocol'

class RemoteToolBridge {
  private unsub: (() => void) | null = null

  // ── Coordinator side: register listener ───────────────

  startHosting(localPeerId: string): void {
    if (this.unsub) return  // already hosting

    this.unsub = messageBus.on<ToolRequestPayload>('tool/request', async (msg) => {
      // Only handle requests directed to us
      if (msg.toPeerId && msg.toPeerId !== localPeerId) return

      const { requestId, tool, args, subtaskId, workerPeerId } = msg.payload

      try {
        const result = await toolExecutor.execute(
          tool,
          args as Record<string, unknown>,
          subtaskId,
        )
        const response = createMessage<ToolResponsePayload>(
          'tool/response',
          localPeerId,
          { requestId, result },
          workerPeerId,
        )
        peerNetworkManager.sendToPeer(workerPeerId, response)
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        const errMsg = createMessage<ToolErrorPayload>(
          'tool/error',
          localPeerId,
          { requestId, error },
          workerPeerId,
        )
        peerNetworkManager.sendToPeer(workerPeerId, errMsg)
      }
    })
  }

  stopHosting(): void {
    this.unsub?.()
    this.unsub = null
  }
}

export const remoteToolBridge = new RemoteToolBridge()
