import { useNotificationStore } from '@/application/notificationStore'
import { useP2PStore } from '@/application/p2pStore'
import { localModelProvider } from '@/execution/llm/LocalModelProvider'
import { TypedEventEmitter } from './EventEmitter'
import { ModelRouter } from './ModelRouter'
import { P2PNetworkManager } from './P2PNetworkManager'
import { StreamReader, StreamWriter } from './StreamManager'
import {
  P2PEvents,
  type AuthRequest,
  type AuthResponse,
  type ModelDiscoveryRequest,
  type ModelDiscoveryResponse,
  type P2PEventMap,
  type PeerAvailability,
  type PeerIdStr,
  type PeerMetadata,
  type PeerRegistryAnnouncement,
  type PeerRegistryRequest,
  type SignalingMessage,
  type SignalingPeerRecord,
} from './types'

const AUTH_PROTOCOL = '/room-auth/1.0.0'
const MODEL_DISCOVERY_PROTOCOL = '/model-discovery/1.0.0'
const REGISTRY_PROTOCOL = '/peer-registry/1.0.0'
const DEFAULT_MODEL_ID = localModelProvider.getModelName()

interface SessionStartOptions {
  role: 'host' | 'joiner'
  roomCode: string
  signalingUrl: string
  modelId?: string
}

function isViteAppPort(port: string): boolean {
  return port === '5173' || port === '4173'
}

function sameOriginSignalUrl(url: URL): string {
  return `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}/__signal`
}

function defaultSignalingUrl(): string {
  const { protocol, hostname, port } = window.location

  if (isViteAppPort(port)) {
    return sameOriginSignalUrl(new URL(window.location.origin))
  }

  const scheme = protocol === 'https:' ? 'wss' : 'ws'
  const host = hostname || 'localhost'
  return `${scheme}://${host}:9001`
}

function normalizeSignalingUrl(input: string): string {
  const raw = input.trim()
  if (!raw) {
    return defaultSignalingUrl()
  }

  if (raw.startsWith('/')) {
    return `${window.location.origin.replace(/^http/, 'ws')}${raw}`
  }

  if (raw.startsWith('ws://') || raw.startsWith('wss://')) {
    return raw
  }

  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    const url = new URL(raw)
    if (isViteAppPort(url.port)) {
      return sameOriginSignalUrl(url)
    }

    const wsScheme = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const port = url.port || '9001'
    return `${wsScheme}//${url.hostname}:${port}`
  }

  if (raw.includes(':')) {
    return `ws://${raw}`
  }

  return `ws://${raw}:9001`
}

function signalingHostLooksLocalOnly(signalingUrl: string): boolean {
  try {
    const url = new URL(signalingUrl)
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  } catch {
    return false
  }
}

function explainSignalingFailure(signalingUrl: string): string {
  try {
    const url = new URL(signalingUrl)

    if (url.pathname === '/__signal') {
      return `Unable to reach the embedded signaling service at ${signalingUrl}. Make sure the app is running with \`npm run dev -- --host\` and reload the page.`
    }

    if (url.protocol === 'wss:') {
      return `Unable to reach the signaling server at ${signalingUrl}. The current signaling server only serves ws://, not wss://. Open the app over http:// for LAN pairing or add TLS support to the signaling server.`
    }

    return `Unable to reach the signaling server at ${signalingUrl}`
  } catch {
    return `Unable to reach the signaling server at ${signalingUrl}`
  }
}

export class P2PSession {
  readonly emitter = new TypedEventEmitter<P2PEventMap>()
  readonly manager = new P2PNetworkManager(this.emitter)
  readonly router = new ModelRouter(this.manager, this.emitter)

  private ws: WebSocket | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private signalingTimeout: ReturnType<typeof setTimeout> | null = null
  private relayTimeout: ReturnType<typeof setTimeout> | null = null
  private started = false
  private currentRoomCode = ''
  private currentModelId = DEFAULT_MODEL_ID
  private servingRemoteRequest = false
  private relayConnected = false

  constructor() {
    this.registerCoreHandlers()
  }

  getDefaultSignalingUrl(): string {
    return defaultSignalingUrl()
  }

  getManager(): P2PNetworkManager {
    return this.manager
  }

  getRouter(): ModelRouter {
    return this.router
  }

