// ============================================================
// CORE SERVICES: AgentService implementation
// PLAN → EXPAND → EXECUTE → REFLECT loop
// Fully tool-based, not conversational.
// ============================================================

import type {
  IAgentService,
  AgentStatus,
  AgentTool,
  AgentStep,
  AgentResponse,
} from '@/core/interfaces/IAgentService'
import type { ModelProvider } from '@/core/interfaces/IModelProvider'
import { contextBuilderService } from './ContextBuilderService'
import { editorService } from './EditorService'
import { fileSystemService } from './FileSystemService'

type StatusListener = (status: AgentStatus) => void
type PlanListener = (steps: AgentStep[]) => void
type MessageListener = (msg: string, role: 'user' | 'assistant') => void

export class AgentService implements IAgentService {
  private status: AgentStatus = 'idle'
  private plan: AgentStep[] = []
  private currentStepIndex = -1
  private tools: Map<string, AgentTool> = new Map()
  private isPaused = false
  private isStopped = false
  private confirmationResolver: ((v: boolean) => void) | null = null

  private statusListeners: Set<StatusListener> = new Set()
  private planListeners: Set<PlanListener> = new Set()
  private messageListeners: Set<MessageListener> = new Set()
  private history: { role: 'user' | 'assistant' | 'tool', content: string }[] = []

  constructor(private modelProvider: ModelProvider) { }

  // ──────────────────────────────────────────────────────────
  // Lifecycle
  // ──────────────────────────────────────────────────────────

  async start(userPrompt: string): Promise<void> {
    this.isStopped = false
    this.isPaused = false
    this.plan = []
    this.currentStepIndex = -1
    this.history = [] // CRITICAL: Fresh session

    this._setStatus('planning')
    this._emit('user', userPrompt)

    try {
      await this._runLoop(userPrompt)
    } catch (err) {
      this._setStatus('error')
      const errorMsg = err instanceof Error ? err.message : String(err)
      this._emit('assistant', `❌ CRITICAL ERROR: ${errorMsg}`)
    }
  }


  pause(): void { this.isPaused = true }
  resume(): void { this.isPaused = false }
  
  confirm(): void {
    if (this.confirmationResolver) {
      this.confirmationResolver(true)
      this.confirmationResolver = null
    }
  }

  cancel(): void {
    if (this.confirmationResolver) {
      this.confirmationResolver(false)
      this.confirmationResolver = null
    }
  }

  stop(): void {
    this.isStopped = true
    this.modelProvider.abort()
    this._setStatus('idle')
  }

  getStatus(): AgentStatus { return this.status }
  getPlan(): AgentStep[] { return this.plan }
  getCurrentStep(): AgentStep | null { return this.plan[this.currentStepIndex] ?? null }

  setModelProvider(provider: ModelProvider): void {
    this.modelProvider = provider
  }

  // ──────────────────────────────────────────────────────────
  // Tool registration
  // ──────────────────────────────────────────────────────────

  registerTool(tool: AgentTool): void {
    this.tools.set(tool.name, tool)
  }

  getTools(): AgentTool[] {
    return [...this.tools.values()]
  }

  // ──────────────────────────────────────────────────────────
  // Subscriptions
  // ──────────────────────────────────────────────────────────

  onStatusChange(cb: StatusListener): () => void {
    this.statusListeners.add(cb)
    return () => this.statusListeners.delete(cb)
  }

  onPlanUpdate(cb: PlanListener): () => void {
    this.planListeners.add(cb)
    return () => this.planListeners.delete(cb)
  }

  onMessage(cb: MessageListener): () => void {
    this.messageListeners.add(cb)
    return () => this.messageListeners.delete(cb)
  }

  // ──────────────────────────────────────────────────────────
  // Core loop: PLAN → EXECUTE → REFLECT
  // ──────────────────────────────────────────────────────────

