import { createLibp2p } from 'libp2p'
import { noise } from '@libp2p/noise'
import { yamux } from '@libp2p/yamux'
import { webRTC } from '@libp2p/webrtc'
import { webSockets } from '@libp2p/websockets'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { identify } from '@libp2p/identify'
import type { Connection, Libp2p, Stream } from '@libp2p/interface'
import { multiaddr } from '@multiformats/multiaddr'
import { PeerRegistry } from './PeerRegistry'
import { TypedEventEmitter } from './EventEmitter'
import { P2PEvents, type P2PEventMap, type PeerIdStr } from './types'

export class P2PNetworkManager {
  private node: Libp2p | null = null
  public registry: PeerRegistry | null = null
  public readonly emitter: TypedEventEmitter<P2PEventMap>

  constructor(emitter = new TypedEventEmitter<P2PEventMap>()) {
    this.emitter = emitter
  }

  async start(): Promise<void> {
    if (this.node) return

    this.node = await createLibp2p({
      start: false,
      addresses: {
        listen: ['/p2p-circuit', '/webrtc'],
      },
      transports: [
        webRTC(),
        webSockets(),
        circuitRelayTransport(),
      ],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      connectionGater: {
        denyDialMultiaddr: async () => false,
      },
      services: {
        identify: identify(),
      },
    })

    this.registry = new PeerRegistry(this.node.peerId.toString())

    this.node.addEventListener('peer:connect', (evt) => {
      const remoteId = evt.detail.toString()
      const remoteAddrs: string[] = []
      const metadata = this.registry?.upsertPeer(remoteId, {
        multiaddrs: remoteAddrs,
        connectedAt: Date.now(),
      })

      this.emitter.emit(P2PEvents.PEER_CONNECTED, {
        peerId: remoteId,
        multiaddr: remoteAddrs[0] ?? 'unknown',
      })

      if (metadata) {
        this.emitter.emit(P2PEvents.PEER_REGISTRY_UPDATED, { peerId: remoteId, metadata })
      }
    })

    this.node.addEventListener('peer:disconnect', (evt) => {
      const remoteId = evt.detail.toString()
      this.registry?.removePeer(remoteId)
      this.emitter.emit(P2PEvents.PEER_DISCONNECTED, { peerId: remoteId })
    })

    await this.node.start()

    this.emitter.emit(P2PEvents.NODE_STARTED, {
      listenAddrs: this.getMultiaddrs(),
    })
  }

  async stop(): Promise<void> {
    if (!this.node) return
    await this.node.stop()
    this.node = null
    this.registry = null
    this.emitter.emit(P2PEvents.NODE_STOPPED, {})
  }

  get selfPeerId(): PeerIdStr {
    return this.node?.peerId.toString() ?? ''
  }

  getPeerId(): PeerIdStr {
    return this.selfPeerId
  }

  getMultiaddrs(): string[] {
    return this.node?.getMultiaddrs().map((addr) => addr.toString()) ?? []
  }

  getAdvertisableMultiaddrs(peerId = this.getPeerId()): string[] {
    return this.getMultiaddrs()
      .map((addr) => this.normalizeMultiaddrForPeer(addr, peerId))
      .filter((addr, index, all) => Boolean(addr) && all.indexOf(addr) === index)
  }

  getNode(): Libp2p {
    if (!this.node) {
      throw new Error('P2P node not started')
    }
    return this.node
  }

  async dial(addr: string): Promise<Connection> {
    return this.getNode().dial(multiaddr(addr))
  }

  async reserveRelay(addr: string): Promise<void> {
    const relayListenAddr = addr.endsWith('/p2p-circuit') ? addr : `${addr}/p2p-circuit`
    const node = this.getNode() as Libp2p & {
      components?: {
        transportManager?: {
          listen: (addrs: ReturnType<typeof multiaddr>[]) => Promise<void>
        }
      }
    }

    const transportManager = node.components?.transportManager

    if (!transportManager) {
      throw new Error('Libp2p transport manager is unavailable')
    }

    await transportManager.listen([multiaddr(relayListenAddr)])
  }

  async dialProtocol(peerIdOrAddr: PeerIdStr, protocol: string): Promise<Stream> {
    const registryEntry = this.registry?.get(peerIdOrAddr)
    const candidates = registryEntry?.multiaddrs?.length
      ? this.getDialCandidates(peerIdOrAddr, registryEntry.multiaddrs)
      : peerIdOrAddr.startsWith('/') ? [peerIdOrAddr] : []

    let lastError: unknown = null

    for (const candidate of candidates) {
      try {
        return await this.getNode().dialProtocol(multiaddr(candidate), protocol)
      } catch (error) {
        lastError = error
      }
    }

    if (peerIdOrAddr.startsWith('/')) {
      return this.getNode().dialProtocol(multiaddr(peerIdOrAddr), protocol)
    }

    try {
      return await this.getNode().dialProtocol(multiaddr(`/p2p/${peerIdOrAddr}`), protocol)
    } catch (error) {
      lastError = error
    }

    throw lastError instanceof Error ? lastError : new Error(`Failed to dial protocol ${protocol} for ${peerIdOrAddr}`)
  }

  handle(protocol: string, handler: (stream: Stream, connection: Connection) => void | Promise<void>): void {
    void this.getNode().handle(protocol, handler)
  }

  async unhandle(protocol: string): Promise<void> {
    if (!this.node) return
    await this.node.unhandle(protocol)
  }

  getDialCandidates(peerId: PeerIdStr, addrs: string[]): string[] {
    return addrs
      .map((addr) => this.normalizeMultiaddrForPeer(addr, peerId))
      .filter((addr, index, all) => Boolean(addr) && all.indexOf(addr) === index)
  }

  hasConnection(peerId: PeerIdStr): boolean {
    if (!this.node || !peerId) return false
    return this.node.getConnections().some((connection) => connection.remotePeer.toString() === peerId)
  }

  private normalizeMultiaddrForPeer(addr: string, peerId: PeerIdStr): string {
    const trimmed = addr.trim()
    if (!trimmed || !peerId) return trimmed

    if (trimmed.endsWith(`/p2p/${peerId}`)) {
      return trimmed
    }

    if (trimmed === '/p2p-circuit' || trimmed === '/webrtc') {
      return trimmed
    }

    const parts = trimmed.split('/').filter(Boolean)
    const lastP2pIndex = parts.lastIndexOf('p2p')
    const containsCircuit = parts.includes('p2p-circuit')

    if (lastP2pIndex === -1) {
      return `${trimmed}/p2p/${peerId}`
    }

    if (containsCircuit) {
      return `${trimmed}/p2p/${peerId}`
    }

    return trimmed
  }
}
