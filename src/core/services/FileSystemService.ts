// ============================================================
// CORE SERVICES: FileSystemService implementation
// Uses File System Access API for local OS mounting.
// Persists all edits to IndexedDB (browser storage).
// "Sync to Local OS" explicitly writes back to disk.
// ============================================================

import type { IFileSystemService } from '@/core/interfaces/IFileSystemService'
import type { FileNode, FileEntry } from '@/infrastructure/fs/types'
import { saveFile, loadFile, deleteFile as idbDelete, listAllFiles, saveMeta, loadMeta } from '@/infrastructure/fs/idb-storage'
import { useFSStore } from '@/application/store'

type WatcherMap = Map<string, Set<(content: string) => void>>

// IGNORED paths during directory scan
const IGNORED_NAMES = new Set(['.git', 'node_modules', '.DS_Store', 'dist', '.vite', '.next'])

export class FileSystemService implements IFileSystemService {
  private rootHandle: FileSystemDirectoryHandle | null = null
  private watchers: Map<string, Set<(content: string | Uint8Array) => void>> = new Map()

  // ──────────────────────────────────────────────────────────
  // Project management
  // ───────────────────────────`───────────────────────────────

  async openFromLocalFS(): Promise<FileNode> {
    const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' })
    this.rootHandle = dirHandle
    // Persist the handle so we can restore on reload
    await saveMeta('rootDirHandle', dirHandle)
    const tree = await this._buildTree(dirHandle, '')
    useFSStore.getState().setProjectRoot(tree)
    useFSStore.getState().setHasLocalAccess(true)

    // Sync to WebContainer immediately
    const { runtimeService } = await import('@/core/services/RuntimeService')
    await runtimeService.syncRoot(tree)

    return tree
  }

  async restoreSession(): Promise<FileNode | null> {
    const handle = await loadMeta('rootDirHandle')
    if (handle && (handle as FileSystemDirectoryHandle).kind === 'directory') {
      const dirHandle = handle as FileSystemDirectoryHandle
      // Request permission again (required by browsers for persistence)
      const status = await dirHandle.requestPermission({ mode: 'readwrite' })
      if (status === 'granted') {
        this.rootHandle = dirHandle
        const tree = await this._buildTree(dirHandle, '')
        useFSStore.getState().setProjectRoot(tree)
        useFSStore.getState().setHasLocalAccess(true)

        // Sync to WebContainer immediately
        const { runtimeService } = await import('@/core/services/RuntimeService')
        await runtimeService.syncRoot(tree)

        return tree
      }
    }
    return null
  }

  async clearProject(): Promise<void> {
    this.rootHandle = null
    await saveMeta('rootDirHandle', null)
    const allFiles = await listAllFiles()
    for (const f of allFiles) {
      await idbDelete(f.path)
    }
    useFSStore.getState().setProjectRoot(null)
    useFSStore.getState().setHasLocalAccess(false)
  }

  async syncToLocalFS(): Promise<void> {
    if (!this.rootHandle) {
      throw new Error('No local directory mounted. Open a project first.')
    }
    // Only write to disk when this manual sync is called
    const allFiles = await listAllFiles()
    for (const entry of allFiles) {
      await this._writeToHandle(this.rootHandle, entry.path, entry.content)
    }
  }

  async getTree(): Promise<FileNode> {
    if (this.rootHandle) {
      return this._buildTree(this.rootHandle, '')
    }
    // If no handle, fallback to IDB virtual structure
    const files = await listAllFiles()
    return this._buildTreeFromIDB(files)
  }

