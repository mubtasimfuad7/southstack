// ============================================================
// TOOL EXECUTOR: Local tool execution with safety checks
// Path traversal validation, lock checks, snapshot-before-write
// ============================================================

import { fileSystemService } from '@/core/services/FileSystemService'
import { fileLocks } from './fileLocks'
import { snapshots } from './snapshots'
import type { ToolName } from '@/core/network/protocol'
import type { ToolLogEntry } from '@/core/tasks/taskTypes'

class ToolExecutor {
  private auditLog: ToolLogEntry[] = []

  async execute(
    tool: ToolName,
    args: Record<string, unknown>,
    subtaskId: string,
  ): Promise<unknown> {
    const entry: ToolLogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      at: Date.now(),
      tool,
      args,
      workerPeerId: 'local',
      subtaskId,
    }
    const start = Date.now()

    try {
      const result = await this._run(tool, args, subtaskId)
      entry.result = result
      entry.durationMs = Date.now() - start
      this._log(entry)
      return result
    } catch (err) {
      entry.error = err instanceof Error ? err.message : String(err)
      entry.durationMs = Date.now() - start
      this._log(entry)
      throw err
    }
  }

  private async _run(
    tool: ToolName,
    args: Record<string, unknown>,
    subtaskId: string,
  ): Promise<unknown> {
    switch (tool) {
      case 'getProjectTree': {
        const tree = await fileSystemService.getTree()
        return { tree }
      }

      case 'listFiles': {
        const path = this._safePath(args.path as string | undefined ?? '')
        const nodes = await fileSystemService.listDirectory(path)
        return { path, nodes }
      }

      case 'readFile': {
        const path = this._safePath(args.path as string)
        const content = await fileSystemService.readFile(path)
        return { path, content }
      }

      case 'writeFile': {
        const path = this._safePath(args.path as string)
        const content = args.content as string
        console.log(`[ToolExecutor] writeFile ENTER: path="${path}", contentLength=${content?.length || 0}, subtask=${subtaskId}`)
        if (content === undefined) throw new Error('writeFile: missing content')
        if (fileLocks.isLocked(path) && !fileLocks.isHeldBy(path, subtaskId)) {
          throw new Error(`File "${path}" is locked by another subtask`)
        }
        fileLocks.acquireLock(path, subtaskId)
        console.log(`[ToolExecutor] Lock acquired for ${path}`)
        await snapshots.snapshotBefore(path)
        console.log(`[ToolExecutor] Snapshot taken, now writing ${path} (${content.length} bytes)`)
        await fileSystemService.writeFile(path, content)
        console.log(`[ToolExecutor] writeFile SUCCESS: ${path}`)
        return { success: true, path, bytes: content.length }
      }

      case 'deleteFile': {
        const path = this._safePath(args.path as string)
        await fileSystemService.deleteFile(path)
        return { success: true, path }
      }

      case 'mkdir': {
        const path = this._safePath(args.path as string)
        await fileSystemService.createFile(`${path}/.keep`, '')
        return { success: true, path }
      }

      case 'moveFile': {
        const from = this._safePath(args.from as string)
        const to = this._safePath(args.to as string)
        await fileSystemService.moveFile(from, to)
        return { success: true, from, to }
      }

      case 'searchFiles': {
        const query = args.query as string
        if (!query) throw new Error('searchFiles: missing query')
        const tree = await fileSystemService.getTree()
        const results: { path: string; match: string }[] = []

        const search = async (node: { type: string; path: string; children?: typeof node[] }): Promise<void> => {
          if (node.type === 'file') {
            try {
              const content = await fileSystemService.readFile(node.path)
              if (content.toLowerCase().includes(query.toLowerCase())) {
                const line = content.split('\n').find((l) => l.toLowerCase().includes(query.toLowerCase()))
                results.push({ path: node.path, match: line?.trim() ?? '' })
              }
            } catch { /* skip unreadable files */ }
          }
          for (const child of node.children ?? []) await search(child)
        }

        await search(tree as Parameters<typeof search>[0])
        return { results: results.slice(0, 20) }
      }

      default:
        throw new Error(`Unknown tool: ${tool}`)
    }
  }

  // ── Safety ─────────────────────────────────────────────

  private _safePath(path: string): string {
    if (!path) throw new Error('Missing path argument')
    const normalized = path.replace(/\\/g, '/').replace(/\/+/g, '/')
    if (normalized.includes('..')) {
      throw new Error(`Path traversal detected: "${path}"`)
    }
    return normalized.startsWith('/') ? normalized.slice(1) : normalized
  }

  // ── Audit log ──────────────────────────────────────────

  private _log(entry: ToolLogEntry): void {
    this.auditLog.unshift(entry)
    if (this.auditLog.length > 200) this.auditLog.length = 200

    // Push to Zustand store for UI
    import('@/application/store').then(({ useToolLogStore }) => {
      useToolLogStore.getState().addEntry(entry)
    }).catch(() => {/* store may not be ready */})
  }

  getAuditLog(): ToolLogEntry[] { return [...this.auditLog] }
}

export const toolExecutor = new ToolExecutor()
