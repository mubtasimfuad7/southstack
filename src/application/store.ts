// ============================================================
// APPLICATION LAYER: Global Zustand stores
// ============================================================

import { create } from 'zustand'
import type { FileNode } from '@/infrastructure/fs/types'
import type { EditorTab } from '@/core/interfaces/IEditorService'
import type { AgentStatus, AgentStep } from '@/core/interfaces/IAgentService'

// ──────────────────────────────────────────────────────────
// FileSystem Store
// ──────────────────────────────────────────────────────────

interface FSState {
  projectRoot: FileNode | null
  expandedPaths: Set<string>
  selectedPath: string | null
  isLoading: boolean
  isSyncing: boolean
  hasLocalAccess: boolean
  setProjectRoot: (root: FileNode | null) => void
  toggleExpanded: (path: string) => void
  setSelectedPath: (path: string | null) => void
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
  needsConfirmation: boolean
  setStatus: (s: AgentStatus) => void
  setPlan: (steps: AgentStep[]) => void
  addMessage: (role: 'user' | 'assistant', content: string) => void
  appendToLastAssistantMessage: (token: string) => void
  setModelReady: (v: boolean) => void
  setModelProgress: (p: number, text: string) => void
  setAgentPanelOpen: (v: boolean) => void
  setNeedsConfirmation: (v: boolean) => void
}

export const useAgentStore = create<AgentState>((set) => ({
  status: 'idle',
  plan: [],
  messages: [],
  modelReady: false,
  modelProgress: 0,
  modelProgressText: '',
  agentPanelOpen: true,
  needsConfirmation: false,
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
  setModelReady: (v) => set({ modelReady: v }),
  setModelProgress: (p, text) => set({ modelProgress: p, modelProgressText: text }),
  setAgentPanelOpen: (v) => set({ agentPanelOpen: v }),
  setNeedsConfirmation: (v) => set({ needsConfirmation: v }),
}))
