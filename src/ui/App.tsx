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
import { HorizontalSplit, VerticalSplit } from './components/SplitPane'
import { useTerminalStore, useFSStore, useAgentStore } from '@/application/store'
import { runtimeService } from '@/core/services/RuntimeService'
import { fileSystemService } from '@/core/services/FileSystemService'
import { RestorePrompt } from './components/RestorePrompt'
import { loadMeta } from '@/infrastructure/fs/idb-storage'

export function App() {
  const { agentPanelOpen, setAgentPanelOpen } = useAgentStore()
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

  const rightPanels = agentPanelOpen ? <AgentPanel /> : null

  return (
    <div className="flex flex-col h-screen w-screen bg-surface-400 overflow-hidden">
      {/* Top menu bar */}
      <MenuBar
        onToggleAgent={() => setAgentPanelOpen(!agentPanelOpen)}
        onToggleTerminal={() => setTerminalOpen(!terminalOpen)}
        agentPanelOpen={agentPanelOpen}
        terminalOpen={terminalOpen}
      />

      {showRestore && (
        <RestorePrompt
          onRestore={handleRestoreProject}
          onClear={handleClearProject}
          onClose={() => setShowRestore(false)}
        />
      )}

      {/* Main area */}
      <div className="flex-1 relative overflow-hidden min-h-0">
        <HorizontalSplit
          left={<FileExplorer />}
          right={centerColumn}
          initialLeftWidth={260}
          minLeft={180}
          maxLeft={450}
        />

        {/* Centered Large Command Center Overlay */}
        {agentPanelOpen && (
          <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in transition-all">
            <div 
              className="w-[90%] h-[90%] bg-panel border border-border shadow-[0_32px_64px_rgba(0,0,0,0.5)] rounded-2xl overflow-hidden flex animate-slide-up relative"
              onClick={(e) => e.stopPropagation()}
            >
              <AgentPanel />
            </div>
            {/* Click outside to close (optional but user might like it, though they have X) */}
            <div className="absolute inset-0 -z-10" onClick={() => setAgentPanelOpen(false)} />
          </div>
        )}
      </div>
    </div>
  )
}
