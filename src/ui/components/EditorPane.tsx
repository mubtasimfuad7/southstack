// ============================================================
// UI LAYER: EditorPane — Monaco editor + tab bar
// ============================================================

import { useEffect, useRef, useCallback } from 'react'
import MonacoEditor, { DiffEditor } from '@monaco-editor/react'
import { X, Circle, Check, ShieldAlert, Cpu, Zap } from 'lucide-react'
import type { editor } from 'monaco-editor'
import { useEditorStore, useAgentStore } from '@/application/store'
import { editorService } from '@/core/services/EditorService'
import type { EditorTab } from '@/core/interfaces/IEditorService'

function TabItem({ tab, isActive }: { tab: EditorTab; isActive: boolean }) {
  const { setActiveTabId, setTabs } = useEditorStore()

  function handleClick() {
    editorService.switchTab(tab.id)
    setActiveTabId(tab.id)
  }

  function handleClose(e: React.MouseEvent) {
    e.stopPropagation()
    editorService.closeTab(tab.id)
    setTabs(editorService.getAllTabs())
    const newActive = editorService.getActiveTab()
    setActiveTabId(newActive?.id ?? null)
  }

  return (
    <div
      className={`flex items-center gap-1.5 px-3 py-1.5 border-r border-border cursor-pointer flex-shrink-0 group transition-colors min-w-0 max-w-[160px] ${isActive
          ? 'bg-surface-300 text-text-primary border-t-2 border-t-primary-400'
          : 'bg-surface-200 text-text-secondary hover:bg-surface-300/50 hover:text-text-primary'
        }`}
      onClick={handleClick}
      title={tab.path}
    >
      {tab.isDirty && (
        <Circle size={6} className="fill-warning text-warning flex-shrink-0" />
      )}
      <span className="text-xs font-mono truncate">{tab.label}</span>
      <button
        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-white/10 flex-shrink-0 ml-auto"
        onClick={handleClose}
      >
        <X size={10} />
      </button>
    </div>
  )
}

export function EditorPane() {
  const { tabs, activeTabId, setTabs, setActiveTabId } = useEditorStore()
  const monacoRef = useRef<editor.IStandaloneCodeEditor | null>(null)

  useEffect(() => {
    const unsub1 = editorService.onTabsChange((t) => setTabs(t))
    const unsub2 = editorService.onActiveTabChange((tab) => {
      setActiveTabId(tab?.id ?? null)
    })
    return () => { unsub1(); unsub2() }
  }, [setTabs, setActiveTabId])

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (!activeTabId || value === undefined) return
      editorService.updateContent(activeTabId, value)
    },
    [activeTabId]
  )

  function handleEditorMount(editorInstance: editor.IStandaloneCodeEditor) {
    monacoRef.current = editorInstance
    // Configure Monaco theme
    editorInstance.updateOptions({
      minimap: { enabled: true },
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontLigatures: true,
      lineHeight: 20,
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorSmoothCaretAnimation: 'on',
      renderWhitespace: 'selection',
      bracketPairColorization: { enabled: true },
      padding: { top: 8, bottom: 8 },
    })
  }

  return (
    <div className="flex flex-col h-full bg-surface-300">
      {/* Tab Bar */}
      <div className="flex items-end bg-surface-200 border-b border-border overflow-x-auto flex-shrink-0 h-9">
        {tabs.length === 0 ? (
          <div className="flex items-center px-4 h-full text-xs text-text-dim">
            No files open — click a file in the explorer
          </div>
        ) : (
          tabs.map((tab) => (
            <TabItem key={tab.id} tab={tab} isActive={tab.id === activeTabId} />
          ))
        )}
      </div>

      {/* Editor */}
      <div className="flex-1 relative overflow-hidden">
        {activeTab ? (
          <>
            <MonacoEditor
              key={`standard-${activeTab.id}`}
              height="100%"
              language={activeTab.language}
              value={activeTab.content}
              theme="vs-dark"
              onChange={handleEditorChange}
              onMount={handleEditorMount}
              options={{
                automaticLayout: true,
                tabSize: 2,
                wordWrap: 'on',
              }}
            />
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center gap-4 select-none">
            <div className="w-16 h-16 rounded-2xl bg-surface-200 border border-border flex items-center justify-center animate-pulse shadow-inner">
               <Cpu size={32} className="text-secondary-400/50" />
            </div>
            <div>
              <p className="text-text-primary text-sm font-bold tracking-tight">SOUTHSTACK IDE</p>
              <p className="text-text-dim text-xs mt-1">Open a file from the sidebar to begin</p>
            </div>
            <div className="flex items-center gap-2 px-3 py-1 bg-surface-200 border border-border rounded-full">
              <Zap size={10} className="text-secondary-400" />
              <span className="text-[10px] text-text-secondary font-mono">Agentic & Peer-to-Peer Ready</span>
            </div>
          </div>
        )}
      </div>

      {/* Status bar */}
      {activeTab && (
        <div className="flex items-center justify-between px-3 h-5 bg-primary-500/80 text-white text-xs flex-shrink-0">
          <div className="flex items-center gap-3">
            <span>{activeTab.language}</span>
            {activeTab.isDirty && <span className="opacity-70">● Unsaved (auto-saving…)</span>}
          </div>
          <span className="opacity-70 font-mono text-[10px]">{activeTab.path}</span>
        </div>
      )}
    </div>
  )
}
