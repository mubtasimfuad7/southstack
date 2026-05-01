// ============================================================
// PEER NETWORK MANAGER: WebRTC mesh + signaling bootstrap
// Auto-connects when app loads. Peers join by opening the URL.
// Signaling WS is embedded in the Vite dev server at /signaling.
// ============================================================

import { messageBus } from './messageBus'
import {
  createMessage,
  isValidMessage,
  PROTOCOL_VERSION,
  type P2PMessage,
  type HelloPayload,
  type HeartbeatPayload,
  type GoodbyePayload,
  type NetChunkPayload,
  type PeerCapabilities,
  type PeerLocalState,
} from './protocol'

const HEARTBEAT_INTERVAL_MS = 1_000  // More frequent heartbeats
const PEER_TIMEOUT_MS = 10_000      // More forgiving timeout (10s instead of 6s)
const DATA_CHANNEL_CHUNK_SIZE = 16_000
const DATA_CHANNEL_CHUNK_TTL_MS = 30_000
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
]

type PeerEntry = {
  peerId: string
  connection: RTCPeerConnection
  channel?: RTCDataChannel
  lastSeen: number
}

type PeerOfflineCallback = (peerId: string) => void
type ChunkBuffer = {
  receivedAt: number
  total: number
  chunks: string[]
  receivedCount: number
}

class PeerNetworkManager {
  private localPeerId: string = ''
  private signalingWs: WebSocket | null = null
  private peers = new Map<string, PeerEntry>()
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private offlineCheckTimer: ReturnType<typeof setInterval> | null = null
  private inboundChunks = new Map<string, ChunkBuffer>()
  private offlineCallbacks = new Set<PeerOfflineCallback>()
  private getLocalState: (() => PeerLocalState) = () => 'idle'
  private getAcceptsRemote: (() => boolean) = () => true
  private getDisplayName: (() => string) = () => this.localPeerId
  private getCapabilities: (() => PeerCapabilities) = () => ({
    modelName: 'unknown',
    maxConcurrentRemoteTasks: 1,
    supportedTools: [],
    protocolVersion: PROTOCOL_VERSION,
  })

  private networkStateCallback: ((connected: boolean) => void) | null = null
  private signalingConnected = false

  onNetworkStateChange(cb: (connected: boolean) => void) {
    this.networkStateCallback = cb
  }

  private _updateNetworkState() {
    const isConnected = this.signalingConnected || this.peers.size > 0
    this.networkStateCallback?.(isConnected)
  }

  // ── Initialization ─────────────────────────────────────

