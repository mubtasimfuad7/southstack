// ============================================================
// APPLICATION LAYER: Global Zustand stores
// ============================================================

import { create } from 'zustand'
import type { FileNode } from '@/infrastructure/fs/types'
import type { EditorTab } from '@/core/interfaces/IEditorService'
import type { AgentStatus, AgentStep } from '@/core/interfaces/IAgentService'
import type { PeerStatus, RootTask, Subtask, ToolLogEntry } from '@/core/tasks/taskTypes'

// ──────────────────────────────────────────────────────────
// FileSystem Store
// ──────────────────────────────────────────────────────────

interface FSState {
  projectRoot: FileNode | null
  expandedPaths: Set<string>
  selectedPath: string | null
  explorerOpen: boolean
  isLoading: boolean
  isSyncing: boolean
  hasLocalAccess: boolean
  setProjectRoot: (root: FileNode | null) => void
  toggleExpanded: (path: string) => void
  setSelectedPath: (path: string | null) => void
  setExplorerOpen: (v: boolean) => void
  setLoading: (v: boolean) => void
  setSyncing: (v: boolean) => void
  setHasLocalAccess: (v: boolean) => void
  refreshProjectRoot: () => Promise<void>
  refreshSubtree: (path: string) => Promise<void>
}

export const useFSStore = create<FSState>((set, get) => ({
  projectRoot: null,
  expandedPaths: new Set<string>(),
  selectedPath: null,
  explorerOpen: true,
  isLoading: false,
  isSyncing: false,
  hasLocalAccess: false,
  setProjectRoot: (root) => set({ projectRoot: root }),
  toggleExpanded: (path) => {
    const expanded = new Set(get().expandedPaths)
    if (expanded.has(path)) expanded.delete(path)
    else expanded.add(path)
    set({ expandedPaths: expanded })
  },
  setSelectedPath: (path) => set({ selectedPath: path }),
  setExplorerOpen: (v) => set({ explorerOpen: v }),
  setLoading: (v) => set({ isLoading: v }),
  setSyncing: (v) => set({ isSyncing: v }),
  setHasLocalAccess: (v) => set({ hasLocalAccess: v }),
  refreshProjectRoot: async () => {
    const { fileSystemService } = await import('@/core/services/FileSystemService')
    const tree = await fileSystemService.getTree()
    set({ projectRoot: tree })
  },
  refreshSubtree: async (path: string) => {
    const { fileSystemService } = await import('@/core/services/FileSystemService')
    const newSubtree = await fileSystemService.refreshSubtree(path)
    if (!newSubtree) return

    set((state) => {
      if (!state.projectRoot) return state
      const newRoot = JSON.parse(JSON.stringify(state.projectRoot))
      
      const patch = (node: FileNode) => {
        if (node.path === path) {
          node.children = newSubtree.children
          return true
        }
        for (const child of node.children ?? []) {
          if (patch(child)) return true
        }
        return false
      }
      
      patch(newRoot)
      return { projectRoot: newRoot }
    })
  }
}))

// ──────────────────────────────────────────────────────────
// Editor Store
// ──────────────────────────────────────────────────────────

interface EditorState {
  tabs: EditorTab[]
  activeTabId: string | null
  setTabs: (tabs: EditorTab[]) => void
  setActiveTabId: (id: string | null) => void
}

export const useEditorStore = create<EditorState>((set) => ({
  tabs: [],
  activeTabId: null,
  setTabs: (tabs) => set({ tabs }),
  setActiveTabId: (id) => set({ activeTabId: id }),
}))

// ──────────────────────────────────────────────────────────
// Terminal Store
// ──────────────────────────────────────────────────────────

interface TerminalState {
  isOpen: boolean
  height: number
  activeSessionId: string | null
  setOpen: (v: boolean) => void
  setHeight: (h: number) => void
  setActiveSession: (id: string | null) => void
}

export const useTerminalStore = create<TerminalState>((set) => ({
  isOpen: true,
  height: 220,
  activeSessionId: null,
  setOpen: (v) => set({ isOpen: v }),
  setHeight: (h) => set({ height: h }),
  setActiveSession: (id) => set({ activeSessionId: id }),
}))

// ──────────────────────────────────────────────────────────
// Agent Store
// ──────────────────────────────────────────────────────────

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

