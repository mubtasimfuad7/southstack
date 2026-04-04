import type { P2PNetworkManager } from './P2PNetworkManager'
import { StreamReader, StreamWriter } from './StreamManager'
import {
  P2PEvents,
  type CheckpointData,
  type ChatMessage,
  type InferenceAck,
  type InferenceRequest,
  type P2PEventMap,
  type PeerIdStr,
  type PreemptSignal,
  type StreamCancel,
  type TokenChunk,
} from './types'
import type { TypedEventEmitter } from './EventEmitter'

export const INFERENCE_PROTOCOL = '/ai-inference/1.0.0'
const INFERENCE_ACK_RETRY_DELAYS_MS = [150, 400, 900]

const activeRequests = new Map<string, { cancel: () => void; peerId: string }>()
const checkpoints = new Map<string, CheckpointData>()

let requestCounter = 0

function newRequestId(): string {
  requestCounter += 1
  return `req-${Date.now()}-${requestCounter}`
}

export interface InferenceRequestOptions {
  maxTokens?: number
  temperature?: number
  checkpoint?: CheckpointData
  preferredPeerId?: PeerIdStr | null
  excludePeerIds?: PeerIdStr[]
}

export class ModelRouter {
  constructor(
    private readonly manager: P2PNetworkManager,
    private readonly emitter: TypedEventEmitter<P2PEventMap>,
  ) {}

  async requestInference(
    messages: ChatMessage[],
    modelId: string,
    onToken: (token: string) => void,
    options?: InferenceRequestOptions,
  ): Promise<string> {
    const registry = this.manager.registry
    if (!registry) {
      throw new Error('P2P registry is not ready')
    }

    const excluded = options?.excludePeerIds ?? []
    const preferred = options?.preferredPeerId
    const peerId = preferred && !excluded.includes(preferred)
      ? preferred
      : registry.bestPeer(modelId, excluded)

    if (!peerId) {
      throw new Error('No suitable peer found for inference')
    }

    const requestId = newRequestId()
    const checkpoint = options?.checkpoint ?? {
      requestId,
      messages,
      tokensGenerated: '',
      toolHistory: [],
      stepIndex: 0,
      timestamp: Date.now(),
    }

    checkpoints.set(requestId, checkpoint)

    try {
      return await this.runSingleInference(peerId, requestId, messages, modelId, onToken, checkpoint, options)
    } catch (error) {
      registry.recordRequest(peerId, false)

      const nextPeer = registry.bestPeer(modelId, [...excluded, peerId])
      if (!nextPeer) {
        throw error instanceof Error ? error : new Error(String(error))
      }

      this.emitter.emit(P2PEvents.ERROR, {
        message: `Provider ${peerId} failed, retrying with ${nextPeer}`,
        error,
      })

      return this.requestInference(messages, modelId, onToken, {
        ...options,
        checkpoint: checkpoints.get(requestId) ?? checkpoint,
        excludePeerIds: [...excluded, peerId],
        preferredPeerId: nextPeer,
      })
    } finally {
      activeRequests.delete(requestId)
      checkpoints.delete(requestId)
    }
  }

  cancelRequest(requestId: string, reason = 'User cancelled'): void {
    const active = activeRequests.get(requestId)
    if (!active) return

    active.cancel()
    activeRequests.delete(requestId)

    void this.sendPreempt(active.peerId, {
      type: 'preempt',
      requestId,
      reason,
    })
  }

  registerProviderHandler(
    onInferenceRequest: (
      req: InferenceRequest,
      onToken: (token: string, done: boolean) => Promise<void>,
      signal: AbortSignal,
    ) => Promise<void>,
  ): void {
    this.manager.handle(INFERENCE_PROTOCOL, async (stream, connection) => {
      const remotePeerId = connection.remotePeer.toString()
      const registry = this.manager.registry

      if (!registry) {
        stream.abort(new Error('Unauthorized'))
        return
      }

      if (!registry.isAuthorized(remotePeerId)) {
        const metadata = registry.authorize(remotePeerId, {
          transportReady: true,
          connectedAt: Date.now(),
        })

        this.emitter.emit(P2PEvents.PEER_REGISTRY_UPDATED, {
          peerId: remotePeerId,
          metadata,
        })
      }

      const reader = new StreamReader<InferenceRequest | StreamCancel | PreemptSignal>(stream)
      const writer = new StreamWriter<InferenceAck | TokenChunk | PreemptSignal>(stream)

      const abortController = new AbortController()
      let currentRequest: InferenceRequest | null = null
      let acknowledged = false

      try {
        for await (const message of reader) {
          if (message.type === 'stream_cancel' || message.type === 'preempt') {
            abortController.abort()
            break
          }

          if ((message as any).type === 'inference_request') {
            currentRequest = message as InferenceRequest
          } else {
            console.warn(`[P2P] Unexpected message type in inference stream: ${(message as any).type}`)
            continue
          }

          console.log(`[P2P] Received inference request ${currentRequest.requestId} from ${remotePeerId}`)

          await writer.write({
            type: 'inference_ack',
            requestId: currentRequest.requestId,
            accepted: true,
          })
          acknowledged = true
          console.log(`[P2P] Sent ACK for ${currentRequest.requestId}`)

          this.emitter.emit(P2PEvents.INFERENCE_REQUEST, currentRequest)

          console.log(`[P2P] Starting inference for ${currentRequest.requestId}`)
          await onInferenceRequest(
            currentRequest,
            async (token, done) => {
              if (abortController.signal.aborted) return

              const chunk: TokenChunk = {
                type: 'token_chunk',
                requestId: currentRequest!.requestId,
                token,
                done,
              }

              await writer.write(chunk)
              if (done) console.log(`[P2P] Finished inference for ${currentRequest!.requestId}`)
              this.emitter.emit(P2PEvents.INFERENCE_TOKEN, chunk)
            },
            abortController.signal,
          )

          break
        }
      } catch (error) {
        if (currentRequest) {
          const reason = error instanceof Error ? error.message : 'Provider stopped serving the request'

          try {
            if (!acknowledged) {
              await writer.write({
                type: 'inference_ack',
                requestId: currentRequest.requestId,
                accepted: false,
                reason,
              })
            } else {
              const preempt: PreemptSignal = {
                type: 'preempt',
                requestId: currentRequest.requestId,
                reason,
              }

              await writer.write(preempt)
              this.emitter.emit(P2PEvents.PREEMPT, preempt)
            }
          } catch {
            // Ignore transport-level failures on shutdown.
          }
        }
      } finally {
        await writer.close()
      }
    })
  }