  async init(
    localPeerId: string,
    getLocalState: () => PeerLocalState,
    getAcceptsRemote: () => boolean,
    getCapabilities: () => PeerCapabilities,
    getDisplayName?: () => string,
  ): Promise<void> {
    this.localPeerId = localPeerId
    this.getLocalState = getLocalState
    this.getAcceptsRemote = getAcceptsRemote
    this.getCapabilities = getCapabilities
    this.getDisplayName = getDisplayName ?? (() => this.localPeerId)

    // Connect to signaling server embedded in Vite dev server
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/signaling`
    this._connectSignaling(wsUrl)

    this._startHeartbeat()
    this._startOfflineCheck()
  }

  // ── Signaling ──────────────────────────────────────────

  private _connectSignaling(url: string): void {
    const ws = new WebSocket(url)
    this.signalingWs = ws

    ws.onopen = () => {
      console.log('[P2P] Connected to signaling server')
      this.signalingConnected = true
      this._updateNetworkState()
      // Announce ourselves to get connected to existing peers
      ws.send(JSON.stringify({
        type: 'announce',
        peerId: this.localPeerId,
      }))
    }

    ws.onmessage = (event) => {
      try {
        const sig = JSON.parse(event.data as string)
        this._handleSignal(sig)
      } catch (e) {
        console.warn('[P2P] Invalid signaling message', e)
      }
    }

    ws.onclose = () => {
      console.log('[P2P] Signaling WS closed. P2P mesh continues independently.')
      this.signalingConnected = false
      this._updateNetworkState()
      // No reconnect — spec says signaling can go offline after mesh is formed
    }

    ws.onerror = (e) => {
      console.warn('[P2P] Signaling error', e)
      this.signalingConnected = false
      this._updateNetworkState()
    }
  }

  private async _handleSignal(sig: {
    type: string
    fromPeerId?: string
    sdp?: RTCSessionDescriptionInit
    candidate?: RTCIceCandidateInit
    peers?: string[]
  }): Promise<void> {
    if (sig.type === 'peers') {
      // Server sent us the list of existing peers — initiate connections
      for (const peerId of sig.peers ?? []) {
        if (peerId !== this.localPeerId && !this.peers.has(peerId)) {
          if (this.localPeerId > peerId) {
            await this._createOffer(peerId)
          } else {
            console.log(`[P2P] Tiebreaker: letting ${peerId} initiate connection`)
          }
        }
      }
    } else if (sig.type === 'offer' && sig.fromPeerId && sig.sdp) {
      await this._handleOffer(sig.fromPeerId, sig.sdp)
    } else if (sig.type === 'answer' && sig.fromPeerId && sig.sdp) {
      const entry = this.peers.get(sig.fromPeerId)
      if (entry) {
        await entry.connection.setRemoteDescription(sig.sdp)
      }
    } else if (sig.type === 'ice' && sig.fromPeerId && sig.candidate) {
      const entry = this.peers.get(sig.fromPeerId)
      if (entry) {
        await entry.connection.addIceCandidate(sig.candidate)
      }
    }
  }

  private async _createOffer(toPeerId: string): Promise<void> {
    const { connection, channel } = this._createPeerConnection(toPeerId, true)
    // Synchronously track the connection before yielding to the event loop
    this.peers.set(toPeerId, { peerId: toPeerId, connection, channel, lastSeen: Date.now() })

    const offer = await connection.createOffer()
    await connection.setLocalDescription(offer)
    this._sendSignal({ type: 'offer', toPeerId, sdp: offer })
    this._updateNetworkState()
  }

  private async _handleOffer(fromPeerId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const { connection } = this._createPeerConnection(fromPeerId, false)
    // Synchronously track the connection before awaiting remote description
    this.peers.set(fromPeerId, { peerId: fromPeerId, connection, lastSeen: Date.now() })

    await connection.setRemoteDescription(sdp)
    const answer = await connection.createAnswer()
    await connection.setLocalDescription(answer)
    this._sendSignal({ type: 'answer', toPeerId: fromPeerId, sdp: answer })
    this._updateNetworkState()
  }

  private _createPeerConnection(remotePeerId: string, isInitiator: boolean): { connection: RTCPeerConnection; channel?: RTCDataChannel } {
    const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS })

    connection.onicecandidate = (e) => {
      if (e.candidate) {
        this._sendSignal({ type: 'ice', toPeerId: remotePeerId, candidate: e.candidate.toJSON() })
      }
    }

    connection.onconnectionstatechange = () => {
      if (connection.connectionState === 'disconnected' || connection.connectionState === 'failed') {
        this._handlePeerDisconnect(remotePeerId)
      }
    }

    let channel: RTCDataChannel | undefined

    if (isInitiator) {
      channel = connection.createDataChannel('p2p', { ordered: true })
      this._wireChannel(channel, remotePeerId)
    }

    // Also handle incoming data channels (answerer side)
    connection.ondatachannel = (e) => {
      this._wireChannel(e.channel, remotePeerId)
      const entry = this.peers.get(remotePeerId)
      if (entry) {
        if (entry.channel && entry.channel !== e.channel) {
          entry.channel.close()
        }
        entry.channel = e.channel
      }
    }

    return { connection, channel }
  }

  private _wireChannel(channel: RTCDataChannel, remotePeerId: string): void {
    const handleOpen = () => {
      console.log(`[P2P] Channel open with ${remotePeerId}`)
      // Send hello
      const hello = createMessage<HelloPayload>('peer/hello', this.localPeerId, {
        displayName: this.getDisplayName(),
        state: this.getLocalState(),
        capabilities: this.getCapabilities(),
        acceptsRemoteTasks: this.getAcceptsRemote(),
      }, remotePeerId)
      channel.send(JSON.stringify(hello))
    }

    if (channel.readyState === 'open') {
      handleOpen()
    } else {
      channel.onopen = handleOpen
    }

    channel.onmessage = (e) => {
      try {
        const raw = this._parseInboundData(e.data as string, remotePeerId)
        if (!raw) return
        if (isValidMessage(raw)) {
          // Update last seen on every inbound message
          const entry = this.peers.get(remotePeerId)
          if (entry) entry.lastSeen = Date.now()
          messageBus.receive(raw as P2PMessage)
        }
      } catch (err) {
        console.warn('[P2P] Invalid message from peer', err)
      }
    }

    channel.onclose = () => this._handlePeerDisconnect(remotePeerId)
  }

  private _parseInboundData(data: string, remotePeerId: string): unknown | null {
    const raw = JSON.parse(data)
    if (raw?.type !== 'net/chunk') return raw
    if (!isValidMessage(raw)) return null

    const payload = raw.payload as NetChunkPayload
    if (
      typeof payload?.originalMessageId !== 'string' ||
      typeof payload.index !== 'number' ||
      typeof payload.total !== 'number' ||
      typeof payload.data !== 'string' ||
      payload.index < 0 ||
      payload.index >= payload.total
    ) {
      return null
    }

    const key = `${remotePeerId}:${payload.originalMessageId}`
    const now = Date.now()
    let buffer = this.inboundChunks.get(key)
    if (!buffer) {
      buffer = {
        receivedAt: now,
        total: payload.total,
        chunks: new Array(payload.total),
        receivedCount: 0,
      }
      this.inboundChunks.set(key, buffer)
      this._cleanupInboundChunks(now)
    }

    if (!buffer.chunks[payload.index]) {
      buffer.chunks[payload.index] = payload.data
      buffer.receivedCount += 1
    }

    if (buffer.receivedCount !== buffer.total) return null

    this.inboundChunks.delete(key)
    return JSON.parse(buffer.chunks.join(''))
  }

  private _cleanupInboundChunks(now: number): void {
    for (const [key, buffer] of this.inboundChunks) {
      if (now - buffer.receivedAt > DATA_CHANNEL_CHUNK_TTL_MS) {
        this.inboundChunks.delete(key)
      }
    }
  }

  private _sendSignal(payload: Record<string, unknown>): void {
    if (this.signalingWs?.readyState === WebSocket.OPEN) {
      this.signalingWs.send(JSON.stringify({ ...payload, fromPeerId: this.localPeerId }))
    }
  }

  // ── Heartbeat ──────────────────────────────────────────

  private _startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      // Use Promise to ensure heartbeat isn't blocked by CPU-intensive operations
      Promise.resolve().then(() => {
        const heartbeat = createMessage<HeartbeatPayload>('peer/heartbeat', this.localPeerId, {
          displayName: this.getDisplayName(),
          state: this.getLocalState(),
          acceptsRemoteTasks: this.getAcceptsRemote(),
        })
        this.broadcast(heartbeat)
      }).catch(e => console.warn('[P2P] Heartbeat error', e))
    }, HEARTBEAT_INTERVAL_MS)
  }

  private _startOfflineCheck(): void {
    this.offlineCheckTimer = setInterval(() => {
      const now = Date.now()
      for (const [peerId, entry] of this.peers) {
        if (now - entry.lastSeen > PEER_TIMEOUT_MS) {
          this._handlePeerDisconnect(peerId)
        }
      }
    }, HEARTBEAT_INTERVAL_MS)
  }

  private _handlePeerDisconnect(peerId: string): void {
    if (!this.peers.has(peerId)) return
    console.log(`[P2P] Peer offline: ${peerId}`)
    this.peers.delete(peerId)
    this._updateNetworkState()

    // Fire goodbye message locally so orchestrators can react
    const goodbye = createMessage<GoodbyePayload>('peer/goodbye', peerId, { reason: 'disconnect' })
    messageBus.receive(goodbye)

    this.offlineCallbacks.forEach((cb) => cb(peerId))
  }

  // ── Public API ─────────────────────────────────────────

  broadcast(msg: P2PMessage): void {
    const data = JSON.stringify(msg)
    for (const entry of this.peers.values()) {
      if (entry.channel?.readyState === 'open') {
        try { this._sendSerialized(entry.channel, data, msg.id) } catch { /* peer may be closing */ }
      }
    }
  }

  sendToPeer(peerId: string, msg: P2PMessage): boolean {
    const entry = this.peers.get(peerId)
    if (!entry || entry.channel?.readyState !== 'open') return false
    try {
      this._sendSerialized(entry.channel, JSON.stringify(msg), msg.id)
      return true
    } catch {
      return false
    }
  }

  private _sendSerialized(channel: RTCDataChannel, data: string, originalMessageId: string): void {
    if (data.length <= DATA_CHANNEL_CHUNK_SIZE) {
      channel.send(data)
      return
    }

    const total = Math.ceil(data.length / DATA_CHANNEL_CHUNK_SIZE)
    for (let index = 0; index < total; index += 1) {
      const chunk = createMessage<NetChunkPayload>('net/chunk', this.localPeerId, {
        originalMessageId,
        index,
        total,
        data: data.slice(index * DATA_CHANNEL_CHUNK_SIZE, (index + 1) * DATA_CHANNEL_CHUNK_SIZE),
      })
      channel.send(JSON.stringify(chunk))
    }
  }

  getConnectedPeers(): string[] {
    return [...this.peers.keys()]
  }

  getLocalPeerId(): string {
    return this.localPeerId
  }

  onPeerOffline(cb: PeerOfflineCallback): () => void {
    this.offlineCallbacks.add(cb)
    return () => this.offlineCallbacks.delete(cb)
  }

  broadcastStatus(state: PeerLocalState): void {
    const msg = createMessage('peer/status', this.localPeerId, {
      displayName: this.getDisplayName(),
      state,
      currentTaskIds: [],
      acceptsRemoteTasks: this.getAcceptsRemote(),
      reliabilityScore: 0.8,
    })
    this.broadcast(msg)
  }

  dispose(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.offlineCheckTimer) clearInterval(this.offlineCheckTimer)
    this.signalingWs?.close()
    for (const entry of this.peers.values()) {
      entry.channel?.close()
      entry.connection.close()
    }
    this.peers.clear()
  }
}

export const peerNetworkManager = new PeerNetworkManager()
