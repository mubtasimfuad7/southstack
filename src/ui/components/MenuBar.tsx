// ============================================================
// UI LAYER: MenuBar — top bar with project open/sync actions
// ============================================================

import { FolderOpen, Save, RefreshCw, Bot, Terminal, Settings, Shield, ShieldAlert, ShieldCheck, Layout } from 'lucide-react'
import { useFSStore } from '@/application/store'
import { fileSystemService } from '@/core/services/FileSystemService'
import { editorService } from '@/core/services/EditorService'

interface MenuBarProps {
  onToggleAgent: () => void
  onToggleTerminal: () => void
  onToggleUIBuilder: () => void
  agentPanelOpen: boolean
  terminalOpen: boolean
  uiBuilderOpen: boolean
}

export function MenuBar({ onToggleAgent, onToggleTerminal, onToggleUIBuilder, agentPanelOpen, terminalOpen, uiBuilderOpen }: MenuBarProps) {
  const { setProjectRoot, setLoading, setSyncing, setHasLocalAccess, isSyncing, isLoading } = useFSStore()

  async function handleOpenProject() {
    try {
      setLoading(true)
      const tree = await fileSystemService.openFromLocalFS()
      setProjectRoot(tree)
      setHasLocalAccess(true)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('Failed to open project:', err)
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleSyncToOS() {
    try {
      setSyncing(true)
      await editorService.saveAllTabs()
      await fileSystemService.syncToLocalFS()
    } catch (err) {
      console.error('Sync failed:', err)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="flex items-center justify-between h-10 px-3 bg-surface-200 border-b border-border select-none flex-shrink-0">
      {/* Left: Logo + project actions */}
      <div className="flex items-center gap-2">
        <span className="text-gradient font-bold text-sm tracking-wider mr-2">SOUTHSTACK</span>

        <button
          onClick={handleOpenProject}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors disabled:opacity-50"
          title="Open local project folder"
        >
          <FolderOpen size={13} />
          {isLoading ? 'Opening…' : 'Open Folder'}
        </button>

        <button
          onClick={handleSyncToOS}
          disabled={isSyncing || !fileSystemService.hasLocalFSAccess()}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors disabled:opacity-40"
          title="Sync browser edits back to local OS"
        >
          {isSyncing ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
          {isSyncing ? 'Syncing…' : 'Sync to Disk'}
        </button>
      </div>

      {/* Right: Toggle panels */}
      <div className="flex items-center gap-1">
        <div className="flex items-center px-2 py-1 rounded-full group relative cursor-help">
          {typeof window !== 'undefined' && window.crossOriginIsolated ? (
            <>
              <ShieldCheck size={13} className="text-success" />
              <span className="text-[10px] text-success ml-1 hidden lg:inline">Isolated</span>
              <div className="absolute top-8 left-1/2 -translate-x-1/2 w-48 p-2 bg-surface-300 border border-border rounded shadow-xl opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none text-[10px] text-text-secondary leading-normal">
                SharedArrayBuffer isolation is ACTIVE. WebContainer and AI will work correctly.
              </div>
            </>
          ) : (
            <>
              <ShieldAlert size={13} className="text-error" />
              <span className="text-[10px] text-error ml-1 hidden lg:inline">Non-Isolated</span>
              <div className="absolute top-8 left-1/2 -translate-x-1/2 w-64 p-2 bg-surface-300 border border-border rounded shadow-xl opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none text-[10px] text-text-secondary leading-normal">
                <p className="text-error font-bold mb-1">Isolation is DISABLED.</p>
                <p>WebContainer and AI will crash. Access the site via <span className="text-white font-bold underline">https://</span> even on local IP. If you see a certificate warning, click "Advanced" and then "Proceed".</p>
              </div>
            </>
          )}
        </div>

        <button
          onClick={onToggleUIBuilder}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors ${uiBuilderOpen ? 'text-secondary-400 bg-secondary-400/10' : 'text-text-secondary hover:text-text-primary hover:bg-white/5'
            }`}
          title="Toggle UI Builder"
        >
          <Layout size={13} />
          UI Builder
        </button>

        <button
          onClick={onToggleTerminal}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors ${terminalOpen ? 'text-accent-400 bg-accent-400/10' : 'text-text-secondary hover:text-text-primary hover:bg-white/5'
            }`}
          title="Toggle terminal"
        >
          <Terminal size={13} />
          Terminal
        </button>

        <button
          onClick={onToggleAgent}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors ${agentPanelOpen ? 'text-primary-300 bg-primary-400/10' : 'text-text-secondary hover:text-text-primary hover:bg-white/5'
            }`}
          title="Toggle AI & P2P Panel"
        >
          <Bot size={13} />
          AI & P2P
        </button>

        <div className="w-px h-4 bg-border mx-1" />

        <button className="p-1.5 rounded text-text-dim hover:text-text-secondary hover:bg-white/5 transition-colors">
          <Settings size={13} />
        </button>
      </div>
    </div>
  )
}