  private async runSingleInference(
    peerId: PeerIdStr,
    requestId: string,
    messages: ChatMessage[],
    modelId: string,
    onToken: (token: string) => void,
    checkpoint: CheckpointData,
    options?: InferenceRequestOptions,
  ): Promise<string> {
    let lastError: unknown = null

    for (let attempt = 0; attempt <= INFERENCE_ACK_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        return await this.runSingleInferenceAttempt(peerId, requestId, messages, modelId, onToken, checkpoint, options)
      } catch (error) {
        lastError = error

        if (!this.shouldRetryAckStage(error) || attempt >= INFERENCE_ACK_RETRY_DELAYS_MS.length) {
          throw error instanceof Error ? error : new Error(String(error))
        }

        this.emitter.emit(P2PEvents.ERROR, {
          message: `Inference stream to ${peerId.slice(0, 12)}... reset before ACK, retrying (${attempt + 1}/${INFERENCE_ACK_RETRY_DELAYS_MS.length + 1})`,
          error,
        })

        await new Promise((resolve) => setTimeout(resolve, INFERENCE_ACK_RETRY_DELAYS_MS[attempt]))
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Inference transport failed')
  }

  private async runSingleInferenceAttempt(
    peerId: PeerIdStr,
    requestId: string,
    messages: ChatMessage[],
    modelId: string,
    onToken: (token: string) => void,
    checkpoint: CheckpointData,
    options?: InferenceRequestOptions,
  ): Promise<string> {
    const stream = await this.manager.dialProtocol(peerId, INFERENCE_PROTOCOL)
    const writer = new StreamWriter<InferenceRequest | StreamCancel | PreemptSignal>(stream)
    const reader = new StreamReader<InferenceAck | TokenChunk | PreemptSignal>(stream)

    activeRequests.set(requestId, {
      peerId,
      cancel: () => {
        void writer.write({
          type: 'stream_cancel',
          requestId,
          reason: 'Requester cancelled the stream',
        }).catch(() => {})

        try {
          stream.abort(new Error('Requester cancelled'))
        } catch {
          // Ignore transport-level close errors.
        }
      },
    })

    await writer.write({
      type: 'inference_request',
      requestId,
      messages,
      modelId,
      maxTokens: options?.maxTokens,
      temperature: options?.temperature,
    })

    let accepted = false
    let fullText = checkpoint.tokensGenerated ?? ''
    const pingStart = Date.now()

    for await (const message of reader) {
      if (message.type === 'inference_ack') {
        if (!message.accepted) {
          throw new Error(message.reason ?? 'Remote peer rejected the request')
        }

        accepted = true
        this.manager.registry?.updateLatency(peerId, Date.now() - pingStart)
        continue
      }

      if (message.type === 'preempt') {
        this.emitter.emit(P2PEvents.PREEMPT, message)
        this.emitter.emit(P2PEvents.CHECKPOINT_SAVED, checkpoint)
        throw new Error(message.reason)
      }

      fullText += message.token
      checkpoint.tokensGenerated = fullText
      checkpoints.set(requestId, { ...checkpoint })

      onToken(message.token)
      this.emitter.emit(P2PEvents.INFERENCE_TOKEN, message)

      if (message.done) {
        this.manager.registry?.recordRequest(peerId, true)
        this.emitter.emit(P2PEvents.INFERENCE_DONE, { requestId, fullText })
        return fullText
      }
    }

    if (!accepted) {
      throw new Error('Provider disconnected before acknowledging the request')
    }

    throw new Error('Provider disconnected before completing the stream')
  }

  private shouldRetryAckStage(error: unknown): boolean {
    if (!(error instanceof Error)) return false

    const message = error.message.toLowerCase()
    return message.includes('before acknowledging')
      || message.includes('stream has been reset')
      || message.includes('connection aborted')
      || message.includes('connection closed')
  }

  async sendPreempt(peerId: PeerIdStr, signal: PreemptSignal): Promise<void> {
    const stream = await this.manager.dialProtocol(peerId, INFERENCE_PROTOCOL)
    const writer = new StreamWriter<PreemptSignal>(stream)
    await writer.write(signal)
    await writer.close()
  }
}
