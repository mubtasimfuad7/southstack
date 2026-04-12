// ============================================================
// INFRASTRUCTURE LAYER: FileSystem types
// Shared across all layers - pure data types only
// ============================================================

export type FileNodeType = 'file' | 'directory'

export interface FileNode {
  name: string
  path: string
  type: FileNodeType
  children?: FileNode[]
  size?: number
  lastModified?: number
}

export interface FileEntry {
  path: string
  content: string | Uint8Array
  lastModified: number
}

export interface DirectoryHandle {
  name: string
  kind: 'directory'
  handle: FileSystemDirectoryHandle
}