  async pullFromWebContainer(): Promise<void> {
    const { runtimeService } = await import('@/core/services/RuntimeService')
    const wcTree = await runtimeService.snapshotWebContainer()
    if (!wcTree) return

    const syncNode = async (node: FileNode) => {
      if (node.type === 'file') {
        const existing = await loadFile(node.path)
        // For now, always pull the latest from WC if it's new or we're in "terminal sync" mode
        // In a real app we'd compare SHAs or timestamps
        const content = await runtimeService.readFileContent(node.path)
        if (!existing || existing.content !== content) {
          await saveFile({ path: node.path, content, lastModified: Date.now() })
        }
      }
      for (const child of node.children ?? []) {
        await syncNode(child)
      }
    }

    await syncNode(wcTree)

    // Only update the store if the structure actually changed
    const currentRoot = useFSStore.getState().projectRoot

    // Fast comparison for UI update (flicker prevention)
    const oldStructure = JSON.stringify(currentRoot)
    const newStructure = JSON.stringify(wcTree)

    if (oldStructure !== newStructure) {
      useFSStore.getState().setProjectRoot(wcTree)

      // Also notify editor of potential content changes if files were updated on disk
      const { editorService } = await import('@/core/services/EditorService')
      const syncAll = async (node: FileNode) => {
        if (node.type === 'file') {
          const content = await runtimeService.readFileContent(node.path)
          editorService.updateContentFromExternal(node.path, content)
        }
        for (const child of node.children ?? []) await syncAll(child)
      }
      await syncAll(wcTree)
    }
  }

  async refreshSubtree(path: string): Promise<FileNode | null> {
    if (!this.rootHandle) return null
    try {
      const parts = path.split('/').filter(Boolean)
      let dir: FileSystemDirectoryHandle = this.rootHandle
      for (const part of parts) {
        dir = await dir.getDirectoryHandle(part)
      }
      return this._buildTree(dir, path)
    } catch (e) {
      console.warn('Failed to refresh subtree:', e)
      return null
    }
  }

  hasLocalFSAccess(): boolean {
    return this.rootHandle !== null
  }

  // ──────────────────────────────────────────────────────────
  // Directory operations
  // ──────────────────────────────────────────────────────────

  async listDirectory(path: string): Promise<FileNode[]> {
    const tree = await this.getTree()
    const node = this._findNode(tree, path)
    return node?.children ?? []
  }

  // ──────────────────────────────────────────────────────────
  // File operations
  // ──────────────────────────────────────────────────────────

  async readFile(path: string): Promise<string | Uint8Array> {
    // IDB first (has our edits)
    const entry = await loadFile(path)
    if (entry) return entry.content

    // Fallback: read from local FS handle
    if (this.rootHandle) {
      const content = await this._readFromHandle(this.rootHandle, path)
      // Cache it
      await saveFile({ path, content, lastModified: Date.now() })
      return content
    }

    throw new Error(`File not found: ${path}`)
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    console.log(`[FileSystemService] writeFile START: path="${path}", contentIsString=${typeof content === 'string'}`)
    try {
      await saveFile({ path, content, lastModified: Date.now() })
      console.log(`[FileSystemService] Saved to IndexedDB: ${path}`)
      this._notifyWatchers(path, content)

      // Write-through to runtime
      const { runtimeService } = await import('@/core/services/RuntimeService')
      await (runtimeService as any).writeFile(path, content)
      console.log(`[FileSystemService] Written to runtime: ${path}`)

      // Only refresh the parent directory subtree
      const parentDir = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : ''
      const fsStore = useFSStore.getState()
      if (fsStore.refreshSubtree) {
        await fsStore.refreshSubtree(parentDir)
        console.log(`[FileSystemService] Refreshed subtree: ${parentDir}`)
      }

      // RAG: re-index the updated file (fire-and-forget, non-blocking)
      if (typeof content === 'string' && content.length > 0) {
        import('@/core/services/RAGService').then(({ ragService }) => {
          ragService.indexFile(path, content).catch(() => {/* silent */})
        })
      }
    } catch (err) {
      console.error(`[FileSystemService] writeFile FAILED for ${path}:`, err)
      throw err
    }
  }

  async createFile(path: string, content: string | Uint8Array = ''): Promise<void> {
    await saveFile({ path, content, lastModified: Date.now() })

    const { runtimeService } = await import('@/core/services/RuntimeService')
    await runtimeService.writeFile(path, content)

    const parentDir = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : ''
    await useFSStore.getState().refreshSubtree(parentDir)
  }

