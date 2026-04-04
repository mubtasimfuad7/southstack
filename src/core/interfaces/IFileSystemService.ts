// ============================================================
// CORE SERVICES LAYER: FileSystemService interface
// Contract that all FS implementations must satisfy
// ============================================================

import type { FileNode } from '@/infrastructure/fs/types'

export interface IFileSystemService {
  // Project management
  openFromLocalFS(): Promise<FileNode>
  syncToLocalFS(): Promise<void>
  hasLocalFSAccess(): boolean

  // Directory operations
  listDirectory(path: string): Promise<FileNode[]>
  getTree(): Promise<FileNode>

  // File operations
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  createFile(path: string, content?: string): Promise<void>
  deleteFile(path: string): Promise<void>
  moveFile(from: string, to: string): Promise<void>
  rename(path: string, newName: string): Promise<void>
  fileExists(path: string): Promise<boolean>

  // Watchers
  onFileChange(path: string, cb: (content: string) => void): () => void
}