interface AgentState {
  status: AgentStatus
  plan: AgentStep[]
  messages: ChatMessage[]
  modelReady: boolean
  modelProgress: number
  modelProgressText: string
  agentPanelOpen: boolean
  setStatus: (s: AgentStatus) => void
  setPlan: (steps: AgentStep[]) => void
  addMessage: (role: 'user' | 'assistant', content: string) => void
  appendToLastAssistantMessage: (token: string) => void
  isDistributed: boolean
  setDistributed: (v: boolean) => void
  setModelReady: (v: boolean) => void
  setModelProgress: (p: number, text: string) => void
  setAgentPanelOpen: (v: boolean) => void
}

export const useAgentStore = create<AgentState>((set, get) => ({
  status: 'idle',
  plan: [],
  messages: [],
  modelReady: false,
  modelProgress: 0,
  modelProgressText: '',
  agentPanelOpen: true,
  setStatus: (status) => set({ status }),
  setPlan: (plan) => set({ plan }),
  addMessage: (role, content) =>
    set((state) => ({
      messages: [
        ...state.messages,
        { id: `msg-${Date.now()}`, role, content, timestamp: Date.now() },
      ],
    })),
  appendToLastAssistantMessage: (token) =>
    set((state) => {
      const messages = [...state.messages]
      const last = messages[messages.length - 1]
      if (last && last.role === 'assistant') {
        messages[messages.length - 1] = { ...last, content: last.content + token }
      } else {
        messages.push({ id: `msg-${Date.now()}`, role: 'assistant', content: token, timestamp: Date.now() })
      }
      return { messages }
    }),
  isDistributed: true,
  setDistributed: (isDistributed) => set({ isDistributed }),
  setModelReady: (v) => set({ modelReady: v }),
  setModelProgress: (p, text) => set({ modelProgress: p, modelProgressText: text }),
  setAgentPanelOpen: (v) => set({ agentPanelOpen: v }),
}))

// ──────────────────────────────────────────────────────────
// Peer Store (P2P)
// ──────────────────────────────────────────────────────────

interface PeerStoreState {
  localPeerId: string
  localPeerName: string
  localState: string
  acceptsRemoteTasks: boolean
  peers: Map<string, PeerStatus>
  networkConnected: boolean
  setLocalPeerId: (id: string) => void
  setLocalPeerName: (name: string) => void
  setLocalState: (s: string) => void
  setAcceptsRemoteTasks: (v: boolean) => void
  setPeers: (peers: Map<string, PeerStatus>) => void
  setNetworkConnected: (v: boolean) => void
}

export const usePeerStore = create<PeerStoreState>((set) => ({
  localPeerId: '',
  localPeerName: '',
  localState: 'model_loading',
  acceptsRemoteTasks: true,
  peers: new Map(),
  networkConnected: false,
  setLocalPeerId: (id) => set({ localPeerId: id }),
  setLocalPeerName: (name) => set({ localPeerName: name }),
  setLocalState: (s) => set({ localState: s }),
  setAcceptsRemoteTasks: (v) => set({ acceptsRemoteTasks: v }),
  setPeers: (peers) => set({ peers }),
  setNetworkConnected: (v) => set({ networkConnected: v }),
}))

// ──────────────────────────────────────────────────────────
// P2P Task Store
// ──────────────────────────────────────────────────────────

interface P2PTaskState {
  rootTask: RootTask | null
  subtasks: Map<string, Subtask>
  remoteSubtask: Subtask | null     // subtask this peer is running for another
  setRootTask: (task: RootTask | null) => void
  setSubtasks: (subtasks: Map<string, Subtask>) => void
  setRemoteSubtask: (s: Subtask) => void
  clearRemoteSubtask: () => void
}

export const useP2PTaskStore = create<P2PTaskState>((set) => ({
  rootTask: null,
  subtasks: new Map(),
  remoteSubtask: null,
  setRootTask: (task) => set({ rootTask: task }),
  setSubtasks: (subtasks) => set({ subtasks }),
  setRemoteSubtask: (s) => set({ remoteSubtask: s }),
  clearRemoteSubtask: () => set({ remoteSubtask: null }),
}))

// ──────────────────────────────────────────────────────────
// Tool Log Store
// ──────────────────────────────────────────────────────────

const MAX_LOG_ENTRIES = 100

interface ToolLogState {
  entries: ToolLogEntry[]
  addEntry: (entry: ToolLogEntry) => void
  clearLog: () => void
}

export const useToolLogStore = create<ToolLogState>((set) => ({
  entries: [],
  addEntry: (entry) =>
    set((state) => ({
      entries: [entry, ...state.entries].slice(0, MAX_LOG_ENTRIES),
    })),
  clearLog: () => set({ entries: [] }),
}))