  async deleteFile(path: string): Promise<void> {
    await idbDelete(path)

    // RAG: remove chunks for this file
    import('@/core/services/RAGService').then(({ ragService }) => {
      ragService.removeFile(path).catch(() => {/* silent */})
    })

    const { runtimeService } = await import('@/core/services/RuntimeService')
    try {
      await runtimeService.rm(path)
    } catch (e) {
      console.warn(`Failed to rm in runtime: ${path}`, e)
    }

    const parentDir = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : ''
    await useFSStore.getState().refreshSubtree(parentDir)
  }

  async moveFile(from: string, to: string): Promise<void> {
    const content = await this.readFile(from)
    await this.createFile(to, content)
    await this.deleteFile(from)
  }

  async rename(path: string, newName: string): Promise<void> {
    const parts = path.split('/')
    parts[parts.length - 1] = newName
    const newPath = parts.join('/')
    await this.moveFile(path, newPath)
  }

  async fileExists(path: string): Promise<boolean> {
    const entry = await loadFile(path)
    return entry !== undefined
  }

  // ──────────────────────────────────────────────────────────
  // Watchers
  // ──────────────────────────────────────────────────────────

  onFileChange(path: string, cb: (content: string | Uint8Array) => void): () => void {
    if (!this.watchers.has(path)) {
      this.watchers.set(path, new Set())
    }
    this.watchers.get(path)!.add(cb)
    return () => this.watchers.get(path)?.delete(cb)
  }

  private _notifyWatchers(path: string, content: string | Uint8Array): void {
    this.watchers.get(path)?.forEach((cb) => cb(content))
  }

  // ──────────────────────────────────────────────────────────
  // Internal helpers
  // ──────────────────────────────────────────────────────────

  private async _buildTree(dirHandle: FileSystemDirectoryHandle, basePath: string): Promise<FileNode> {
    const children: FileNode[] = []
    for await (const [name, handle] of dirHandle.entries()) {
      if (IGNORED_NAMES.has(name)) continue
      const path = basePath ? `${basePath}/${name}` : name
      if (handle.kind === 'directory') {
        const child = await this._buildTree(handle as FileSystemDirectoryHandle, path)
        children.push(child)
      } else {
        children.push({ name, path, type: 'file' })
      }
    }
    children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    const name = basePath.split('/').pop() ?? dirHandle.name
    return { name, path: basePath, type: 'directory', children }
  }

  private _buildTreeFromIDB(files: FileEntry[]): FileNode {
    const root: FileNode = { name: 'workspace', path: '', type: 'directory', children: [] }
    for (const file of files) {
      const parts = file.path.split('/').filter(Boolean)
      let current = root
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i]
        let dir = current.children?.find((c) => c.name === part && c.type === 'directory')
        if (!dir) {
          dir = { name: part, path: parts.slice(0, i + 1).join('/'), type: 'directory', children: [] }
          current.children = current.children ?? []
          current.children.push(dir)
        }
        current = dir
      }
      const fileName = parts[parts.length - 1]
      current.children = current.children ?? []
      current.children.push({ name: fileName, path: file.path, type: 'file' })
    }
    return root
  }

  private _findNode(tree: FileNode, path: string): FileNode | undefined {
    if (tree.path === path) return tree
    for (const child of tree.children ?? []) {
      const found = this._findNode(child, path)
      if (found) return found
    }
    return undefined
  }

  private async _readFromHandle(root: FileSystemDirectoryHandle, path: string): Promise<string | Uint8Array> {
    const parts = path.split('/').filter(Boolean)
    let dir: FileSystemDirectoryHandle = root
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i])
    }
    const fileHandle = await dir.getFileHandle(parts[parts.length - 1])
    const file = await fileHandle.getFile()

    // Detect binary files
    if (path.endsWith('.wasm')) {
      const buffer = await file.arrayBuffer()
      return new Uint8Array(buffer)
    }

    return file.text()
  }

  private async _writeToHandle(root: FileSystemDirectoryHandle, path: string, content: string | Uint8Array): Promise<void> {
    const parts = path.split('/').filter(Boolean)
    let dir: FileSystemDirectoryHandle = root
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i], { create: true })
    }
    const fileHandle = await dir.getFileHandle(parts[parts.length - 1], { create: true })
    const writable = await fileHandle.createWritable()
    await (writable as any).write(content)
    await (writable as any).close()
  }
}

// Singleton
export const fileSystemService = new FileSystemService()
