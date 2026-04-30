// ============================================================
// CORE SERVICES: RuntimeService implementation
// Boots and manages WebContainers (Node.js in the browser).
// ============================================================

import { WebContainer, WebContainerProcess } from '@webcontainer/api'
import type { FileNode } from '@/infrastructure/fs/types'
import { fileSystemService } from './FileSystemService'
import { toolchainService } from './ToolchainService'

export class RuntimeService {
  private instance: WebContainer | null = null
  private bootPromise: Promise<WebContainer> | null = null

  private dispatchBootStatus(message: string, type: 'info' | 'success' | 'error' = 'info') {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('webcontainer:boot-status', {
        detail: { message, type }
      }))
    }
  }

  async boot(): Promise<WebContainer> {
    if (this.instance) return this.instance
    if (this.bootPromise) return this.bootPromise

    this.bootPromise = (async () => {
      // Check for isolation before booting
      if (typeof window !== 'undefined' && !window.crossOriginIsolated) {
        throw new Error('Isolation check failed: Site is not cross-origin isolated. WebContainer requires COOP/COEP headers and MUST be accessed via localhost or https.')
      }

      // Boot WebContainer
      const wc = await WebContainer.boot()

      // Setup Toolchain (PHP, Rust, etc.)
      try {
        console.log('[RuntimeService] Initializing toolchain...')
        await toolchainService.setup(wc, (msg) => this.dispatchBootStatus(msg))
        
        // Ensure shims have execution permissions
        const chmod = await wc.spawn('chmod', ['+x', 
          'node_modules/.bin/php', 
          'node_modules/.bin/python', 
          'node_modules/.bin/ruby',
          'node_modules/.bin/rustc'
        ])
        await chmod.exit
        
        this.dispatchBootStatus('Toolchain Ready', 'success')
        console.log('[RuntimeService] Toolchain ready.')
      } catch (err) {
        this.dispatchBootStatus(`Failed to setup toolchain: ${err}`, 'error')
        console.error('Failed to setup toolchain', err)
      }

      // Attempt to sync the initial filesystem tree into WebContainer
      try {
        const tree = await fileSystemService.getTree()
        if (tree && tree.children && tree.children.length > 0) {
          await this.mountTree(wc, tree, '')
        }
      } catch (err) {
        console.warn('Failed to fully mount initial FS to WebContainer', err)
      }

      this.instance = wc
      return wc
    })()

    return this.bootPromise
  }

  async syncRoot(node: FileNode): Promise<void> {
    const wc = await this.boot()
    await this.mountTree(wc, node, '')
  }

  async spawnShell(): Promise<WebContainerProcess> {
    const wc = await this.boot()
    return await wc.spawn('jsh', {
      cwd: '/',
      terminal: {
        cols: 80,
        rows: 24,
      },
      env: {
        COLORTERM: 'truecolor',
        TERM: 'xterm-256color'
      }
    })
  }

  /**
   * Recursively scans the WebContainer filesystem and returns a FileNode tree.
   * Used to pull changes back from terminal (e.g. touch, mkdir) into Southstack.
   */
  async snapshotWebContainer(path = ''): Promise<FileNode | null> {
    const wc = await this.boot()
    try {
      const entries = await wc.fs.readdir(path || '/', { withFileTypes: true })
      const children: FileNode[] = []

      for (const entry of entries) {
        if (entry.name === '.webcontainer' || entry.name.startsWith('.') || entry.name === 'node_modules') continue

        const entryPath = path ? `${path}/${entry.name}` : entry.name

        if (entry.isDirectory()) {
          const subTree = await this.snapshotWebContainer(entryPath)
          if (subTree) children.push(subTree)
        } else {
          children.push({
            name: entry.name,
            path: entryPath,
            type: 'file'
          })
        }
      }

      return {
        name: path.split('/').pop() || 'root',
        path,
        type: 'directory',
        children: children.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
          return a.name.localeCompare(b.name)
        })
      }
    } catch (err) {
      console.warn(`Snapshot failed at ${path}:`, err)
      return null
    }
  }

  // Sync our FileNode tree into the WebContainer virtual filesystem
  async mountTree(wc: WebContainer, node: FileNode, targetPath: string): Promise<void> {
    if (node.type === 'directory') {
      // Create directory if targetPath is not empty (root is already created)
      if (targetPath) {
        await wc.fs.mkdir(targetPath, { recursive: true })
      }

      // Mount all children
      for (const child of node.children ?? []) {
        // Build child path: if targetPath is empty, it's just child.name
        const childPath = targetPath ? `${targetPath}/${child.name}` : child.name
        await this.mountTree(wc, child, childPath)
      }
    } else {
      // It's a file
      try {
        const content = await fileSystemService.readFile(node.path)
        await wc.fs.writeFile(targetPath, content)
      } catch (error) {
        console.warn(`Failed to mount file ${node.path}:`, error)
      }
    }
  }

  // Simplified one-off command execution for the agent tool
  async executeCommand(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const wc = await this.boot()

    // We launch it via jsh to handle complex stuff like piping
    const process = await wc.spawn('jsh', ['-c', command], {
      cwd: '/'
    })

    let stdout = ''
    let stderr = ''

    // Collect stdout
    process.output.pipeTo(new WritableStream({
      write(data) {
        stdout += data
      }
    }))

    const exitCode = await process.exit
    return { stdout, stderr, exitCode }
  }

  async readFileContent(path: string): Promise<string> {
    const wc = await this.boot()
    return await wc.fs.readFile(path, 'utf-8')
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    const wc = await this.boot()
    // Ensure parent directory exists
    const dir = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : ''
    if (dir) await wc.fs.mkdir(dir, { recursive: true })
    await wc.fs.writeFile(path, content)
  }

  async rm(path: string): Promise<void> {
    const wc = await this.boot()
    await wc.fs.rm(path, { recursive: true })
  }

  async mkdir(path: string): Promise<void> {
    const wc = await this.boot()
    await wc.fs.mkdir(path, { recursive: true })
  }
}

export const runtimeService = new RuntimeService()
