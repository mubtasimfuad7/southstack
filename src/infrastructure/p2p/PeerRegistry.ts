import type {
  PeerAvailability,
  PeerIdStr,
  PeerMetadata,
  PeerScore,
} from './types'

function defaultMetadata(peerId: PeerIdStr): PeerMetadata {
  return {
    peerId,
    multiaddrs: [],
    models: [],
    modelStatus: {},
    modelReady: false,
    transportReady: false,
    availability: 'available',
    load: 0,
    latencyMs: 9999,
    authorized: false,
    connectedAt: Date.now(),
    lastSeen: Date.now(),
    totalRequests: 0,
    failedRequests: 0,
  }
}

export class PeerRegistry {
  private peers = new Map<PeerIdStr, PeerMetadata>()
  private authorizedPeers = new Set<PeerIdStr>()

  constructor(private readonly selfPeerId: PeerIdStr) {}

  upsertPeer(peerId: PeerIdStr, metadata: Partial<PeerMetadata>): PeerMetadata {
    if (peerId === this.selfPeerId) {
      return {
        ...defaultMetadata(peerId),
        ...metadata,
        peerId,
      }
    }

    const existing = this.peers.get(peerId) ?? defaultMetadata(peerId)
    const next: PeerMetadata = {
      ...existing,
      ...metadata,
      peerId,
      modelStatus: {
        ...existing.modelStatus,
        ...metadata.modelStatus,
      },
      lastSeen: Date.now(),
    }

    if (next.authorized) {
      this.authorizedPeers.add(peerId)
    }

    this.peers.set(peerId, next)
    return next
  }

  removePeer(peerId: PeerIdStr): void {
    this.peers.delete(peerId)
    this.authorizedPeers.delete(peerId)
  }

  get(peerId: PeerIdStr): PeerMetadata | undefined {
    return this.peers.get(peerId)
  }

  getPeer(peerId: PeerIdStr): PeerMetadata | undefined {
    return this.get(peerId)
  }

  getAllPeers(): PeerMetadata[] {
    return Array.from(this.peers.values())
  }

  getAuthorized(): PeerMetadata[] {
    return this.getAllPeers().filter((peer) => this.isAuthorized(peer.peerId))
  }

  getReadyProviders(): PeerMetadata[] {
    return this.getAuthorized().filter((peer) => this.isUsableProvider(peer))
  }

  authorize(peerId: PeerIdStr, metadata?: Partial<PeerMetadata>): PeerMetadata {
    this.authorizedPeers.add(peerId)
    return this.upsertPeer(peerId, { ...metadata, authorized: true })
  }

  isAuthorized(peerId: PeerIdStr): boolean {
    return peerId === this.selfPeerId || this.authorizedPeers.has(peerId)
  }

  updateLatency(peerId: PeerIdStr, latencyMs: number): void {
    this.upsertPeer(peerId, { latencyMs })
  }

  updateModels(peerId: PeerIdStr, models: string[], modelStatus: Record<string, PeerAvailability> = {}): void {
    const availability = this.deriveAvailability(models, modelStatus)
    this.upsertPeer(peerId, { models, modelStatus, availability })
  }

  updateAvailability(peerId: PeerIdStr, availability: PeerAvailability, load = 0): void {
    this.upsertPeer(peerId, { availability, load })
  }

  recordRequest(peerId: PeerIdStr, success: boolean): void {
    const peer = this.peers.get(peerId)
    if (!peer) return

    this.upsertPeer(peerId, {
      totalRequests: peer.totalRequests + 1,
      failedRequests: success ? peer.failedRequests : peer.failedRequests + 1,
    })
  }

  checkRateLimit(peerId: PeerIdStr, windowMs: number, max: number): boolean {
    void peerId
    void windowMs
    void max
    return true
  }

  scoreAll(modelId: string, excludePeerIds: PeerIdStr[] = []): PeerScore[] {
    const excluded = new Set(excludePeerIds)

    return this.getAuthorized()
      .filter((peer) => !excluded.has(peer.peerId))
      .filter((peer) => this.isUsableProvider(peer))
      .filter((peer) => peer.models.includes(modelId) || peer.models.length === 0)
      .map((peer) => ({
        peerId: peer.peerId,
        latencyMs: peer.latencyMs,
        load: peer.load,
        successRate: peer.totalRequests > 0 ? (peer.totalRequests - peer.failedRequests) / peer.totalRequests : 1,
        modelCompatible: peer.models.includes(modelId) || peer.models.length === 0,
        score: this.calculateScore(peer, modelId),
      }))
      .sort((a, b) => b.score - a.score)
  }

  bestPeer(modelId: string, excludePeerIds: PeerIdStr[] = []): PeerIdStr | null {
    return this.scoreAll(modelId, excludePeerIds)[0]?.peerId ?? null
  }

  private calculateScore(peer: PeerMetadata, modelId: string): number {
    const latencyPenalty = Math.min(peer.latencyMs / 20, 35)
    const successRate = peer.totalRequests > 0 ? (peer.totalRequests - peer.failedRequests) / peer.totalRequests : 1
    const busyPenalty = peer.availability === 'busy' ? 45 : 0
    const incompatibilityPenalty = peer.models.length > 0 && !peer.models.includes(modelId) ? 100 : 0
    return 100 - latencyPenalty - busyPenalty - incompatibilityPenalty - peer.load * 30 + successRate * 10
  }

  private deriveAvailability(models: string[], modelStatus: Record<string, PeerAvailability>): PeerAvailability {
    if (models.length === 0) return 'available'
    const statuses = models.map((model) => modelStatus[model] ?? 'available')
    return statuses.every((status) => status === 'busy') ? 'busy' : 'available'
  }

  private isUsableProvider(peer: PeerMetadata): boolean {
    return peer.transportReady && peer.models.length > 0 && peer.availability !== 'offline'
  }
}
