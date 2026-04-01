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
        const path = (args.path || args.file_path || args.filename || args.file) as string;
        if (!path) throw new Error('Missing parameter: path')
        const content = await fileSystemService.readFile(path)
        return { path, content }
      },
    },
    {
      name: 'write_file',
      description: 'Propose a code change (Draft). Parameters: { "path": string, "content": string }',
      async execute(args) {
        const path = (args.path || args.file_path || args.filename || args.file) as string;
        if (!path) throw new Error('Missing parameter: path')
        const content = (args.content || args.code || args.text) as string;
        
        const { editorService } = await import('@/core/services/EditorService')
        await editorService.proposeChange(path, content ?? '')
        
        return { success: true, path, note: 'Change proposed to user. Waiting for approval in the Editor Diff View.' }
      },
    },
    {
      name: 'create_file',
      description: 'Create a new empty file. Parameters: { "path": string, "content"?: string }',
      async execute(args) {
        const path = (args.path || args.file_path || args.filename || args.file) as string;
        if (!path) throw new Error('Missing parameter: path')
        await fileSystemService.createFile(path, (args.content as string) ?? '')
        return { success: true, path }
      },
    },
    {
      name: 'delete_file',
      description: 'Permanently delete a file. Parameters: { "path": string }',
      async execute(args) {
        const path = (args.path || args.file_path || args.filename || args.file) as string;
        if (!path) throw new Error('Missing parameter: path')
        await fileSystemService.deleteFile(path)
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
      name: 'search_files',
      description: 'Recursive search for a string across all project files (Grep-like). Parameters: { "query": string }',
      async execute(args) {
        const query = (args.query || args.text || args.pattern) as string;
        if (!query) throw new Error('Missing parameter: query')
        
        const allFiles = await fileSystemService.getTree()
        const results: { path: string; match: string }[] = []
        
        const search = async (node: FileNode) => {
          if (node.type === 'file') {
            const content = await fileSystemService.readFile(node.path)
            if (content.toLowerCase().includes(query.toLowerCase())) {
              const lines = content.split('\n')
              const matchLine = lines.find(l => l.toLowerCase().includes(query.toLowerCase()))
              results.push({ path: node.path, match: matchLine?.trim() || '' })
            }
          }
          for (const child of node.children || []) {
            await search(child)
          }
        }
        
        await search(allFiles)
        return { results: results.slice(0, 20) } // Limit to top 20 matches
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
  ]
}
