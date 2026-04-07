// ============================================================
// MESSAGE BUS: Typed pub/sub over WebRTC data channels
// Handles deduplication, correlation IDs for request/response
// ============================================================

import type { MessageType, P2PMessage } from '@/core/network/protocol'

type MessageHandler<T = unknown> = (msg: P2PMessage<T>) => void
type Unsubscribe = () => void

const DEDUP_TTL_MS = 30_000

interface PendingRequest {
  resolve: (payload: unknown) => void
  reject: (err: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
}

class MessageBus {
  private handlers = new Map<MessageType, Set<MessageHandler>>()
  private seenIds = new Map<string, number>()   // id → timestamp
  private pendingRequests = new Map<string, PendingRequest>()  // correlationId → waiting

  // ── Subscribe ──────────────────────────────────────────

  on<T = unknown>(type: MessageType, handler: MessageHandler<T>): Unsubscribe {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set())
    }
    const set = this.handlers.get(type)!
    set.add(handler as MessageHandler)
    return () => set.delete(handler as MessageHandler)
  }

  // ── Route incoming messages ────────────────────────────

  receive(msg: P2PMessage): void {
    // Deduplication
    const now = Date.now()
    if (this.seenIds.has(msg.id)) return
    this.seenIds.set(msg.id, now)
    this._cleanupDedup(now)

    // Correlation: resolve a pending request
    if (msg.type === 'tool/response' || msg.type === 'tool/error') {
      const payload = msg.payload as { requestId?: string }
      if (payload?.requestId) {
        const pending = this.pendingRequests.get(payload.requestId)
        if (pending) {
          clearTimeout(pending.timeoutId)
          this.pendingRequests.delete(payload.requestId)
          if (msg.type === 'tool/error') {
            const errPayload = msg.payload as { requestId: string; error: string }
            console.warn(`[MessageBus] Tool error for ${payload.requestId}:`, errPayload.error)
            pending.reject(new Error(errPayload.error))
          } else {
            const resPayload = msg.payload as { requestId: string; result: unknown }
            console.debug(`[MessageBus] Tool response arrived for ${payload.requestId}`)
            pending.resolve(resPayload.result)
          }
          return
        } else {
          console.warn(`[MessageBus] Received tool response for unknown request: ${payload.requestId}`)
        }
      }
    }

    // Fan-out to type handlers
    const handlers = this.handlers.get(msg.type)
    if (handlers) {
      handlers.forEach((h) => {
        try { h(msg) } catch (e) { console.error('[MessageBus] handler error', e) }
      })
    }
  }

  // ── Request / Response correlation ────────────────────

  /**
   * Sends a tool/request and waits for the correlated tool/response.
   * The send function is provided by the caller (to avoid circular imports).
   */
  request<T>(
    correlationId: string,
    sendFn: () => void,
    timeoutMs = 12_000,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(correlationId)
        reject(new Error(`Tool request ${correlationId} timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      this.pendingRequests.set(correlationId, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timeoutId,
      })
      sendFn()
    })
  }

  // ── Internal ───────────────────────────────────────────

  private _cleanupDedup(now: number): void {
    // Only clean periodically (every ~100 messages)
    if (this.seenIds.size % 100 !== 0) return
    for (const [id, ts] of this.seenIds) {
      if (now - ts > DEDUP_TTL_MS) this.seenIds.delete(id)
    }
  }
}

export const messageBus = new MessageBus()