  private async _runLoop(initialPrompt: string): Promise<void> {
    const MAX_ITERATIONS = 15
    let iterations = 0
    let lastResult: unknown = null
    this.history.push({ role: 'user', content: initialPrompt })

    // 1. Initial Context Collection
    const context = await contextBuilderService.buildContext({
      userPrompt: initialPrompt,
      activeFile: editorService.getActiveTab(),
      openTabs: editorService.getAllTabs(),
      recentTerminalOutput: contextBuilderService.getTerminalOutput(),
      history: this.history,
    })

    const toolNames = this.getTools().map((t) => t.name)
    const systemPrompt = this._buildUnifiedSystemPrompt(toolNames)
    
    // KV Cache compatible messages array
    const messages: {role: string, content: string}[] = [
      { role: 'system', content: systemPrompt },
      ...this.history.slice(0, -1).map(h => ({ 
        role: h.role === 'tool' ? 'user' : (h.role as 'user' | 'assistant'), 
        content: h.role === 'tool' ? `[Tool Result] ${h.content}` : h.content 
      })),
      { role: 'user', content: contextBuilderService.format(context) }
    ]

    while (iterations < MAX_ITERATIONS) {
      if (this.isStopped) return
      
      let rawResponse = ''
      // 2. LLM Generation
      rawResponse = await this.modelProvider.generateStream(messages as unknown as import("@/core/interfaces/IModelProvider").ChatMessage[], (token) => {
        this._emit('assistant', token)
      })
      
      this.history.push({ role: 'assistant', content: rawResponse })
      messages.push({ role: 'assistant', content: rawResponse })

      // 3. Response Analysis (Chat vs Action)
      const isJson = this._containsJson(rawResponse)
      
      if (!isJson) {
        this._setStatus('done')
        return
      }

      // Action mode: Parse JSON logic
      let agentResponse: AgentResponse
      try {
        agentResponse = this._parseResponse(rawResponse)
      } catch (e) {
        // AUTO-RETRY ON PARSE ERROR (Max 2 times)
        const retryMsg = `⚠ JSON Parsing Error: ${String(e)}. Please provide your response in valid JSON format using the specified schema.`
        this.history.push({ role: 'user', content: retryMsg })
        messages.push({ role: 'user', content: `[System Error] ${retryMsg}` })
        iterations++
        continue
      }

      // Plan Tracking (Sync plan on change)
      const hasPlan = agentResponse.plan && agentResponse.plan.length > 0
      if (hasPlan) {
        this.plan = agentResponse.plan.map((desc, i) => {
          const existing = this.plan[i]
          return {
            id: `step-${i}`,
            description: desc,
            status: existing?.status || 'pending',
            action: existing?.action,
            result: existing?.result,
            error: existing?.error
          }
        })
        this._emitPlan()
      }

      // HUMAN IN THE LOOP: Wait for confirmation if an action is planned and we haven't asked yet
      const hasAction = agentResponse.action && agentResponse.action.tool && agentResponse.action.tool !== 'none'
      
      if (hasAction && iterations === 0) {
        this._setStatus('awaiting_confirmation')
        const confirmed = await new Promise<boolean>((resolve) => {
          this.confirmationResolver = resolve
        })

        if (!confirmed) {
          this._emit('assistant', 'Action cancelled by user.')
          this._setStatus('done')
          return
        }
      }

      // Now set the status for actual work
      this._setStatus(iterations === 0 && !hasAction ? 'planning' : 'executing')
      
      if (hasAction) {
        const tool = this.tools.get(agentResponse.action.tool)
        if (!tool) {
          const errorMsg = `Tool "${agentResponse.action.tool}" is not available.`
          this.history.push({ role: 'user', content: errorMsg })
          messages.push({ role: 'user', content: `[Error] ${errorMsg}` })
          iterations++
          continue
        }

        // Mark current step running
        this.currentStepIndex = this.plan.findIndex((s) => s.description === agentResponse.current_step)
        if (this.currentStepIndex >= 0) {
          this.plan[this.currentStepIndex].status = 'running'
          this.plan[this.currentStepIndex].action = agentResponse.action
          this._emitPlan()
        }

        this._setStatus('executing')
        try {
          lastResult = await tool.execute(agentResponse.action.input)

          if (this.currentStepIndex >= 0) {
            this.plan[this.currentStepIndex].status = 'done'
            this.plan[this.currentStepIndex].result = lastResult
            this._emitPlan()
          }

          // REFLECT: Tell model what happened
          const resultStr = JSON.stringify(lastResult)
          const truncatedResult = resultStr ? resultStr.slice(0, 1500) : 'Success'
          const resultFeedback = `Action "${agentResponse.action.tool}" completed. Result:\n${truncatedResult}`
          
          this.history.push({ role: 'tool', content: resultFeedback })
          messages.push({ role: 'user', content: `[Tool Result]\n${resultFeedback}` })
          
          // Fast-Path Auto-Validation
          if (agentResponse.action.tool === 'run_command' || agentResponse.action.tool === 'write_file') {
            this._setStatus('validating')
          }

          // DIAGNOSTIC INJECTION: If run_command succeeded but has potential warnings, or failed
          // (Wait, if it failed, it goes to catch block. Let's handle it there).

          // SUCCESS FIX: Settle delay
          await this._sleep(300)

        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          this._setStatus('fixing')

          if (this.currentStepIndex >= 0) {
            this.plan[this.currentStepIndex].status = 'error'
            this.plan[this.currentStepIndex].error = errorMsg
            this._emitPlan()
          }

          let diagnosticContext = ''
          // Try to extract filename and line number from error (e.g. "at line 38 in file.py")
          const lineMatch = errorMsg.match(/line (\d+)/i)
          const fileMatch = errorMsg.match(/([\w.-]+\.(?:py|js|ts|cpp|h|c))/i)
          
          if (lineMatch && fileMatch) {
            try {
              const line = parseInt(lineMatch[1])
              const path = fileMatch[1]
              const content = await fileSystemService.readFile(path)
              const lines = content.split('\n')
              const start = Math.max(0, line - 5)
              const end = Math.min(lines.length, line + 5)
              const snippet = lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join('\n')
              diagnosticContext = `\n\n[CONTEXT] Found error at ${path}:${line}. Here is the code around that line:\n${snippet}`
            } catch {
              // Ignore if file read fails
            }
          }

          const errorFeedback = `Action "${agentResponse.action.tool}" failed with error: ${errorMsg}.${diagnosticContext}\n\nAnalyze the failure and apply a fix.`
          this.history.push({ role: 'user', content: errorFeedback })
          messages.push({ role: 'user', content: `[Tool Error]\n${errorFeedback}` })
        }
      }

      if (agentResponse.status === 'done') {
        this._setStatus('done')
        
        // FINAL DEBRIEF: Ask the model for a structured summary
        const debriefPrompt = `Task complete! Please provide a brief professional summary of:
1. What changes you made.
2. How you verified them.
3. Any future recommendations for the user.
Respond in plain text (No JSON).`
        
        messages.push({ role: 'user', content: debriefPrompt })
        await this.modelProvider.generateStream(messages as unknown as import('@/core/interfaces/IModelProvider').ChatMessage[], (token) => {
          this._emit('assistant', token)
        })
        
        return
      }

      if (agentResponse.status === 'error') {
        this._setStatus('error')
        return
      }

      iterations++
    }

    this._setStatus('done')
  }