  async start(options: SessionStartOptions): Promise<void> {
    const store = useP2PStore.getState()
    const roomCode = options.roomCode.trim().toUpperCase()
    const signalingUrl = normalizeSignalingUrl(options.signalingUrl)

    store.setStatus('starting')
    store.setError(null)
    store.setRole(options.role)
    store.setRoomCode(roomCode)
    store.setSignalingUrl(signalingUrl)
    store.setActiveRouter(this.router)

    this.currentRoomCode = roomCode
    this.currentModelId = options.modelId ?? DEFAULT_MODEL_ID

    try {
      if (!this.started) {
        await this.manager.start()
        this.registerProtocolHandlers()
        this.started = true
      }

      const localAddrs = this.manager.getAdvertisableMultiaddrs()
      store.setSelf(this.manager.getPeerId(), localAddrs)
      store.setStatus('listening')
      store.appendLog({ level: 'success', message: `Local peer ready: ${this.manager.getPeerId().slice(0, 16)}...` })
      store.appendLog({ level: 'info', message: `Local libp2p addresses: ${localAddrs.length}` })

      this.connectSignaling(signalingUrl)
      await this.publishLocalRegistry()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start P2P networking'
      store.setStatus('error')
      store.setError(message)
      store.appendLog({ level: 'error', message })
      useNotificationStore.getState().addNotification('error', message)
      throw error
    }
  }

  async disconnect(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }

    if (this.signalingTimeout) {
      clearTimeout(this.signalingTimeout)
      this.signalingTimeout = null
    }

    if (this.relayTimeout) {
      clearTimeout(this.relayTimeout)
      this.relayTimeout = null
    }

    if (this.ws) {
      this.ws.close()
      this.ws = null
    }

    if (this.started) {
      await this.manager.stop()
      this.started = false
    }

    this.relayConnected = false

