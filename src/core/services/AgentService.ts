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
import { contextBuilder } from './ContextBuilder'

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

    this._setStatus('planning')
    this._emit('user', userPrompt)

    // PROACTIVE GROUNDING: Inject the file tree into the first turn
    const { fileSystemService } = await import('./FileSystemService')
    const tree = await fileSystemService.getTree()
    const treeContext = `[Project Context]: Current file tree structure:\n${JSON.stringify(tree, null, 2).slice(0, 2000)}`
    
    this.history.push({ role: 'user', content: `${treeContext}\n\n[User Request]: ${userPrompt}` })

    try {
      await this._runLoop(userPrompt)
    } catch (err) {
      this._setStatus('error')
      this._emit('assistant', `Error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  pause(): void { this.isPaused = true }
  resume(): void { this.isPaused = false }
  stop(): void {
    this.isStopped = true
    this.modelProvider.abort()
    this._setStatus('idle')
  }

  getStatus(): AgentStatus { return this.status }
  getPlan(): AgentStep[] { return this.plan }
  getCurrentStep(): AgentStep | null { return this.plan[this.currentStepIndex] ?? null }

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

  private async _runLoop(userPrompt: string): Promise<void> {
    const MAX_ITERATIONS = 20
    let iterations = 0
    let lastResult: unknown = null

    while (iterations < MAX_ITERATIONS) {
      if (this.isStopped) return
      while (this.isPaused) {
        await this._sleep(200)
      }

      const toolDefinitions = this.getTools().map((t) => ({ name: t.name, description: t.description }))
      const context = contextBuilder.buildWithHistory(this.history, toolDefinitions)

      let rawResponse = ''
      this._setStatus(iterations === 0 ? 'planning' : 'executing')

      // Stream tokens to chat
      rawResponse = await this.modelProvider.generateStream(context.messages, (token) => {
        this._emit('assistant', token)
      })
      this.history.push({ role: 'assistant', content: rawResponse })

      // Parse response
      let agentResponse: AgentResponse
      try {
        agentResponse = this._parseResponse(rawResponse)
      } catch (err) {
        // If we fail to parse, but we have text, assume it's a "done" conversational response
        if (rawResponse.trim().length > 0) {
          agentResponse = {
            plan: [],
            current_step: '',
            action: { tool: 'none', input: {} },
            status: 'done'
          }
        } else {
          this._setStatus('error')
          this._emit('assistant', `⚠ Model returned empty/invalid response.`)
          return
        }
      }

      // Initialize plan on first iteration
      if (iterations === 0 && agentResponse.plan.length > 0) {
        this.plan = agentResponse.plan.map((desc, i) => ({
          id: `step-${i}`,
          description: desc,
          status: 'pending',
        }))
        this._emitPlan()
      }

      if (agentResponse.status === 'done') {
        this._setStatus('done')
        return
      }

      if (agentResponse.status === 'error') {
        this._setStatus('error')
        return
      }

      // Execute the action
      const tool = this.tools.get(agentResponse.action.tool)
      if (!tool) {
        const errorMsg = `Tool "${agentResponse.action.tool}" is not available. Choose from: ${Array.from(this.tools.keys()).join(', ')}`
        this.history.push({ role: 'user', content: errorMsg })
        iterations++
        continue
      }

      // Mark current step
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

        // REFLECT: tell model what happened
        this._setStatus('reflecting')
        const resultFeedback = `Action "${agentResponse.action.tool}" completed successfully. Result: ${JSON.stringify(lastResult).slice(0, 500)}`
        this.history.push({ role: 'user', content: resultFeedback })

      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)

        if (this.currentStepIndex >= 0) {
          this.plan[this.currentStepIndex].status = 'error'
          this.plan[this.currentStepIndex].error = errorMsg
          this._emitPlan()
        }

        // Feed error back to agent for self-correction
        const errorFeedback = `Action "${agentResponse.action.tool}" failed with error: ${errorMsg}. Analyze the error and try a different approach.`
        this.history.push({ role: 'user', content: errorFeedback })
      }

      iterations++
    }

    this._setStatus('done')
  }

  private _parseResponse(raw: string): AgentResponse {
    // Extract JSON block (```json ... ```)
    const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/)
    const rawJson = jsonMatch ? jsonMatch[1] : raw.match(/(\{[\s\S]*\})/)?.[1]

    if (!rawJson) {
      throw new Error('No JSON block found in response.')
    }

    const parsed = JSON.parse(rawJson.trim())

    if (!parsed.status) {
      throw new Error('Missing required field: status')
    }

    // Default action if omitted for 'done'
    if (!parsed.action && parsed.status === 'done') {
      parsed.action = { tool: 'none', input: {} }
    }

    if (!parsed.action && parsed.status !== 'done') {
      throw new Error('Missing required field: action')
    }

    if (parsed.action && !parsed.action.input) {
      parsed.action.input = {}
    }

    return parsed as AgentResponse
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