  private _buildUnifiedSystemPrompt(toolNames: string[]): string {
    return `You are Southstack AI, a senior collaborative autonomous engineer. 

MODES of OPERATION:
- CHAT MODE: If the user is just saying hello, asking a question, or chatting, respond naturally in plain text. Do NOT use JSON.
- TASK MODE: If the user wants to fix a bug, run a command, or modify files, you MUST use the JSON SCHEMA below.

CORE PROTOCOLS:
1. DO NOT ECHO CONTEXT: Never repeat system metadata tags (like <user_intent>).
2. REFLECTION: For tasks, use the "thinking" field to justify your choice of tools.
3. CONSERVATIVE EXECUTION: Only use 'run_command' for building, testing, or verifying a fix. Analyze code first.
4. SELF-HEALING: If an action fails, analyze the [CONTEXT] and explain your new strategy in "thinking".

SCHEMA: When performing tasks, ALWAYS respond with a JSON block followed by a Markdown block for code:

\`\`\`json
{
  "thinking": "Your strategic analysis.", 
  "plan": ["step 1", "step 2"], 
  "current_step": "step description",
  "action": { "tool": "patch_file" | "write_file" | "none", "input": { "path": "..." } },
  "status": "executing" | "done"
}
\`\`\`

FOR CODE CHANGES:
1. Use 'patch_file' for existing files (fix line 31, etc.).
2. Use 'write_file' for new files.
3. Put the actual code in a standard Markdown block AFTER your JSON. Do NOT put the code inside the JSON string.
4. For 'patch_file', provide TWO blocks: First is the 'find' code, Second is the 'replace' code.

Available Tools: ${toolNames.join(', ')}
`
  }

