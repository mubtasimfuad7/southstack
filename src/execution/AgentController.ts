// ============================================================
// EXECUTION: AgentController
// Deterministic step-based autonomous agent loop.
// Enforces: max steps, max tool calls, step timeout,
// total session timeout, and preemption checkpointing.
// ============================================================

import type { ModelProvider, ChatMessage } from '@/core/interfaces/IModelProvider'
import type { AgentTool } from '@/core/interfaces/IAgentService'
import type { AgentStepConfig, CheckpointData } from '@/infrastructure/p2p/types'
import { DEFAULT_AGENT_CONFIG } from '@/infrastructure/p2p/types'

// ──────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────

export type AgentStepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped'

export interface AgentStep {
  id: string
  description: string
  status: AgentStepStatus
  tool?: string
  input?: Record<string, unknown>
  result?: unknown
  error?: string
  startedAt?: number
  completedAt?: number
}

export interface ControllerAction {
  tool: string
  input: Record<string, unknown>
  description: string
}

export interface ControllerResponse {
  thinking: string
  plan: string[]
  current_step: string
  action: ControllerAction
  status: 'executing' | 'done' | 'error'
}

export type ControllerStatus =
  | 'idle'
  | 'planning'
  | 'executing'
  | 'validating'
  | 'fixing'
  | 'preempted'
  | 'done'
  | 'error'
  | 'cancelled'

type StatusListener  = (s: ControllerStatus) => void
type StepListener    = (steps: AgentStep[]) => void
type MessageListener = (msg: string, role: 'user' | 'assistant') => void
type TokenListener   = (token: string) => void

// ──────────────────────────────────────────────────────────
// AgentController
// ──────────────────────────────────────────────────────────

export class AgentController {
  private status: ControllerStatus = 'idle'
  private steps: AgentStep[] = []
  private tools = new Map<string, AgentTool>()

  private isCancelled = false
  private currentStepIndex = -1
  private stepTimeoutHandle: ReturnType<typeof setTimeout> | null = null
  private totalTimeoutHandle: ReturnType<typeof setTimeout> | null = null

  private statusListeners  = new Set<StatusListener>()
  private stepListeners    = new Set<StepListener>()
  private messageListeners = new Set<MessageListener>()
  private tokenListeners   = new Set<TokenListener>()

  private checkpoint: CheckpointData | null = null

  constructor(
    private modelProvider: ModelProvider,
    private config: AgentStepConfig = DEFAULT_AGENT_CONFIG
  ) {}

  // ──────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────

  registerTool(tool: AgentTool): void { this.tools.set(tool.name, tool) }
  getTools(): AgentTool[] { return [...this.tools.values()] }
  getStatus(): ControllerStatus { return this.status }
  getSteps(): AgentStep[] { return [...this.steps] }
  getCheckpoint(): CheckpointData | null { return this.checkpoint }

  cancel(): void {
    this.isCancelled = true
    this.modelProvider.abort()
    this._clearTimeouts()
    this._setStatus('cancelled')
  }

  onStatusChange(cb: StatusListener): () => void {
    this.statusListeners.add(cb)
    return () => this.statusListeners.delete(cb)
  }
  onStepUpdate(cb: StepListener): () => void {
    this.stepListeners.add(cb)
    return () => this.stepListeners.delete(cb)
  }
  onMessage(cb: MessageListener): () => void {
    this.messageListeners.add(cb)
    return () => this.messageListeners.delete(cb)
  }
  onToken(cb: TokenListener): () => void {
    this.tokenListeners.add(cb)
    return () => this.tokenListeners.delete(cb)
  }

  // ──────────────────────────────────────────────────────────
  // Run
  // ──────────────────────────────────────────────────────────

  async run(
    userPrompt: string,
    systemPrompt: string,
    fromCheckpoint?: CheckpointData
  ): Promise<void> {
    this.isCancelled = false
    this.steps = []
    this.currentStepIndex = -1
    this.checkpoint = null

    this._setStatus('planning')
    this._emit('user', userPrompt)

    // Total session timeout
    this.totalTimeoutHandle = setTimeout(() => {
      if (!this.isCancelled) {
        this._emit('assistant', '⏱ Session timed out.')
        this.cancel()
      }
    }, this.config.totalTimeoutMs)

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
    ]

    // Resume from checkpoint if provided
    if (fromCheckpoint) {
      messages.push(...fromCheckpoint.messages.slice(1)) // skip old system prompt
      this._emit('assistant', `♻️ Resuming from checkpoint (step ${fromCheckpoint.stepIndex})`)
    }

    messages.push({ role: 'user', content: userPrompt })