    useP2PStore.getState().reset()
  }

  async publishLocalRegistry(availability?: PeerAvailability): Promise<void> {
    const registry = this.manager.registry
    if (!registry || !this.manager.getPeerId()) return

    const announcement = this.createLocalRegistryAnnouncement(availability)

    registry.upsertPeer(announcement.peerId, {
      multiaddrs: announcement.multiaddrs,
      models: announcement.models,
      modelStatus: announcement.modelStatus,
      modelReady: announcement.modelReady,
      availability: announcement.availability,
      load: announcement.load,
      roomCode: announcement.roomCode,
    })

    await Promise.allSettled(
      registry.getAuthorized().map(async (peer) => {
        try {
          const stream = await this.manager.dialProtocol(peer.peerId, REGISTRY_PROTOCOL)
          const writer = new StreamWriter<PeerRegistryAnnouncement>(stream)
          await writer.write(announcement)
          await writer.close()
        } catch {
          // Best-effort registry sync only.
        }
      }),
    )
  }

  private registerCoreHandlers(): void {
    const store = useP2PStore.getState()

    this.emitter.on(P2PEvents.NODE_STARTED, ({ listenAddrs }) => {
      store.setSelf(this.manager.getPeerId(), listenAddrs)
      store.appendLog({ level: 'success', message: `Local peer started with ${listenAddrs.length} address(es)` })
    })

    this.emitter.on(P2PEvents.PEER_CONNECTED, ({ peerId }) => {
      store.setStatus('connected')
      store.appendLog({ level: 'info', message: `Connected to ${peerId.slice(0, 12)}...` })
      this.markPeerTransportReady(peerId)
    })

    this.emitter.on(P2PEvents.PEER_DISCONNECTED, ({ peerId }) => {
      store.removePeer(peerId)
      store.appendLog({ level: 'warn', message: `Peer ${peerId.slice(0, 12)}... disconnected` })
      if (store.activeProviderId === peerId) {
        store.setActiveProvider(null)
        useNotificationStore.getState().addNotification('warning', 'Remote provider disconnected. Falling back to the local model.')
      }
    })

    this.emitter.on(P2PEvents.PEER_AUTHORIZED, ({ peerId, metadata }) => {
      store.addPeer(metadata)
      store.setStatus('connected')
      store.appendLog({ level: 'success', message: `Peer ${peerId.slice(0, 12)}... joined room ${this.currentRoomCode}` })
    })

    this.emitter.on(P2PEvents.PEER_REJECTED, ({ peerId, reason }) => {
      store.appendLog({ level: 'warn', message: `Peer ${peerId.slice(0, 12)}... rejected: ${reason}` })
    })

    this.emitter.on(P2PEvents.PEER_REGISTRY_UPDATED, ({ peerId, metadata }) => {
      store.addPeer(metadata)
      if (store.activeProviderId === peerId && (!metadata.transportReady || metadata.models.length === 0 || metadata.availability !== 'available')) {
        store.setActiveProvider(null)
        useNotificationStore.getState().addNotification('warning', 'Remote provider is not ready. Falling back to the local model.')
      }
    })

    this.emitter.on(P2PEvents.PREEMPT, ({ reason }) => {
      useP2PStore.getState().setActiveProvider(null)
      useNotificationStore.getState().addNotification('warning', `Remote provider preempted the request: ${reason}`)
    })

    this.emitter.on(P2PEvents.ERROR, ({ message }) => {
      store.appendLog({ level: 'error', message })
      store.setError(message)
    })

    localModelProvider.onBusyChange((busy) => {
      if (this.servingRemoteRequest && busy) {
        useP2PStore.getState().appendLog({
          level: 'warn',
          message: 'Local model is now busy; remote requests may be preempted.',
        })
      }

      void this.publishLocalRegistry(busy ? 'busy' : 'available')
      this.announceSelf()
    })

    localModelProvider.onReadyChange((ready) => {
      useP2PStore.getState().appendLog({
        level: ready ? 'success' : 'warn',
        message: ready ? 'Local model finished loading and is now available to peers.' : 'Local model is no longer ready for peer requests.',
      })

      void this.publishLocalRegistry(ready ? 'available' : 'offline')
      this.announceSelf()
    })
  }

  private registerProtocolHandlers(): void {
    this.manager.handle(AUTH_PROTOCOL, async (stream) => {
      const reader = new StreamReader<AuthRequest>(stream)
      const writer = new StreamWriter<AuthResponse>(stream)

      for await (const request of reader) {
        if (request.type !== 'auth_request') continue

        if (request.roomCode !== this.currentRoomCode) {
          await writer.write({
            type: 'auth_response',
            accepted: false,
            peerId: this.manager.getPeerId(),
            roomCode: this.currentRoomCode,
            multiaddrs: this.manager.getAdvertisableMultiaddrs(),
            models: [this.currentModelId],
            reason: 'Room code mismatch',
          })
          this.emitter.emit(P2PEvents.PEER_REJECTED, { peerId: request.peerId, reason: 'Room code mismatch' })
          break
        }

        const metadata = this.manager.registry?.authorize(request.peerId, {
          multiaddrs: request.multiaddrs,
          models: request.models,
          modelStatus: Object.fromEntries(request.models.map((model) => [model, request.modelReady ? 'available' : 'offline'])),
          modelReady: request.modelReady ?? false,
          transportReady: true,
          availability: request.modelReady ? 'available' : 'offline',
          roomCode: request.roomCode,
        })

        await writer.write({
          type: 'auth_response',
          accepted: true,
          peerId: this.manager.getPeerId(),
          roomCode: this.currentRoomCode,
          multiaddrs: this.manager.getAdvertisableMultiaddrs(),
          models: [this.currentModelId],
          modelReady: localModelProvider.isReady(),
        })

        if (metadata) {
          this.emitter.emit(P2PEvents.PEER_AUTHORIZED, { peerId: request.peerId, metadata })
        }
        break
      }

      await writer.close()
    })

    this.manager.handle(REGISTRY_PROTOCOL, async (stream) => {
      const reader = new StreamReader<PeerRegistryAnnouncement | PeerRegistryRequest>(stream)
      const writer = new StreamWriter<PeerRegistryAnnouncement>(stream)

      try {
        for await (const message of reader) {
          if (message.type === 'peer_registry_request') {
            if (message.roomCode !== this.currentRoomCode) continue
            await writer.write(this.createLocalRegistryAnnouncement())
            break
          }

          if (message.roomCode !== this.currentRoomCode) continue

          const metadata = this.manager.registry?.upsertPeer(message.peerId, {
            multiaddrs: message.multiaddrs,
            models: message.models,
            modelStatus: message.modelStatus,
            modelReady: message.modelReady,
            availability: message.availability,
            load: message.load,
            roomCode: message.roomCode,
          })

          if (metadata) {
            this.emitter.emit(P2PEvents.PEER_REGISTRY_UPDATED, { peerId: message.peerId, metadata })
          }
        }
      } finally {
        await writer.close()
      }
    })

    this.manager.handle(MODEL_DISCOVERY_PROTOCOL, async (stream, connection) => {
      const remotePeerId = connection.remotePeer.toString()
      const registry = this.manager.registry

      if (!registry?.isAuthorized(remotePeerId)) {
        stream.abort(new Error('Unauthorized'))
        return
      }

      const reader = new StreamReader<ModelDiscoveryRequest>(stream)
      const writer = new StreamWriter<ModelDiscoveryResponse>(stream)

      try {
        for await (const message of reader) {
          if (message.type !== 'model_discovery_request') continue

          const modelReady = localModelProvider.isReady()
          const availability: PeerAvailability = modelReady
            ? (localModelProvider.isBusyGenerating() ? 'busy' : 'available')
            : 'offline'

          await writer.write({
            type: 'model_discovery_response',
            peerId: this.manager.getPeerId(),
            roomCode: this.currentRoomCode,
            models: [this.currentModelId],
            modelStatus: { [this.currentModelId]: availability },
            modelReady,
            availability,
          })
          break
        }
      } finally {
        await writer.close()
      }
    })

    this.router.registerProviderHandler(async (request, onToken, signal) => {
      if (!localModelProvider.isReady()) {
        throw new Error('Local model is not ready yet')
      }

      if (localModelProvider.isBusyGenerating()) {
        throw new Error('Provider is busy with a local request')
      }

      this.servingRemoteRequest = true
      await this.publishLocalRegistry('busy')

      const stopAbort = () => {
        if (signal.aborted) {
          localModelProvider.abort()
        }
      }

      signal.addEventListener('abort', stopAbort)

      try {
        const fullText = await localModelProvider.generateStream(
          request.messages,
          async (token) => {
            await onToken(token, false)
          },
          {
            maxTokens: request.maxTokens,
            temperature: request.temperature,
          },
        )

        await onToken('', true)
        this.emitter.emit(P2PEvents.INFERENCE_DONE, { requestId: request.requestId, fullText })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Provider became unavailable'
        throw new Error(message.includes('preempted') ? message : `Provider became busy: ${message}`)
      } finally {
        signal.removeEventListener('abort', stopAbort)
        this.servingRemoteRequest = false
        await this.publishLocalRegistry('available')
      }
    })
  }

  private connectSignaling(signalingUrl: string): void {
    if (this.ws && this.ws.readyState < WebSocket.CLOSING) {
      this.ws.close()
    }

    const store = useP2PStore.getState()
    store.setStatus('connecting')

    this.ws = new WebSocket(signalingUrl)

    this.signalingTimeout = setTimeout(() => {
      if (this.ws?.readyState === WebSocket.CONNECTING) {
        store.setStatus('error')
        store.setError(`Timed out connecting to signaling server ${signalingUrl}`)
        store.appendLog({ level: 'error', message: `Timed out connecting to signaling server ${signalingUrl}` })
        try {
          this.ws.close()
        } catch {
          // Ignore close errors on timeout.
        }
      }
    }, 8_000)

    this.ws.onopen = () => {
      if (this.signalingTimeout) {
        clearTimeout(this.signalingTimeout)
        this.signalingTimeout = null
      }

      store.appendLog({ level: 'success', message: `Connected to signaling server ${signalingUrl}` })
      store.setStatus('connecting')

      if (signalingHostLooksLocalOnly(signalingUrl)) {
        store.appendLog({
          level: 'warn',
          message: 'Using localhost signaling. For pairing across two devices, the joiner must use the host machine LAN IP.',
        })
      }

      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer)
      }

      this.heartbeatTimer = setInterval(() => {
        this.announceSelf()
        void this.publishLocalRegistry()
      }, 5_000)

      this.relayTimeout = setTimeout(() => {
        if (!this.relayConnected) {
          const message = 'Connected to signaling server, but never received a usable relay reservation'
          store.setStatus('error')
          store.setError(message)
          store.appendLog({ level: 'error', message })
        }
      }, 12_000)
    }

    this.ws.onerror = () => {
      const message = explainSignalingFailure(signalingUrl)
      store.setStatus('error')
      store.setError(message)
      store.appendLog({ level: 'error', message })
    }

    this.ws.onclose = () => {
      if (this.signalingTimeout) {
        clearTimeout(this.signalingTimeout)
        this.signalingTimeout = null
      }

      store.appendLog({ level: 'warn', message: 'Signaling server disconnected; existing peer links stay P2P-only.' })
      if (store.peers.length > 0) {
        store.setStatus('connected')
      }
    }

    this.ws.onmessage = (event) => {
      let message: SignalingMessage
      try {
        message = JSON.parse(event.data)
      } catch {
        return
      }

      if (message.type === 'peer-list') {
        const records = Array.isArray(message.payload) ? message.payload as SignalingPeerRecord[] : []
        store.appendLog({ level: 'info', message: `Signaling discovered ${records.length} peer(s) in room ${this.currentRoomCode}` })
        records
          .filter((record) => record.peerId !== this.manager.getPeerId())
          .forEach((record) => {
            this.registerDiscoveredPeer(record)
            void this.connectToDiscoveredPeer({
              peerId: record.peerId,
              multiaddrs: record.multiaddrs ?? [],
              roomCode: record.roomCode,
              models: record.models,
              modelReady: record.modelReady,
              availability: record.availability
            })
          })
      }

      if (message.type === 'announce' && message.from && message.from !== this.manager.getPeerId()) {
        const payload = (message.payload ?? {}) as SignalingPeerRecord
        store.appendLog({ level: 'info', message: `Signaling announced peer ${message.from.slice(0, 12)}...` })
        this.registerDiscoveredPeer({
          peerId: message.from,
          multiaddrs: payload.multiaddrs ?? [],
          models: payload.models ?? [],
          modelReady: payload.modelReady,
          availability: payload.availability,
          roomCode: payload.roomCode,
        })
        void this.connectToDiscoveredPeer({
          peerId: message.from,
          multiaddrs: payload.multiaddrs ?? [],
          models: payload.models ?? [],
          modelReady: payload.modelReady,
          availability: payload.availability,
          roomCode: payload.roomCode,
        })
      }

      if (message.type === 'announce-leave' && message.from) {
        store.removePeer(message.from)
        this.manager.registry?.removePeer(message.from)
        store.appendLog({ level: 'warn', message: `Peer ${message.from.slice(0, 12)}... left room ${this.currentRoomCode}` })
      }

      if (message.type === 'relay-info') {
        const payload = (message.payload ?? {}) as { multiaddrs?: string[] }
        void this.connectRelayAndAdvertise(payload.multiaddrs ?? [])
      }
    }
  }

  private async connectRelayAndAdvertise(relayMultiaddrs: string[]): Promise<void> {
    const store = useP2PStore.getState()

    if (this.relayConnected) {
      this.announceSelf()
      return
    }

    if (relayMultiaddrs.length === 0) {
      const message = 'Signaling server did not provide any relay addresses'
      store.setStatus('error')
      store.setError(message)
      store.appendLog({ level: 'error', message })
      return
    }

    store.appendLog({ level: 'info', message: `Received ${relayMultiaddrs.length} relay address(es) from signaling server` })

    let dialed = false
    for (const relayAddr of relayMultiaddrs) {
      try {
        await this.manager.reserveRelay(relayAddr)
        dialed = true
        store.appendLog({ level: 'success', message: `Reserved relay slot via ${relayAddr}` })
        break
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'unknown error'
        store.appendLog({ level: 'warn', message: `Relay reservation failed for ${relayAddr}: ${reason}` })
      }
    }

    if (!dialed) {
      const message = 'Could not reserve a slot on the libp2p relay server'
      store.setStatus('error')
      store.setError(message)
      store.appendLog({ level: 'error', message })
      useNotificationStore.getState().addNotification('error', message)
      return
    }

    const advertised = await this.waitForRelayAddresses()
    store.setSelf(this.manager.getPeerId(), advertised)
    store.appendLog({ level: 'info', message: `Relay-backed addresses ready: ${advertised.length}` })

    if (advertised.length === 0) {
      const message = 'Relay connection succeeded, but no dialable libp2p addresses were advertised'
      store.setStatus('error')
      store.setError(message)
      store.appendLog({ level: 'error', message })
      useNotificationStore.getState().addNotification('error', message, 8000)
      return
    }

    if (this.relayTimeout) {
      clearTimeout(this.relayTimeout)
      this.relayTimeout = null
    }

    this.relayConnected = true
    store.setStatus('connected')
    this.announceSelf()
    await this.publishLocalRegistry()
  }

  private announceSelf(): void {
    const modelReady = localModelProvider.isReady()
    const availability: PeerAvailability = modelReady
      ? (localModelProvider.isBusyGenerating() ? 'busy' : 'available')
      : 'offline'

    this.sendSignal({
      type: 'announce',
      from: this.manager.getPeerId(),
      payload: {
        roomCode: this.currentRoomCode,
        multiaddrs: this.manager.getAdvertisableMultiaddrs(),
        models: [this.currentModelId],
        modelReady,
        availability,
      },
    })

    this.sendSignal({
      type: 'peer-list',
      from: this.manager.getPeerId(),
      payload: {
        roomCode: this.currentRoomCode,
      },
    })
  }

  private async waitForRelayAddresses(timeoutMs = 15_000): Promise<string[]> {
    const startedAt = Date.now()

    while (Date.now() - startedAt < timeoutMs) {
      const addrs = this.manager
        .getAdvertisableMultiaddrs()
        .filter((addr) => addr.includes('/p2p-circuit') || addr.includes('/webrtc'))

      if (addrs.length > 0) {
        return addrs
      }

      await new Promise((resolve) => setTimeout(resolve, 500))
    }

    return this.manager.getAdvertisableMultiaddrs()
  }

  private async connectToDiscoveredPeer(record: SignalingPeerRecord): Promise<void> {
    if (record.roomCode && record.roomCode !== this.currentRoomCode) return
    if (!this.manager.registry || record.peerId === this.manager.getPeerId()) return

    this.registerDiscoveredPeer(record)

    useP2PStore.getState().appendLog({
      level: 'info',
      message: `Attempting libp2p dial to ${record.peerId.slice(0, 12)}... with ${record.multiaddrs.length} address(es)`,
    })

    if (record.multiaddrs.length === 0) {
      useP2PStore.getState().appendLog({
        level: 'warn',
        message: `Peer ${record.peerId.slice(0, 12)}... joined signaling for room ${this.currentRoomCode}, but has no dialable addresses yet`,
      })
      return
    }

    let connected = false

    for (const addr of this.manager.getDialCandidates(record.peerId, record.multiaddrs)) {
      try {
        await this.manager.dial(addr)
        connected = true
        break
      } catch {
        // Try all known addresses before giving up.
      }
    }

    if (connected) {
      this.markPeerTransportReady(record.peerId)
    }

    if (connected) {
      await this.syncPeerCapabilities(record.peerId)
      await this.publishLocalRegistry()
    }
  }

  private sendSignal(message: SignalingMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }

  private registerDiscoveredPeer(record: SignalingPeerRecord): PeerMetadata | null {
    if (!this.manager.registry || record.peerId === this.manager.getPeerId()) {
      return null
    }

    const existing = this.manager.registry.getPeer(record.peerId)
    const hasLiveConnection = this.manager.hasConnection(record.peerId)
    const effectiveAvailability = record.availability ?? existing?.availability ?? 'offline'
    const effectiveModels = record.models ?? existing?.models ?? []
    const effectiveModelReady = record.modelReady
      ?? existing?.modelReady
      ?? (effectiveAvailability === 'available' && effectiveModels.length > 0)

    const metadata = this.manager.registry.authorize(record.peerId, {
      multiaddrs: record.multiaddrs,
      models: effectiveModels,
      modelStatus: record.models?.length
        ? Object.fromEntries(record.models.map((model) => [model, effectiveModelReady ? effectiveAvailability : 'offline']))
        : existing?.modelStatus,
      roomCode: record.roomCode,
      modelReady: effectiveModelReady,
      transportReady: existing?.transportReady || hasLiveConnection || false,
      availability: effectiveAvailability,
    })

    useP2PStore.getState().addPeer(metadata)

    if (!existing?.authorized) {
      useP2PStore.getState().appendLog({
        level: 'success',
        message: `Peer ${record.peerId.slice(0, 12)}... joined room ${this.currentRoomCode}`,
      })
    }

    return metadata
  }

  private async syncPeerCapabilities(peerId: PeerIdStr): Promise<void> {
    if (!this.manager.registry || peerId === this.manager.getPeerId()) return

    try {
      const stream = await this.manager.dialProtocol(peerId, MODEL_DISCOVERY_PROTOCOL)
      const writer = new StreamWriter<ModelDiscoveryRequest>(stream)
      const reader = new StreamReader<ModelDiscoveryResponse>(stream)

      await writer.write({ type: 'model_discovery_request' })

      for await (const response of reader) {
        await writer.close()

        if (response.roomCode !== this.currentRoomCode) {
          return
        }

        const metadata = this.manager.registry.authorize(peerId, {
          models: response.models,
          modelStatus: response.modelStatus,
          modelReady: response.modelReady,
          availability: response.availability,
          transportReady: true,
          roomCode: response.roomCode,
        })

        this.emitter.emit(P2PEvents.PEER_REGISTRY_UPDATED, { peerId, metadata })
        return
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error'
      if (reason.includes('could not negotiate')) {
        await this.requestPeerRegistrySnapshot(peerId)
        return
      }

      useP2PStore.getState().appendLog({
        level: 'warn',
        message: `Could not sync model capabilities from ${peerId.slice(0, 12)}...: ${reason}`,
      })
    }
  }

  private async requestPeerRegistrySnapshot(peerId: PeerIdStr): Promise<void> {
    try {
      const stream = await this.manager.dialProtocol(peerId, REGISTRY_PROTOCOL)
      const writer = new StreamWriter<PeerRegistryRequest>(stream)
      const reader = new StreamReader<PeerRegistryAnnouncement>(stream)

      await writer.write({
        type: 'peer_registry_request',
        peerId: this.manager.getPeerId(),
        roomCode: this.currentRoomCode,
        timestamp: Date.now(),
      })

      for await (const message of reader) {
        await writer.close()

        if (message.roomCode !== this.currentRoomCode) {
          return
        }

        const metadata = this.manager.registry?.authorize(peerId, {
          multiaddrs: message.multiaddrs,
          models: message.models,
          modelStatus: message.modelStatus,
          modelReady: message.modelReady,
          availability: message.availability,
          load: message.load,
          transportReady: true,
          roomCode: message.roomCode,
        })

        if (metadata) {
          this.emitter.emit(P2PEvents.PEER_REGISTRY_UPDATED, { peerId, metadata })
        }
        return
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error'
      useP2PStore.getState().appendLog({
        level: 'warn',
        message: `Could not sync model capabilities from ${peerId.slice(0, 12)}...: ${reason}`,
      })
    }
  }

  private createLocalRegistryAnnouncement(availability?: PeerAvailability): PeerRegistryAnnouncement {
    const modelReady = localModelProvider.isReady()
    const status = modelReady
      ? (availability ?? (localModelProvider.isBusyGenerating() ? 'busy' : 'available'))
      : 'offline'

    return {
      type: 'peer_registry_announcement',
      peerId: this.manager.getPeerId(),
      roomCode: this.currentRoomCode,
      multiaddrs: this.manager.getAdvertisableMultiaddrs(),
      models: [this.currentModelId],
      modelStatus: { [this.currentModelId]: status },
      modelReady,
      load: status === 'busy' ? 1 : 0,
      availability: status,
      timestamp: Date.now(),
    }
  }

  private markPeerTransportReady(peerId: PeerIdStr): void {
    if (!this.manager.registry || !peerId || peerId === this.manager.getPeerId()) {
      return
    }

    const existing = this.manager.registry.get(peerId)
    const roomMatches = !existing?.roomCode || existing.roomCode === this.currentRoomCode
    if (!existing?.authorized || !roomMatches || existing.transportReady) {
      return
    }

    const metadata = this.manager.registry.upsertPeer(peerId, {
      transportReady: true,
      modelReady: existing?.modelReady || (existing?.availability === 'available' && (existing?.models.length ?? 0) > 0) || false,
      connectedAt: Date.now(),
    })

    useP2PStore.getState().appendLog({
      level: 'success',
      message: `Peer ${peerId.slice(0, 12)}... transport is ready for room ${this.currentRoomCode}`,
    })

    this.emitter.emit(P2PEvents.PEER_REGISTRY_UPDATED, { peerId, metadata })
  }
}

export const p2pSession = new P2PSession()
