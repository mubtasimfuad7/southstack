import type { ChatMessage, ModelGenerateOptions, ModelProvider } from '@/core/interfaces/IModelProvider'
import type { ModelRouter } from '@/infrastructure/p2p/ModelRouter'
import type { P2PNetworkManager } from '@/infrastructure/p2p/P2PNetworkManager'
import { P2PEvents, type PeerIdStr } from '@/infrastructure/p2p/types'

type ProgressCallback = (progress: number, text: string) => void

export class PeerModelProvider implements ModelProvider {
  private ready = false
  private abortRequested = false
  private progressListeners = new Set<ProgressCallback>()
  private selectedPeer: PeerIdStr | null = null

  constructor(
    private readonly router: ModelRouter,
    private readonly manager: P2PNetworkManager,
    private modelId: string,
    private preferredPeerId: PeerIdStr | null = null,
  ) {
    this.manager.emitter.on(P2PEvents.PEER_AUTHORIZED, () => {
      this.ready = true
      this.notifyProgress(1, 'Remote provider available')
    })

    this.manager.emitter.on(P2PEvents.PEER_DISCONNECTED, ({ peerId }) => {
      if (peerId === this.selectedPeer) {
        this.abortRequested = true
      }

      if ((this.manager.registry?.getReadyProviders().length ?? 0) === 0) {
        this.ready = false
        this.notifyProgress(0, 'No remote peers available')
      }
    })
  }

  async initialize(): Promise<void> {
    if (this.isReady()) {
      this.ready = true
      return
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error('No remote peers became available within 30 seconds'))
      }, 30_000)

      const unsubscribe = this.manager.emitter.on(P2PEvents.PEER_AUTHORIZED, ({ metadata }) => {
        if (!metadata.transportReady || metadata.models.length === 0 || metadata.availability === 'offline') {
          return
        }

        cleanup()
        this.ready = true
        resolve()
      })

      const cleanup = () => {
        clearTimeout(timeout)
        unsubscribe()
      }
    })
  }

  async generate(messages: ChatMessage[], options?: ModelGenerateOptions): Promise<string> {
    return this.generateStream(messages, options?.onToken ?? (() => {}), options)
  }

  async generateStream(
    messages: ChatMessage[],
    onToken: (token: string) => void,
    options?: ModelGenerateOptions,
  ): Promise<string> {
    if (!this.isReady()) {
      throw new Error('No authorized remote provider is currently available')
    }

    this.abortRequested = false
    this.selectedPeer = this.preferredPeerId ?? this.manager.registry?.bestPeer(this.modelId) ?? null

    const fullText = await this.router.requestInference(
      messages,
      this.modelId,
      (token) => {
        if (!this.abortRequested) {
          onToken(token)
        }
      },
      {
        maxTokens: options?.maxTokens,
        temperature: options?.temperature,
        preferredPeerId: this.preferredPeerId,
      },
    )

    this.selectedPeer = null
    return fullText
  }

  abort(): void {
    this.abortRequested = true
  }

  isReady(): boolean {
    return (this.manager.registry?.getReadyProviders().length ?? 0) > 0
  }

  getModelName(): string {
    const peerId = this.selectedPeer ?? this.preferredPeerId ?? this.manager.registry?.bestPeer(this.modelId) ?? null
    const metadata = peerId ? this.manager.registry?.get(peerId) : null
    return metadata?.models[0] ?? `Remote (${peerId?.slice(0, 8) ?? 'peer'})`
  }

  getLoadProgress(): number {
    return this.ready ? 1 : 0
  }

  onLoadProgress(cb: ProgressCallback): () => void {
    this.progressListeners.add(cb)
    return () => this.progressListeners.delete(cb)
  }

  dispose(): void {
    this.ready = false
    this.abortRequested = false
    this.progressListeners.clear()
  }

  setModelId(modelId: string): void {
    this.modelId = modelId
  }

  setPreferredPeer(peerId: PeerIdStr | null): void {
    this.preferredPeerId = peerId
  }

  getConnectedPeer(): string | null {
    return this.selectedPeer
  }

  private notifyProgress(progress: number, text: string): void {
    this.progressListeners.forEach((cb) => cb(progress, text))
  }
}