    try {
      await this._loop(messages)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this._setStatus('error')
      this._emit('assistant', `❌ Fatal: ${msg}`)
    } finally {
      this._clearTimeouts()
    }
  }

  // ──────────────────────────────────────────────────────────
  // Core deterministic loop
  // ──────────────────────────────────────────────────────────

  private async _loop(messages: ChatMessage[]): Promise<void> {
    let stepCount = 0
    let toolCallCount = 0

    while (stepCount < this.config.maxSteps) {
      if (this.isCancelled) break

      // Per-step timeout
      const stepDone = this._withStepTimeout()

      // Generate response
      let rawResponse = ''
      try {
        rawResponse = await this.modelProvider.generateStream(
          messages,
          (token) => {
            this.tokenListeners.forEach((cb) => cb(token))
            this._emit('assistant', token)
          }
        )
      } catch (err) {
        stepDone()
        throw err
      }
      stepDone()

      messages.push({ role: 'assistant', content: rawResponse })

      // Check if agent is done (no JSON action)
      if (!this._hasAction(rawResponse)) {
        this._setStatus('done')
        return
      }

      // Parse response
      let parsed: ControllerResponse
      try {
        parsed = this._parse(rawResponse)
      } catch (parseErr) {
        const errMsg = `Parse error: ${(parseErr as Error).message}`
        messages.push({ role: 'user', content: `[System] ${errMsg}. Re-respond with valid JSON.` })
        stepCount++
        continue
      }

      // Sync steps
      if (parsed.plan?.length > 0) {
        this._syncSteps(parsed.plan)
      }

      // Validate tool before execution
      const toolName = parsed.action?.tool
      if (!toolName || toolName === 'none') {
        if (parsed.status === 'done') {
          this._setStatus('done')
          return
        }
        stepCount++
        continue
      }

      // Check tool call limit
      if (toolCallCount >= this.config.maxToolCalls) {
        this._emit('assistant', `⚠️ Tool call limit (${this.config.maxToolCalls}) reached.`)
        this._setStatus('done')
        return
      }

      const tool = this.tools.get(toolName)
      if (!tool) {
        const errMsg = `Tool "${toolName}" not found. Available: ${[...this.tools.keys()].join(', ')}`
        messages.push({ role: 'user', content: `[Tool Error] ${errMsg}` })
        stepCount++
        continue
      }

      // Mark step running
      this._setStatus('executing')
      this._markStep(parsed.current_step, 'running', toolName, parsed.action.input)

      // Save checkpoint before each tool call
      this.checkpoint = {
        requestId: `agent-${Date.now()}`,
        messages: [...messages],
        tokensGenerated: '',
        toolHistory: [],
        stepIndex: stepCount,
        timestamp: Date.now(),
      }

      // Execute tool
      this._setStatus('executing')
      try {
        const result = await tool.execute(parsed.action.input)
        toolCallCount++
        this._markStep(parsed.current_step, 'done', toolName, parsed.action.input, result)

        const resultStr = JSON.stringify(result)?.slice(0, 2000) ?? 'Success'
        messages.push({ role: 'user', content: `[Tool:${toolName}] ${resultStr}` })

        if (parsed.action.tool === 'run_command' || parsed.action.tool === 'write_file') {
          this._setStatus('validating')
          await this._sleep(200)
        }
      } catch (toolErr) {
        const errMsg = toolErr instanceof Error ? toolErr.message : String(toolErr)
        this._setStatus('fixing')
        this._markStep(parsed.current_step, 'error', toolName, parsed.action.input, undefined, errMsg)
        messages.push({ role: 'user', content: `[Tool Error: ${toolName}] ${errMsg}. Analyze and fix.` })
      }

      if (parsed.status === 'done') {
        this._setStatus('done')
        return
      }

      stepCount++
    }

    this._emit('assistant', `⚠️ Step limit (${this.config.maxSteps}) reached.`)
    this._setStatus('done')
  }

  // ──────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────

  private _syncSteps(plan: string[]): void {
    this.steps = plan.map((desc, i) => {
      const existing = this.steps[i]
      return existing ?? {
        id: `step-${i}`,
        description: desc,
        status: 'pending' as AgentStepStatus,
      }
    })
    this.stepListeners.forEach((cb) => cb([...this.steps]))
  }

  private _markStep(
    desc: string,
    status: AgentStepStatus,
    tool?: string,
    input?: Record<string, unknown>,
    result?: unknown,
    error?: string
  ): void {
    const idx = this.steps.findIndex((s) => s.description === desc)
    if (idx >= 0) {
      this.steps[idx] = {
        ...this.steps[idx],
        status,
        tool,
        input,
        result,
        error,
        startedAt: status === 'running' ? Date.now() : this.steps[idx].startedAt,
        completedAt: status === 'done' || status === 'error' ? Date.now() : undefined,
      }
      this.stepListeners.forEach((cb) => cb([...this.steps]))
    }
  }

  private _hasAction(raw: string): boolean {
    return raw.includes('```json') || (raw.includes('{') && raw.includes('"action"'))
  }

  private _parse(raw: string): ControllerResponse {
    const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/)
    const rawJson = jsonMatch ? jsonMatch[1] : (raw.match(/(\{[\s\S]*\})/)?.[1] ?? raw)
    try {
      return JSON.parse(rawJson.trim()) as ControllerResponse
    } catch {
      // Attempt repair
      const repaired = rawJson.trim().replace(/"([^"]*)"/g, (_m, p1: string) =>
        `"${p1.replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`)
      return JSON.parse(repaired) as ControllerResponse
    }
  }

  private _withStepTimeout(): () => void {
    const handle = setTimeout(() => {
      if (!this.isCancelled) {
        this.modelProvider.abort()
        this._emit('assistant', `⏱ Step timed out after ${this.config.stepTimeoutMs}ms`)
      }
    }, this.config.stepTimeoutMs)
    this.stepTimeoutHandle = handle
    return () => clearTimeout(handle)
  }

  private _clearTimeouts(): void {
    if (this.stepTimeoutHandle) clearTimeout(this.stepTimeoutHandle)
    if (this.totalTimeoutHandle) clearTimeout(this.totalTimeoutHandle)
  }

  private _setStatus(s: ControllerStatus): void {
    this.status = s
    this.statusListeners.forEach((cb) => cb(s))
  }

  private _emit(role: 'user' | 'assistant', msg: string): void {
    this.messageListeners.forEach((cb) => cb(msg, role))
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms))
  }
}
