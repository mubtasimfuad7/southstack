// ============================================================
// CORE SERVICES: ContextBuilderService implementation
// Professional-grade Context Engineering for AI Agent
// ============================================================

import type { EditorTab } from '@/core/interfaces/IEditorService'
import type { AgentContext } from '@/core/interfaces/IAgentService'
import { fileSystemService } from './FileSystemService'
import type { FileNode } from '@/infrastructure/fs/types'

export interface ContextState {
  userPrompt: string
  activeFile: EditorTab | null
  openTabs: EditorTab[]
  recentTerminalOutput: string
  history: { role: string; content: string }[]
}

const MAX_WINDOW_LINES = 100 // Lines above/below matched keyword

export class ContextBuilderService {
  private recentTerminalOutput = ''

  appendTerminalOutput(output: string): void {
    this.recentTerminalOutput = (this.recentTerminalOutput + '\n' + output).slice(-4000)
  }

  getTerminalOutput(): string {
    return this.recentTerminalOutput
  }
  /**
   * Main entry point: Orchestrates technical context collection
   */
  async buildContext(state: ContextState): Promise<AgentContext> {
    const keywords = this._extractKeywords(state.userPrompt)
    
    // 1. Identify relevant files using keywords and project structure
    const tree = await fileSystemService.getTree()
    const allPaths = this._flattenTree(tree)
    const relevantPaths = this._rankPaths(allPaths, keywords, state.activeFile?.path)

    // 2. Extract snippets (Chunking) from relevant files
    const relevantSnippets: string[] = []
    try {
      for (const path of relevantPaths.slice(0, 5)) { // Top 5 files
        const snippets = await this._extractChunks(path, keywords)
        if (snippets) relevantSnippets.push(snippets)
      }
    } catch (e) {
      console.warn('Failed to extract some snippets:', e)
    }

    const isCodingTask = this._isCodingIntent(state.userPrompt)

    return {
      userIntent: state.userPrompt,
      activeFile: (state.activeFile && isCodingTask) 
        ? `${state.activeFile.path}\n\n${state.activeFile.content.slice(0, 4000)}` 
        : (state.activeFile ? `[ACTIVE FILE PATH: ${state.activeFile.path}] (Full content hidden to prioritize chat)` : 'None'),
      openFiles: state.openTabs.map(t => t.path),
      relevantFiles: relevantPaths,
      relevantSnippets: isCodingTask ? relevantSnippets : [],
      terminalOutput: (state.recentTerminalOutput && isCodingTask) ? state.recentTerminalOutput.slice(-2000) : '',
    }
  }

  /**
   * Heuristic to stop the AI from 'peeking' at code during simple chat
   */
  private _isCodingIntent(prompt: string): boolean {
    const p = prompt.toLowerCase()
    const codingKeywords = [
      'fix', 'bug', 'code', 'file', 'run', 'create', 'add', 'make', 'update', 
      'change', 'program', 'script', 'error', 'wrong', 'help with', 'write'
    ]
    const isGreeting = /^(hi|hello|hey|greetings|thanks|thank you|morning|evening|bye|ok|okay)/i.test(p)
    if (isGreeting && p.split(' ').length < 4) return false
    return codingKeywords.some(k => p.includes(k)) || p.length > 30
  }

  /**
   * Formats the context into a structured system-ready string
   */
  format(ctx: AgentContext): string {
    const activeFilePath = ctx.activeFile.split('\n')[0]
    return `
<user_intent>
${ctx.userIntent}
</user_intent>

<active_file path="${activeFilePath}">
${ctx.activeFile}
</active_file>

<relevant_snippets>
${ctx.relevantSnippets.join('\n\n')}
</relevant_snippets>

<terminal_output>
${ctx.terminalOutput || 'No recent output.'}
</terminal_output>
`.trim()
  }

  // ──────────────────────────────────────────────────────────
  // Internal Relevance Engine
  // ──────────────────────────────────────────────────────────

  private _extractKeywords(prompt: string): string[] {
    // Basic stop-word filtering
    const stopWords = new Set(['fix', 'add', 'how', 'to', 'the', 'is', 'and', 'my', 'problem', 'bug'])
    return prompt.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w))
  }

  private _flattenTree(node: FileNode, paths: string[] = []): string[] {
    const ignored = new Set(['node_modules', 'dist', '.git', '.next', 'build'])
    if (ignored.has(node.name)) return paths

    if (node.type === 'file') paths.push(node.path)
    node.children?.forEach(c => this._flattenTree(c, paths))
    return paths
  }

  private _rankPaths(paths: string[], keywords: string[], activePath?: string): string[] {
    try {
      return paths
        .map(p => {
          let score = 0
          const lowerP = p.toLowerCase()
          keywords.forEach(k => {
            if (lowerP.includes(k)) score += 10
          })
          if (p === activePath) score += 5 // Active file priority
          return { path: p, score }
        })
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(x => x.path)
    } catch (e) {
      console.error('Error during path ranking:', e)
      return paths.slice(0, 5) // Fallback to first 5 files
    }
  }

  private async _extractChunks(path: string, keywords: string[]): Promise<string | null> {
    try {
      const content = await fileSystemService.readFile(path)
      const lines = content.split('\n')
      const matchedLines = new Set<number>()

      lines.forEach((line, i) => {
        const lowerLine = line.toLowerCase()
        if (keywords.some(k => lowerLine.includes(k))) {
          matchedLines.add(i)
        }
      })

      if (matchedLines.size === 0) return null

      // Combine nearby matches into ranges
      const ranges: [number, number][] = []
      const sortedMatches = [...matchedLines].sort((a, b) => a - b)
      
      let currentRange: [number, number] | null = null
      for (const idx of sortedMatches) {
        const start = Math.max(0, idx - MAX_WINDOW_LINES)
        const end = Math.min(lines.length - 1, idx + MAX_WINDOW_LINES)
        
        if (!currentRange) {
          currentRange = [start, end]
        } else if (start <= currentRange[1]) {
          currentRange[1] = end
        } else {
          ranges.push(currentRange)
          currentRange = [start, end]
        }
      }
      if (currentRange) ranges.push(currentRange)

      // Format blocks
      return ranges.map(([start, end]) => {
        const code = lines.slice(start, end + 1).join('\n')
        return `// File: ${path} (Lines ${start+1}-${end+1})\n${code}`
      }).join('\n\n---\n\n')

    } catch {
      return null
    }
  }
}

export const contextBuilderService = new ContextBuilderService()
