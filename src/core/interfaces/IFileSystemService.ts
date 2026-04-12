// ============================================================
// CORE SERVICES LAYER: FileSystemService interface
// Contract that all FS implementations must satisfy
// ============================================================

import type { FileNode, FileEntry } from '@/infrastructure/fs/types'

export interface IFileSystemService {
  // Project management
  openFromLocalFS(): Promise<FileNode>
  syncToLocalFS(): Promise<void>
  hasLocalFSAccess(): boolean

  // Directory operations
  listDirectory(path: string): Promise<FileNode[]>
  getTree(): Promise<FileNode>

  // File operations
  readFile(path: string): Promise<string | Uint8Array>
  writeFile(path: string, content: string | Uint8Array): Promise<void>
  createFile(path: string, content?: string | Uint8Array): Promise<void>
  deleteFile(path: string): Promise<void>
  moveFile(from: string, to: string): Promise<void>
  rename(path: string, newName: string): Promise<void>
  fileExists(path: string): Promise<boolean>

  // Watchers
  onFileChange(path: string, cb: (content: string | Uint8Array) => void): () => void
}
