// ============================================================
// SNAPSHOTS: Pre-write file content snapshots for rollback
// ============================================================

class Snapshots {
  private store = new Map<string, string>()  // path → previous content

  async snapshotBefore(path: string): Promise<void> {
    if (this.store.has(path)) return  // already snapshotted
    try {
      const { fileSystemService } = await import('@/core/services/FileSystemService')
      const content = await fileSystemService.readFile(path)
      this.store.set(path, content)
    } catch {
      // File doesn't exist yet — snapshot as empty
      this.store.set(path, '')
    }
  }

  async rollback(path: string): Promise<boolean> {
    const previous = this.store.get(path)
    if (previous === undefined) return false
    try {
      const { fileSystemService } = await import('@/core/services/FileSystemService')
      await fileSystemService.writeFile(path, previous)
      this.store.delete(path)
      return true
    } catch {
      return false
    }
  }

  clearForSubtask(paths: string[]): void {
    for (const p of paths) this.store.delete(p)
  }
}

export const snapshots = new Snapshots()
