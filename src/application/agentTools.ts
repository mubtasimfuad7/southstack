// ============================================================
// APPLICATION LAYER: Agent tools registration
// Wires all agent tools to services — single registration point
// ============================================================

import type { AgentTool } from '@/core/interfaces/IAgentService'
import { fileSystemService } from '@/core/services/FileSystemService'
import type { FileNode } from '@/infrastructure/fs/types'

export function buildAgentTools(): AgentTool[] {
  return [
    {
      name: 'read_file',
      description: 'Read the contents of a file. Parameters: { "path": string }',
      async execute(args) {
        const path = (args.path || args.file_path || args.filePath || args.filename || args.file) as string;
        if (!path) throw new Error('Missing parameter: path')
        const content = await fileSystemService.readFile(path)
        return { path, content }
      },
    },
    {
      name: 'read_file_range',
      description: 'Read a specific range of lines from a file. Parameters: { "path": string, "startLine": number, "endLine": number }',
      async execute(args) {
        const path = (args.path || args.file) as string;
        const start = parseInt(String(args.startLine || 1))
        const end = parseInt(String(args.endLine || 100))
        
        if (!path) throw new Error('Missing parameter: path')
        const content = await fileSystemService.readFile(path)
        const lines = content.split('\n')
        const slice = lines.slice(start - 1, end)
        
        return { 
          path, 
          lines: slice, 
          startLine: start, 
          endLine: Math.min(end, lines.length),
          totalLines: lines.length 
        }
      },
    },
    {
      name: 'write_file',
      description: 'Apply changes directly to a file. Parameters: { "path": string, "content": string }',
      async execute(args) {
        const path = (args.path || args.file_path || args.filePath || args.filename || args.file) as string;
        if (!path) throw new Error('Missing parameter: path')
        const content = (args.content || args.code || args.text || args.body) as string;
        
        // Direct write to filesystem (triggers sidebar refresh)
        try {
          await fileSystemService.writeFile(path, content ?? '')
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (msg.includes('EISDIR') || msg.includes('EEXIST')) {
            throw new Error(`Cannot write to "${path}" because it is a directory or already exists. Please choose a sub-file path (e.g. "${path}/index.js") or a different filename.`)
          }
          throw err
        }
        
        // Direct force update to Editor (bypass review)
        const { editorService } = await import('@/core/services/EditorService')
        editorService.updateContentFromExternal(path, content ?? '', true)
        
        return { success: true, path }
      },
    },
    {
      name: 'create_file',
      description: 'Create a new file and open it. Parameters: { "path": string, "content"?: string }',
      async execute(args) {
        const path = (args.path || args.file_path || args.filePath || args.filename || args.file) as string;
        if (!path) throw new Error('Missing parameter: path')
        const content = (args.content as string) ?? ''
        await fileSystemService.createFile(path, content)
        
        // Auto-open in editor
        const { editorService } = await import('@/core/services/EditorService')
        await editorService.openTab(path, content)
        
        return { success: true, path }
      },
    },
    {
      name: 'delete_file',
      description: 'Permanently delete a file. Parameters: { "path": string }',
      async execute(args) {
        const path = (args.path || args.file_path || args.filePath || args.filename || args.file) as string;
        if (!path) throw new Error('Missing parameter: path')
        await fileSystemService.deleteFile(path)
        
        // Auto-close in editor
        const { editorService } = await import('@/core/services/EditorService')
        editorService.closeTabByPath(path)
        
        return { success: true, path }
      },
    },
    {
      name: 'patch_file',
      description: 'Find and replace a specific block of text in a file. Parameters: { "path": string, "find": string, "replace": string }',
      async execute(args) {
        const path = (args.path || args.file) as string;
        if (!path) throw new Error('Missing parameter: path')
        const find = (args.find as string)
        const replace = (args.replace as string)
        
        const content = await fileSystemService.readFile(path)
        if (!content.includes(find)) {
          throw new Error(`The "find" text was not found in ${path}. Please ensure you use the EXACT characters (including spaces/indentation).`)
        }
        
        const newContent = content.replace(find, replace)
        await fileSystemService.writeFile(path, newContent)

        // Sync to Editor
        const { editorService } = await import('@/core/services/EditorService')
        editorService.updateContentFromExternal(path, newContent, true)

        return { success: true, path }
      },
    },
    {
      name: 'move_file',
      description: 'Move or rename a file. Parameters: { "from": string, "to": string }',
      async execute(args) {
        const from = (args.from || args.source) as string;
        const to = (args.to || args.destination) as string;
        if (!from || !to) throw new Error('Missing parameters: from, to')
        await fileSystemService.moveFile(from, to)
        return { success: true, from, to }
      },
    },
    {
      name: 'list_files',
      description: 'List files and directories at a given path. Parameters: { "path": string }',
      async execute(args) {
        const path = (args.path || args.dir || args.directory || '') as string;
        const nodes = await fileSystemService.listDirectory(path)
        return { path, nodes }
      },
    },
    {
      name: 'get_file_tree',
      description: 'Get the full file tree of the current project. Parameters: {}',
      async execute() {
        const tree = await fileSystemService.getTree()
        return { tree }
      },
    },
    {
      name: 'grep_search',
      description: 'Find all occurrences of a string or pattern across the project. Parameters: { "query": string }',
      async execute(args) {
        const query = (args.query || args.pattern) as string;
        if (!query) throw new Error('Missing parameter: query')
        
        const tree = await fileSystemService.getTree()
        const results: { path: string; line: number; content: string }[] = []
        
        const search = async (node: FileNode) => {
          if (node.type === 'file') {
            const content = await fileSystemService.readFile(node.path)
            const lines = content.split('\n')
            lines.forEach((l, i) => {
              if (l.toLowerCase().includes(query.toLowerCase())) {
                if (results.length < 50) {
                  results.push({ path: node.path, line: i + 1, content: l.trim() })
                }
              }
            })
          }
          for (const child of node.children || []) await search(child)
        }
        
        await search(tree)
        return { query, results }
      }
    },
    {
      name: 'run_command',
      description: 'Execute a terminal command (e.g. build, test, run). Parameters: { "command": string }',
      async execute(args) {
        const command = (args.command || args.cmd) as string;
        if (!command) throw new Error('Missing parameter: command')

        const { runtimeService } = await import('@/core/services/RuntimeService')
        const result = await runtimeService.executeCommand(command)

        // Also pipe to the visual terminal
        window.dispatchEvent(new CustomEvent('terminal:run', { detail: { command } }))

        // IMPORTANT: Pull changes back from WC immediately
        await fileSystemService.pullFromWebContainer()

        return result
      },
    },
    {
      name: 'analyze_project',
      description: 'Perform a static analysis scan of the project to find potential bugs or anti-patterns. Parameters: {}',
      async execute() {
        const tree = await fileSystemService.getTree()
        const results: { file: string; issues: string[] }[] = []
        
        const scan = async (node: FileNode) => {
          if (node.type === 'file') {
            const content = await fileSystemService.readFile(node.path)
            const issues: string[] = []
            
            // Basic heuristic scans
            if (content.includes('TODO') || content.includes('FIXME')) issues.push('Contains pending tasks (TODO/FIXME)')
            if (node.name.endsWith('.js') || node.name.endsWith('.ts')) {
              if (content.includes('console.log')) issues.push('Contains console.log statements')
              if (content.includes('any') && node.name.endsWith('.ts')) issues.push('Uses "any" type in TypeScript')
            }
            if (node.name.endsWith('.py')) {
              if (content.includes('print(')) issues.push('Contains print statements')
              if (!content.includes('import')) issues.push('No imports found in Python file')
            }

            if (issues.length > 0) results.push({ file: node.path, issues })
          }
          for (const child of node.children || []) await scan(child)
        }
        
        await scan(tree)
        return { summary: `Analyzed project. Found issues in ${results.length} files.`, details: results }
      }
    },
    {
      name: 'run_python',
      description: 'Execute Python code directly in the browser (OFFLINE). Parameters: { "code": string }',
      async execute(args) {
        const code = (args.code || args.script) as string
        if (!code) throw new Error('Missing parameter: code')

        try {
          // Dynamic import to keep main bundle small
          const { loadPyodide } = await import('pyodide')
          const pyodide = await (window as any)._pyodidePromise || ( (window as any)._pyodidePromise = loadPyodide({
            indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.0/full/' 
          }))
          
          const result = await (await pyodide).runPythonAsync(code)
          return { stdout: String(result), stderr: '', exitCode: 0 }
        } catch (err) {
          return { stdout: '', stderr: String(err), exitCode: 1 }
        }
      }
    }
  ]
}
