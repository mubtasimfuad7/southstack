// ============================================================
// PEER STATE STORE: Local + remote peer registry
// State machine: model_loading → idle → busy_self | busy_remote
// ============================================================

import { messageBus } from '@/core/network/messageBus'
import { peerNetworkManager } from '@/core/network/PeerNetworkManager'
import type {
  PeerLocalState,
  PeerCapabilities,
  HelloPayload,
  HeartbeatPayload,
  StatusPayload,
  GoodbyePayload,
} from '@/core/network/protocol'
import type { PeerStatus } from '@/core/tasks/taskTypes'

type StateChangeCallback = (state: PeerLocalState) => void
type PeerRegistryChangeCallback = (peers: Map<string, PeerStatus>) => void

class PeerStateStore {
  private localState: PeerLocalState = 'model_loading'
  private acceptsRemoteTasks = true
  private capabilities: PeerCapabilities = {
    modelName: 'unknown',
    maxConcurrentRemoteTasks: 1,
    supportedTools: [],
    protocolVersion: '0.1.0',
  }

  private remotePeers = new Map<string, PeerStatus>()
  private stateCallbacks = new Set<StateChangeCallback>()
  private registryCallbacks = new Set<PeerRegistryChangeCallback>()

  constructor() {
    this._subscribeToMessages()
  }

  // ── Message subscriptions ──────────────────────────────

  private _subscribeToMessages(): void {
    messageBus.on<HelloPayload>('peer/hello', (msg) => {
      const p = msg.payload
      this._upsertPeer({
        peerId: msg.fromPeerId,
        displayName: p.displayName,
        state: p.state,
        currentTaskIds: [],
        acceptsRemoteTasks: p.acceptsRemoteTasks,
        capabilities: p.capabilities,
        lastHeartbeat: Date.now(),
        reliabilityScore: 0.8,
      })
    })

    messageBus.on<HeartbeatPayload>('peer/heartbeat', (msg) => {
      const peer = this.remotePeers.get(msg.fromPeerId)
      if (peer) {
        this._upsertPeer({
          ...peer,
          state: msg.payload.state,
          acceptsRemoteTasks: msg.payload.acceptsRemoteTasks,
          lastHeartbeat: Date.now(),
        })
      } else {
        // New peer discovered via heartbeat before hello
        this._upsertPeer({
          peerId: msg.fromPeerId,
          displayName: msg.fromPeerId,
          state: msg.payload.state,
          currentTaskIds: [],
          acceptsRemoteTasks: msg.payload.acceptsRemoteTasks,
          capabilities: {
            modelName: 'unknown',
            maxConcurrentRemoteTasks: 1,
            supportedTools: [],
            protocolVersion: '0.1.0',
          },
          lastHeartbeat: Date.now(),
          reliabilityScore: 0.8,
        })
      }
    })

    messageBus.on<StatusPayload>('peer/status', (msg) => {
      const peer = this.remotePeers.get(msg.fromPeerId)
      if (peer) {
        this._upsertPeer({
          ...peer,
          state: msg.payload.state,
          currentTaskIds: msg.payload.currentTaskIds,
          acceptsRemoteTasks: msg.payload.acceptsRemoteTasks,
          reliabilityScore: msg.payload.reliabilityScore,
          lastHeartbeat: Date.now(),
        })
      }
    })

    messageBus.on<GoodbyePayload>('peer/goodbye', (msg) => {
      const peer = this.remotePeers.get(msg.fromPeerId)
      if (peer) {
        this._upsertPeer({ ...peer, state: 'offline', lastHeartbeat: Date.now() })
      }
    })
  }

  // ── Local state machine ────────────────────────────────

  setLocalState(state: PeerLocalState): void {
    const prev = this.localState
    this.localState = state
    if (prev !== state) {
      this.stateCallbacks.forEach((cb) => cb(state))
      peerNetworkManager.broadcastStatus(state)
    }
  }

  getLocalState(): PeerLocalState { return this.localState }
  
  setAcceptsRemoteTasks(v: boolean): void { this.acceptsRemoteTasks = v }
  getAcceptsRemoteTasks(): boolean { return this.acceptsRemoteTasks }

  setCapabilities(caps: PeerCapabilities): void { this.capabilities = caps }
  getCapabilities(): PeerCapabilities { return this.capabilities }

  // ── Remote peer registry ───────────────────────────────

  private _upsertPeer(status: PeerStatus): void {
    this.remotePeers.set(status.peerId, status)
    this.registryCallbacks.forEach((cb) => cb(new Map(this.remotePeers)))
  }

  markPeerOffline(peerId: string): void {
    const peer = this.remotePeers.get(peerId)
    if (peer) this._upsertPeer({ ...peer, state: 'offline' })
  }

  updatePeerReliability(peerId: string, succeeded: boolean): void {
    const peer = this.remotePeers.get(peerId)
    if (!peer) return
    const delta = succeeded ? 0.05 : -0.1
    const score = Math.max(0, Math.min(1, peer.reliabilityScore + delta))
    this._upsertPeer({ ...peer, reliabilityScore: score })
  }

  getRemotePeers(): Map<string, PeerStatus> { return new Map(this.remotePeers) }

  getPeer(peerId: string): PeerStatus | undefined { return this.remotePeers.get(peerId) }

  // ── Subscriptions ──────────────────────────────────────

  onLocalStateChange(cb: StateChangeCallback): () => void {
    this.stateCallbacks.add(cb)
    return () => this.stateCallbacks.delete(cb)
  }

  onRegistryChange(cb: PeerRegistryChangeCallback): () => void {
    this.registryCallbacks.add(cb)
    return () => this.registryCallbacks.delete(cb)
  }
}

export const peerStateStore = new PeerStateStore()
