// ============================================================
// CORE SERVICES: ContextBuilder
// Constructs a minimal LLM context from only relevant sources.
// NEVER sends the full project — only active/open files + recent terminal output.
// ============================================================

import type { EditorTab } from '@/core/interfaces/IEditorService'
import type { ChatMessage } from '@/core/interfaces/IModelProvider'

export interface BuiltContext {
  messages: ChatMessage[]
  tokenEstimate: number
}

const MAX_FILE_CHARS = 4000
const MAX_TERMINAL_CHARS = 2000
const MAX_OPEN_FILES = 3

export class ContextBuilder {
  private recentTerminalOutput = ''
  private activeFile: EditorTab | null = null
  private openFiles: EditorTab[] = []

  setActiveFile(tab: EditorTab | null): void {
    this.activeFile = tab
  }

  setOpenFiles(tabs: EditorTab[]): void {
    this.openFiles = tabs
  }

  appendTerminalOutput(output: string): void {
    this.recentTerminalOutput = (this.recentTerminalOutput + '\n' + output).slice(-MAX_TERMINAL_CHARS)
  }

  clearTerminalOutput(): void {
    this.recentTerminalOutput = ''
  }

  buildWithHistory(history: { role: string; content: string }[], availableTools: string[]): BuiltContext {
    const systemPrompt = this._buildSystemPrompt(availableTools)
    const contextParts: string[] = []

    // 1. Technical Context (highest priority)
    if (this.activeFile) {
      const content = this.activeFile.content.slice(0, MAX_FILE_CHARS)
      contextParts.push(`## Active File: ${this.activeFile.path}\n\`\`\`${this.activeFile.language}\n${content}\n\`\`\``)
    }

    const otherTabs = this.openFiles
      .filter((t) => t.id !== this.activeFile?.id)
      .slice(0, MAX_OPEN_FILES)

    for (const tab of otherTabs) {
      const preview = tab.content.slice(0, 800)
      contextParts.push(`## Open File: ${tab.path}\n\`\`\`${tab.language}\n${preview}\n\`\`\``)
    }

    if (this.recentTerminalOutput.trim()) {
      contextParts.push(`## Recent Terminal Output\n\`\`\`\n${this.recentTerminalOutput.trim()}\n\`\`\``)
    }

    const contextBlock = contextParts.join('\n\n')

    // 2. ChatML Structure
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt }
    ]

    history.forEach((msg, idx) => {
      let content = msg.content
      // If it's the very first user message, prepend the technical context
      if (idx === 0 && msg.role === 'user') {
        content = `${contextBlock}\n\n${content}`
      }
      
      messages.push({
        role: (msg.role === 'tool' ? 'user' : msg.role) as 'user' | 'assistant' | 'system',
        content: msg.role === 'tool' ? `[Tool Result]: ${content}` : content
      })
    })

    // If the last message was assistant, ensure we end with a prompt to continue
    if (messages[messages.length - 1].role === 'assistant') {
      messages.push({ role: 'user', content: 'Continue the task.' })
    }

    const rawText = messages.map(m => m.content).join(' ')
    const tokenEstimate = Math.ceil(rawText.length / 4)

    return { messages, tokenEstimate }
  }

  build(userPrompt: string, availableTools: string[]): BuiltContext {
    const systemPrompt = this._buildSystemPrompt(availableTools)
    const contextParts: string[] = []

    // Active file (highest priority)
    if (this.activeFile) {
      const content = this.activeFile.content.slice(0, MAX_FILE_CHARS)
      contextParts.push(`## Active File: ${this.activeFile.path}\n\`\`\`${this.activeFile.language}\n${content}\n\`\`\``)
    }

    const otherTabs = this.openFiles
      .filter((t) => t.id !== this.activeFile?.id)
      .slice(0, MAX_OPEN_FILES)

    for (const tab of otherTabs) {
      const preview = tab.content.slice(0, 800)
      contextParts.push(`## Open File: ${tab.path}\n\`\`\`${tab.language}\n${preview}\n\`\`\``)
    }

    if (this.recentTerminalOutput.trim()) {
      contextParts.push(`## Recent Terminal Output\n\`\`\`\n${this.recentTerminalOutput.trim()}\n\`\`\``)
    }

    const contextBlock = contextParts.join('\n\n')
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `${contextBlock}\n\n## User Request\n${userPrompt}` }
    ]

    const tokenEstimate = Math.ceil((systemPrompt.length + contextBlock.length + userPrompt.length) / 4)

    return { messages, tokenEstimate }
  }

  private _buildSystemPrompt(tools: string[]): string {
    const toolList = tools.join(', ')
    return `You are Southstack AI, a Senior Software Engineer assistant. You are methodical, precise, and favor action over talk.
    
Your goal is to build, debug, and maintain complex projects. You have full access to the project filesystem and terminal.

Work Strategy:
1. **Explore & Plan**: Use 'get_file_tree' and 'search_files' to understand the project structure. If no files are in context, your FIRST action MUST be 'get_file_tree'.
2. **Execute with Approval**: When writing code, use 'write_file' to propose changes. The user will review them in a side-by-side Diff View.
3. **Verify**: After ANY modification, you MUST run a terminal command (e.g. 'npm test', 'gcc', 'node run') to verify that your changes work.
4. **Self-Correct**: If a command fails, read the terminal output, analyze the error, and propose a fix.

Rules:
- The project root is ALWAYS \`/\`. DO NOT use absolute OS paths like \`/home/gak.../\`. For a file named \`main.c\`, the path is simply \`/main.c\`.
- **NO PLACEHOLDERS**: Provide full, exact, and executable source code on every write. Summarization is prohibited.
- **AGENTIC JSON**: You MUST provide your plan and action in a SINGLE JSON block at the end of every message. This block is MANDATORY to trigger tools. The JSON block must match this EXACT schema:
 
\`\`\`json
{
  "plan": ["step 1", "step 2"],
  "current_step": "step 1",
  "action": { "tool": "tool_name", "input": { "key": "value" } },
  "status": "planning" | "executing" | "done" | "error"
}
\`\`\`

Available tools: ${toolList}`
  }
}

export const contextBuilder = new ContextBuilder()
