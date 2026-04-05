// ============================================================
// FILE LOCKS: Write-lock registry to prevent concurrent writes
// Multiple readers allowed; only one writer per file
// ============================================================

class FileLocks {
  private locks = new Map<string, string>()  // path → subtaskId holding the write lock

  acquireLock(path: string, subtaskId: string): boolean {
    if (this.locks.has(path) && this.locks.get(path) !== subtaskId) {
      return false  // already locked by another subtask
    }
    this.locks.set(path, subtaskId)
    return true
  }

  releaseLock(path: string): void {
    this.locks.delete(path)
  }

  releaseBySubtask(subtaskId: string): void {
    for (const [path, owner] of this.locks) {
      if (owner === subtaskId) this.locks.delete(path)
    }
  }

  isLocked(path: string): boolean {
    return this.locks.has(path)
  }

  getHolder(path: string): string | undefined {
    return this.locks.get(path)
  }

  isHeldBy(path: string, subtaskId: string): boolean {
    return this.locks.get(path) === subtaskId
  }
}

export const fileLocks = new FileLocks()
