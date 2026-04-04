// ============================================================
// UI LAYER: App.tsx — root layout assembly
// Layout:  [MenuBar]
//          [Explorer | Editor] [AgentPanel]
//                   [Terminal]
// ============================================================

import { useState, useEffect } from 'react'
import { MenuBar } from './components/MenuBar'
import { FileExplorer } from './components/FileExplorer'
import { EditorPane } from './components/EditorPane'
import { TerminalPanel } from './components/TerminalPanel'
import { AgentPanel } from './components/AgentPanel'
import { P2PPanel } from './components/P2PPanel'
import { HorizontalSplit, VerticalSplit } from './components/SplitPane'
import { useTerminalStore, useFSStore } from '@/application/store'
import { runtimeService } from '@/core/services/RuntimeService'
import { fileSystemService } from '@/core/services/FileSystemService'
import { RestorePrompt } from './components/RestorePrompt'
import { ToastContainer } from './components/Toast'
import { loadMeta } from '@/infrastructure/fs/idb-storage'

export function App() {
  const [agentPanelOpen, setAgentPanelOpen] = useState(true)
  const [p2pPanelOpen, setP2PPanelOpen] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.has('roomCode') || params.has('signal') || params.has('signalingUrl')
  })
  const [showRestore, setShowRestore] = useState(false)
  const { isOpen: terminalOpen, setOpen: setTerminalOpen } = useTerminalStore()
  const { projectRoot } = useFSStore()

  // Sync projectRoot to WebContainer
  useEffect(() => {
    async function syncFiles() {
      if (!projectRoot) return
      try {
        await runtimeService.syncRoot(projectRoot)
      } catch (err) {
        console.error('Failed to sync to WebContainer:', err)
      }
    }
    syncFiles()
  }, [projectRoot])

  // Check for existing session at startup
  useEffect(() => {
    async function checkSession() {
      // Check 1: Do we have a local OS handle?
      const handle = await loadMeta('rootDirHandle')
      
      // Check 2: Do we have any files in IndexedDB (virtual project)?
      const tree = await fileSystemService.getTree()
      const hasFiles = tree && tree.children && tree.children.length > 0

      if (handle || hasFiles) {
        setShowRestore(true)
      }
    }
    checkSession()
  }, [])

  async function handleRestoreProject() {
    try {
      // 1. Try to restore the OS handle (needs user permission click)
      const tree = await fileSystemService.restoreSession()
      
      // 2. Fallback: If no OS handle or permission denied, just load from IDB
      if (!tree) {
        const idbTree = await fileSystemService.getTree()
        useFSStore.getState().setProjectRoot(idbTree)
      }
      
      setShowRestore(false)
    } catch (err) {
      console.error('Restore failed:', err)
      setShowRestore(false)
    }
  }

  async function handleClearProject() {
    if (confirm('Are you sure? This will remove all files from the browser cache.')) {
      await fileSystemService.clearProject()
      setShowRestore(false)
    }
  }

  // Center column: Editor (top) + Terminal (bottom)
  const centerColumn = terminalOpen ? (
    <VerticalSplit
      top={<EditorPane />}
      bottom={<TerminalPanel />}
      bottomHeight={220}
      minBottom={80}
      maxBottom={500}
    />
  ) : (
    <EditorPane />
  )

  return (
    <div className="flex flex-col h-screen w-screen bg-surface-400 overflow-hidden">
      {/* Top menu bar */}
      <MenuBar
        onToggleAgent={() => setAgentPanelOpen((v) => !v)}
        onToggleTerminal={() => setTerminalOpen(!terminalOpen)}
        onToggleP2P={() => setP2PPanelOpen((v) => !v)}
        agentPanelOpen={agentPanelOpen}
        terminalOpen={terminalOpen}
        p2pPanelOpen={p2pPanelOpen}
      />

      {showRestore && (
        <RestorePrompt
          onRestore={handleRestoreProject}
          onClear={handleClearProject}
          onClose={() => setShowRestore(false)}
        />
      )}

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        <HorizontalSplit
          left={<FileExplorer />}
          right={
            <HorizontalSplit
              left={centerColumn}
              right={
                <>
                  {agentPanelOpen && <AgentPanel />}
                </>
              }
              primaryPane="right"
              initialRightWidth={agentPanelOpen ? 400 : 0}
              minRight={280}
              maxRight={1200}
            />
          }
          initialLeftWidth={260}
          minLeft={180}
          maxLeft={450}
        />
      </div>

      {/* P2P Popup Modal */}
      {p2pPanelOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative w-full max-w-[600px] h-[700px] max-h-[85vh] shadow-2xl rounded-xl border border-border overflow-hidden bg-surface-300">
            <P2PPanel onClose={() => setP2PPanelOpen(false)} />
          </div>
        </div>
      )}

      {/* Global Notifications */}
      <ToastContainer />
    </div>
  )
}