  private _containsJson(raw: string): boolean {
    return raw.includes('```json') || (raw.includes('{') && raw.includes('}'))
  }

  private _parseResponse(raw: string): AgentResponse {
    const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/)
    const rawJson = jsonMatch ? jsonMatch[1] : (raw.match(/(\{[\s\S]*\})/)?.[1] || raw)

    const cleanJson = rawJson.trim()
    
    try {
      const parsed = JSON.parse(cleanJson) as AgentResponse
      
      // MARKDOWN CODE EXTRACTION: 
      // If the model provides code blocks AFTER the json, extract them.
      // We must ignore the first 'json' block which contains the plan.
      const blocksMatches = [...raw.matchAll(/```([\w+-]*)\n([\s\S]*?)\n```/g)]
      const codeBlocks = blocksMatches.filter((m) => m[1].toLowerCase() !== 'json').map((m) => m[2])
      
      if (codeBlocks.length >= 1 && parsed.action?.tool) {
        if (parsed.action.tool === 'write_file') {
          parsed.action.input.content = codeBlocks[0]
        } else if (parsed.action.tool === 'patch_file') {
          // If we find TWO code blocks, use first for 'find' and second for 'replace'
          if (codeBlocks.length >= 2) {
            parsed.action.input.find = codeBlocks[0]
            parsed.action.input.replace = codeBlocks[1]
          } else {
            parsed.action.input.replace = codeBlocks[0]
          }
        }
      }
      
      return parsed
    } catch {
      // Try to "repair" common LLM JSON errors (unescaped newlines in strings)
      try {
        const repaired = cleanJson.replace(/"([^"]*)"/g, (match, p1) => {
          return `"${p1.replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`
        })
        const parsed = JSON.parse(repaired)
        
        // Basic validation after repair
        if (!parsed.status) throw new Error('Missing "status" field.')
        if (!parsed.action && parsed.status === 'done') {
          parsed.action = { tool: 'none', input: {} }
        }
        
        return parsed as AgentResponse
      } catch (innerE) {
        console.error('JSON recovery failed:', innerE)
        throw new Error(`Invalid JSON format: ${innerE.message}. Please ensure you use valid JSON for tool calls.`)
      }
    }
  }

  private _setStatus(status: AgentStatus): void {
    this.status = status
    this.statusListeners.forEach((cb) => cb(status))
  }

  private _emit(role: 'user' | 'assistant', msg: string): void {
    this.messageListeners.forEach((cb) => cb(msg, role))
  }

  private _emitPlan(): void {
    this.planListeners.forEach((cb) => cb([...this.plan]))
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
