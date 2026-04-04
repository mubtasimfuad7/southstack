// ============================================================
// UI LAYER: FileExplorer — left sidebar file tree
// ============================================================

import { useState } from 'react'
import {
  ChevronRight, ChevronDown, FolderOpen, Folder,
  FilePlus, Trash2, Edit3, FolderSearch, RefreshCw
} from 'lucide-react'
import type { FileNode } from '@/infrastructure/fs/types'
import { useFSStore, useEditorStore } from '@/application/store'
import { fileSystemService } from '@/core/services/FileSystemService'
import { editorService } from '@/core/services/EditorService'
import { runtimeService } from '@/core/services/RuntimeService'

const FILE_ICON_MAP: Record<string, string> = {
  ts: '🔷', tsx: '🔷', js: '🟡', jsx: '🟡', py: '🐍',
  php: '🐘', go: '🐹', rs: '🦀', html: '🌐', css: '🎨',
  json: '📋', md: '📝', sh: '⚡', env: '⚙️', yml: '⚙️', yaml: '⚙️',
}

function getIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return FILE_ICON_MAP[ext] ?? '📄'
}

interface FileTreeNodeProps {
  node: FileNode
  depth: number
}

function FileTreeNode({ node, depth }: FileTreeNodeProps) {
  const { expandedPaths, selectedPath, toggleExpanded, setSelectedPath, setProjectRoot } = useFSStore()
  const isExpanded = expandedPaths.has(node.path)
  const isSelected = selectedPath === node.path
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(node.name)

  async function handleClick() {
    setSelectedPath(node.path)
    if (node.type === 'directory') {
      toggleExpanded(node.path)
      return
    }
    try {
      const content = await fileSystemService.readFile(node.path)
      const tab = await editorService.openTab(node.path, content)
      useEditorStore.getState().setActiveTabId(tab.id)
      useEditorStore.getState().setTabs(editorService.getAllTabs())
    } catch (err) {
      console.error('Failed to open file:', err)
    }
  }

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm(`Delete "${node.name}"?`)) return
    await fileSystemService.deleteFile(node.path)
    const tree = await fileSystemService.getTree()
    setProjectRoot(tree)
  }

  async function handleRenameSubmit() {
    if (renameValue.trim() && renameValue !== node.name) {
      await fileSystemService.rename(node.path, renameValue.trim())
      const tree = await fileSystemService.getTree()
      setProjectRoot(tree)
    }
    setIsRenaming(false)
  }

  return (
    <div className="animate-fade-in">
      <div
        className={`flex items-center gap-1 py-0.5 px-2 cursor-pointer group rounded-sm transition-colors ${
          isSelected ? 'bg-primary-400/15 text-text-primary' : 'text-text-secondary hover:bg-white/5 hover:text-text-primary'
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleClick}
      >
        {node.type === 'directory' ? (
          <>
            <span className="text-text-dim w-3 flex-shrink-0">
              {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            </span>
            <span className="text-accent-400 w-3.5 flex-shrink-0">
              {isExpanded ? <FolderOpen size={13} /> : <Folder size={13} />}
            </span>
          </>
        ) : (
          <>
            <span className="w-3 flex-shrink-0" />
            <span className="text-xs flex-shrink-0">{getIcon(node.name)}</span>
          </>
        )}

        {isRenaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => { if (e.key === 'Enter') handleRenameSubmit(); if (e.key === 'Escape') setIsRenaming(false) }}
            className="flex-1 bg-surface-300 border border-primary-400/50 rounded px-1 text-xs text-text-primary outline-none"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="flex-1 text-xs truncate font-mono">{node.name}</span>
        )}

        {/* Hover actions */}
        <div className="hidden group-hover:flex items-center gap-0.5 ml-1">
          <button
            onClick={(e) => { e.stopPropagation(); setIsRenaming(true) }}
            className="p-0.5 rounded hover:bg-white/10 text-text-dim hover:text-text-secondary"
            title="Rename"
          >
            <Edit3 size={10} />
          </button>
          <button
            onClick={handleDelete}
            className="p-0.5 rounded hover:bg-error/20 text-text-dim hover:text-error"
            title="Delete"
          >
            <Trash2 size={10} />
          </button>
        </div>
      </div>

      {node.type === 'directory' && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeNode key={child.path} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

export function FileExplorer() {
  const { projectRoot, setProjectRoot, setLoading, setHasLocalAccess } = useFSStore()

  async function handleNewFile() {
    const name = prompt('New file name:')
    if (!name) return
    const path = name.startsWith('/') ? name : name
    await fileSystemService.createFile(path, '')
    const tree = await fileSystemService.getTree()
    setProjectRoot(tree)
  }

  async function handleOpenProject() {
    try {
      setLoading(true)
      const tree = await fileSystemService.openFromLocalFS()
      setProjectRoot(tree)
      setHasLocalAccess(true)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') console.error(err)
    } finally {
      setLoading(false)
    }
  }

  async function handleRefresh() {
    // Actually read the tree back from WebContainer if it's booted
    try {
      await runtimeService.boot()
      // Since fs.readdir is standard, we could build the tree from wc,
      // but for now just refresh the UI tree against the IDB model which 
      // is the SSOT for the UI right now.
      const tree = await fileSystemService.getTree()
      setProjectRoot(tree)
    } catch {
      // fallback
      const tree = await fileSystemService.getTree()
      setProjectRoot(tree)
    }
  }

  return (
    <div className="flex flex-col h-full bg-panel">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-shrink-0">
        <span className="text-xs font-semibold text-text-dim uppercase tracking-widest">Explorer</span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleNewFile}
            className="p-1 rounded text-text-dim hover:text-text-secondary hover:bg-white/5 transition-colors"
            title="New File"
          >
            <FilePlus size={13} />
          </button>
          <button
            onClick={handleRefresh}
            className="p-1 rounded text-text-dim hover:text-text-secondary hover:bg-white/5 transition-colors"
            title="Refresh Explorer"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Tree or Empty State */}
      <div className="flex-1 overflow-y-auto py-1">
        {projectRoot ? (
          <div>
            {projectRoot.children?.map((node) => (
              <FileTreeNode key={node.path} node={node} depth={0} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-4 text-center">
            <FolderSearch size={32} className="text-text-dim" />
            <div>
              <p className="text-xs text-text-secondary font-medium">No folder open</p>
              <p className="text-xs text-text-dim mt-1">Open a local project to start editing</p>
            </div>
            <button
              onClick={handleOpenProject}
              className="px-3 py-1.5 bg-primary-500/80 hover:bg-primary-400 text-white text-xs rounded-md transition-colors font-medium"
            >
              Open Folder
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
