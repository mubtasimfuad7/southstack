// ============================================================
// CORE SERVICES LAYER: AgentService interface
// Manages AI lifecycle: planning, tool execution, reflection
// ============================================================

export type AgentStatus = 'idle' | 'planning' | 'awaiting_confirmation' | 'executing' | 'validating' | 'reflecting' | 'fixing' | 'done' | 'error'

export interface AgentTool {
  name: string
  description: string
  execute(input: Record<string, unknown>): Promise<unknown>
}

export interface AgentContext {
  userIntent: string
  activeFile: string
  openFiles: string[]
  relevantFiles: string[]
  relevantSnippets: string[]
  terminalOutput: string
}

export interface AgentAction {
  tool: string
  input: Record<string, unknown>
}

export interface AgentStep {
  id: string
  description: string
  action?: AgentAction
  result?: unknown
  status: 'pending' | 'running' | 'done' | 'error'
  error?: string
}

export interface AgentResponse {
  plan: string[]
  current_step: string
  action: AgentAction
  status: AgentStatus
}

export interface IAgentService {
  // Lifecycle
  start(userPrompt: string): Promise<void>
  confirm(): void
  cancel(): void
  pause(): void
  resume(): void
  stop(): void

  // State
  getStatus(): AgentStatus
  getPlan(): AgentStep[]
  getCurrentStep(): AgentStep | null

  // Tool registration
  registerTool(tool: AgentTool): void
  getTools(): AgentTool[]

  // Subscriptions
  onStatusChange(cb: (status: AgentStatus) => void): () => void
  onPlanUpdate(cb: (steps: AgentStep[]) => void): () => void
  onMessage(cb: (message: string, role: 'user' | 'assistant') => void): () => void
}
