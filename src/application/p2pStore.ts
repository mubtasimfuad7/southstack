// ============================================================
// APPLICATION: P2P Zustand Store
// UI-facing state for the P2P panel.
// ============================================================

import { create } from 'zustand'
import type { PeerMetadata } from '@/infrastructure/p2p/types'
import type { ModelRouter } from '@/infrastructure/p2p/ModelRouter'

export type P2PRole = 'none' | 'host' | 'joiner'

export type P2PConnectionStatus =
  | 'disconnected'
  | 'starting'
  | 'listening'
  | 'connecting'
  | 'connected'
  | 'error'

export interface P2PLogEntry {
  id: string
  ts: number
  level: 'info' | 'warn' | 'error' | 'success'
  message: string
}

export interface P2PStoreState {
  // Connection state
  role: P2PRole
  status: P2PConnectionStatus
  selfPeerId: string
  selfMultiaddrs: string[]
  signalingUrl: string
  roomCode: string
  error: string | null

  // Peers
  peers: PeerMetadata[]

  // Log
  log: P2PLogEntry[]

  // Active inference
  isInferring: boolean
  activeProviderId: string | null
  activeRouter: ModelRouter | null // ModelRouter

  // Panel open state
  panelOpen: boolean

  // Actions
  setRole: (role: P2PRole) => void
  setStatus: (status: P2PConnectionStatus) => void
  setSelf: (peerId: string, addrs: string[]) => void
  setSignalingUrl: (url: string) => void
  setRoomCode: (code: string) => void
  setError: (err: string | null) => void
  addPeer: (peer: PeerMetadata) => void
  updatePeer: (peerId: string, patch: Partial<PeerMetadata>) => void
  removePeer: (peerId: string) => void
  setIsInferring: (v: boolean) => void
  setActiveProvider: (peerId: string | null) => void
  setActiveRouter: (router: ModelRouter | null) => void
  setPanelOpen: (v: boolean) => void
  appendLog: (entry: Omit<P2PLogEntry, 'id' | 'ts'>) => void
  clearLog: () => void
  reset: () => void
}

const initialState = {
  role: 'none' as P2PRole,
  status: 'disconnected' as P2PConnectionStatus,
  selfPeerId: '',
  selfMultiaddrs: [],
  signalingUrl: '',
  roomCode: '',
  error: null,
  peers: [] as PeerMetadata[],
  log: [] as P2PLogEntry[],
  isInferring: false,
  activeProviderId: null,
  activeRouter: null,
  panelOpen: false,
}

export const useP2PStore = create<P2PStoreState>((set) => ({
  ...initialState,

  setRole: (role) => set({ role }),
  setStatus: (status) => set({ status }),
  setSelf: (peerId, addrs) => set({ selfPeerId: peerId, selfMultiaddrs: addrs }),
  setSignalingUrl: (signalingUrl) => set({ signalingUrl }),
  setRoomCode: (roomCode) => set({ roomCode }),
  setError: (error) => set({ error }),
  setIsInferring: (isInferring) => set({ isInferring }),
  setActiveProvider: (activeProviderId) => set({ activeProviderId }),
  setActiveRouter: (activeRouter) => set({ activeRouter }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  clearLog: () => set({ log: [] }),

  addPeer: (peer) =>
    set((s) => ({
      peers: s.peers.some((p) => p.peerId === peer.peerId)
        ? s.peers.map((p) => (p.peerId === peer.peerId ? { ...p, ...peer, models: peer.models?.length ? peer.models : p.models } : p))
        : [...s.peers, peer],
    })),

  updatePeer: (peerId, patch) =>
    set((s) => ({
      peers: s.peers.map((p) => (p.peerId === peerId ? { ...p, ...patch } : p)),
    })),

  removePeer: (peerId) =>
    set((s) => ({ peers: s.peers.filter((p) => p.peerId !== peerId) })),

  appendLog: (entry) =>
    set((s) => ({
      log: [
        ...s.log.slice(-199), // keep last 200 entries
        { ...entry, id: `log-${Date.now()}-${Math.random()}`, ts: Date.now() },
      ],
    })),

  reset: () => set(initialState),
}))
