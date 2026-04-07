// ============================================================
// ORCHESTRATION AGENT: Codex/Claude-style stateful coordinator
// Maintains conversation history, reasons about task state,
// dynamically decides planning and execution strategies
// ============================================================

import type { ModelProvider, ChatMessage } from '@/core/interfaces/IModelProvider'
import type { Subtask, RootTask } from './taskTypes'
import { Scheduler } from './Scheduler'
import { leaseManager } from './leaseManager'
import { messageBus } from '@/core/network/messageBus'
import { peerStateStore } from '@/core/peers/PeerStateStore'
import { peerNetworkManager } from '@/core/network/PeerNetworkManager'
import { remoteToolBridge } from '@/core/tools/RemoteToolBridge'
import { fileSystemService } from '@/core/services/FileSystemService'
import { useFSStore } from '@/application/store'
import type { TaskProgressPayload, TaskResultPayload } from '@/core/network/protocol'
import { createMessage } from '@/core/network/protocol'

interface AgentState {
  phase: 'analyzing' | 'planning' | 'executing' | 'verifying' | 'complete'
  conversationHistory: ChatMessage[]
  subtasks: Map<string, Subtask>
  completedSubtasks: Set<string>
  failedSubtasks: Set<string>
  executionContext: Record<string, unknown>
}

type ChangeCallback = (rootTask: RootTask, subtasks: Map<string, Subtask>) => void

export class OrchestrationAgent {
  private rootTask: RootTask
  private model: ModelProvider
  private state: AgentState
  private scheduler: Scheduler
  private localPeerId: string
  private unsubs: Array<() => void> = []
  private changeCallbacks = new Set<ChangeCallback>()

  constructor(rootTask: RootTask, model: ModelProvider) {
    this.rootTask = rootTask
    this.model = model
    this.localPeerId = rootTask.ownerPeerId
    this.scheduler = new Scheduler(this.localPeerId)
    this.state = {
      phase: 'analyzing',
      conversationHistory: [],
      subtasks: new Map(),
      completedSubtasks: new Set(),
      failedSubtasks: new Set(),
      executionContext: {},
    }
  }

  // UI binding - compatible with old TaskOrchestrator
  onChange(cb: ChangeCallback): () => void {
    this.changeCallbacks.add(cb)
    return () => this.changeCallbacks.delete(cb)
  }

  private _emit(): void {
    this.changeCallbacks.forEach(cb => cb(this.rootTask, this.state.subtasks))
  }

  async orchestrate(): Promise<void> {
    remoteToolBridge.startHosting(this.localPeerId)
    peerStateStore.setLocalState('busy_self')

    try {
      // Phase 1: Analyze & Plan with LLM reasoning
      await this._analyzeAndPlan()

      // Phase 2: Execute with Orchestration
      await this._executeWithOrchestration()

      // Phase 3: Verify Results
      await this._verifyCompletion()
    } finally {
      remoteToolBridge.stopHosting()
      peerStateStore.setLocalState('idle')
    }
  }

  // Alias for UI compatibility
  async start(): Promise<void> {
    return this.orchestrate()
  }

  private async _analyzeAndPlan(): Promise<void> {
    this.state.phase = 'planning'
    this.rootTask.status = 'planning'
    this._emit()

    const tree = await fileSystemService.getTree()
    const treeContext = JSON.stringify(tree, null, 2).slice(0, 2000)

    // Initial system prompt with agent role
    const systemPrompt = this._buildSystemPrompt()

    // First turn: Analysis & decomposition
    this.state.conversationHistory.push({
      role: 'user',
      content: `PROJECT CONTEXT:\n${treeContext}\n\nTASK: ${this.rootTask.prompt}\n\nAnalyze this task and create an execution plan. Break it into subtasks that can be executed in parallel or sequence. For each subtask, specify:\n1. Description of work\n2. Files it will create/modify\n3. Dependencies on other subtasks\n4. Exact tool calls needed`,
    })

    const analysisResponse = await this.model.generate(
      [{ role: 'system', content: systemPrompt }, ...this.state.conversationHistory],
      { maxTokens: 3000, temperature: 0.3 }
    )

    console.log('[OrchestrationAgent] Analysis response:', analysisResponse.slice(0, 500))
    this.state.conversationHistory.push({ role: 'assistant', content: analysisResponse })

    // Parse the plan from assistant response
    await this._parseAndCreateSubtasks(analysisResponse)
    this.rootTask.subtaskIds = Array.from(this.state.subtasks.keys())

    // Follow-up for refinement if needed
    this.state.conversationHistory.push({
      role: 'user',
      content: 'Are there any dependencies or ordering constraints I should know about? Please refine if needed.',
    })

    const refinement = await this.model.generate(
      [{ role: 'system', content: systemPrompt }, ...this.state.conversationHistory],
      { maxTokens: 500, temperature: 0.3 }
    )

    this.state.conversationHistory.push({ role: 'assistant', content: refinement })

    console.log('[OrchestrationAgent] Planning complete. Subtasks:', this.state.subtasks.size)
    this.rootTask.status = 'running'
    this._emit()
  }

  private async _executeWithOrchestration(): Promise<void> {
    console.log('[OrchestrationAgent] Starting execution phase with', this.state.subtasks.size, 'subtasks')
    this.state.phase = 'executing'
    this.rootTask.status = 'running'
    this._emit()

    // Subscribe to task progress and results
    this._subscribeToTaskEvents()

    // Main execution loop
    const maxIterations = 60 // 60 * 5 seconds = 5 minutes timeout
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      if (this.state.completedSubtasks.size + this.state.failedSubtasks.size === this.state.subtasks.size) {
        console.log('[OrchestrationAgent] All subtasks complete')
        break
      }

      // Schedule pending subtasks
      this._scheduleAvailableSubtasks()
      this._emit()

      // Wait before next iteration
      await new Promise(resolve => setTimeout(resolve, 5000))
    }
  }

  private async _verifyCompletion(): Promise<void> {
    this.state.phase = 'verifying'
    this._emit()

    // Build context of what was completed
    const completionReport = this._buildCompletionReport()

    // Ask model to verify
    const systemPrompt = this._buildSystemPrompt()
    this.state.conversationHistory.push({
      role: 'user',
      content: `EXECUTION COMPLETE. Here's what was accomplished:\n\n${completionReport}\n\nPlease verify if the original task has been fully completed.`,
    })

    const verification = await this.model.generate(
      [{ role: 'system', content: systemPrompt }, ...this.state.conversationHistory],
      { maxTokens: 500, temperature: 0.2 }
    )

    console.log('[OrchestrationAgent] Verification:', verification)
    this.state.conversationHistory.push({ role: 'assistant', content: verification })

    // Sync files to local filesystem
    try {
      await fileSystemService.syncToLocalFS()
      const tree = await fileSystemService.getTree()
      useFSStore.getState().setProjectRoot(tree)
      console.log('[OrchestrationAgent] Files synced to filesystem')
    } catch (err) {
      console.warn('[OrchestrationAgent] Sync failed:', err)
    }

    this.state.phase = 'complete'
    this.rootTask.status = 'completed'
    this._emit()
  }

  private _buildSystemPrompt(): string {
    return `You are an advanced task orchestration agent similar to Claude or Codex.
Your role is to:
1. Understand complex tasks and break them into executable subtasks
2. Track execution progress and adapt strategy as needed
3. Verify that work meets requirements
4. Coordinate with distributed workers

You have access to:
- Project file structure and context
- Tool execution capabilities (readFile, writeFile, mkdir, etc.)
- Distributed peer workers for parallel execution
- Task tracking and monitoring

Guidelines:
- Be precise and methodical in task breakdown
- Include file paths and exact content expectations
- Think about execution order and dependencies
- Monitor progress and provide clear feedback
- Use structured JSON for task specifications
- Act as a supervisor ensuring quality output`
  }

  private async _parseAndCreateSubtasks(response: string): Promise<void> {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) ||
        response.match(/\{[\s\S]*\}/)
      
      if (!jsonMatch) {
        console.warn('[OrchestrationAgent] No JSON found in response, using fallback')
        return
      }

      const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0])
      const subtasks = parsed.subtasks || parsed.plan || []

      const now = Date.now()
      subtasks.forEach((s: any, idx: number) => {
        const subtask: Subtask = {
          id: `st-${Date.now()}-${idx}`,
          rootTaskId: this.rootTask.id,
          initiatorPeerId: this.localPeerId,
          title: s.title || s.name || `Subtask ${idx + 1}`,
          description: s.description || s.work || '',
          expectedOutput: s.expectedOutput || s.result || '',
          targetPaths: s.targetPaths || s.files || [],
          allowedTools: s.allowedTools || ['readFile', 'writeFile', 'mkdir', 'listFiles'],
          dependencies: s.dependencies || [],
          lockedFiles: s.targetPaths || s.files || [],
          status: 'queued',
          retryCount: 0,
          maxRetries: 2,
          createdAt: now,
          updatedAt: now,
        }
        this.state.subtasks.set(subtask.id, subtask)
      })

      console.log('[OrchestrationAgent] Created', this.state.subtasks.size, 'subtasks from plan')
    } catch (err) {
      console.error('[OrchestrationAgent] Failed to parse subtasks:', err)
    }
  }

  private _scheduleAvailableSubtasks(): void {
    for (const [id, subtask] of this.state.subtasks) {
      if (subtask.status === 'queued') {
        // Check dependencies
        const depsReady = (subtask.dependencies || []).every(depId => 
          this.state.completedSubtasks.has(depId)
        )

        if (depsReady) {
          subtask.status = 'assigned'
          this.scheduler.tick(this.rootTask, this.state.subtasks, (result) => {
            console.log('[OrchestrationAgent] Scheduling result:', result)
          })
        }
      }
    }
  }

  private _subscribeToTaskEvents(): void {
    this.unsubs.push(
      messageBus.on<TaskProgressPayload>('task/progress', (msg) => {
        const s = this.state.subtasks.get(msg.payload.subtaskId)
        if (!s) return
        console.log(`[OrchestrationAgent] Progress: ${s.title} = ${msg.payload.progress}%`)
      })
    )

    this.unsubs.push(
      messageBus.on<TaskResultPayload>('task/result', (msg) => {
        const s = this.state.subtasks.get(msg.payload.subtaskId)
        if (!s) return

        if (msg.payload.success) {
          s.status = 'completed'
          s.filesWritten = msg.payload.filesWritten
          this.state.completedSubtasks.add(msg.payload.subtaskId)
          console.log(`[OrchestrationAgent] Completed: ${s.title}`)
        } else {
          s.status = 'failed'
          this.state.failedSubtasks.add(msg.payload.subtaskId)
          console.warn(`[OrchestrationAgent] Failed: ${s.title}`)
        }
      })
    )
  }

  private _buildCompletionReport(): string {
    const completed = Array.from(this.state.completedSubtasks).map(id => {
      const s = this.state.subtasks.get(id)
      return `- ${s?.title}: ${s?.filesWritten?.join(', ') || 'completed'}`
    })

    const failed = Array.from(this.state.failedSubtasks).map(id => {
      const s = this.state.subtasks.get(id)
      return `- ${s?.title}: FAILED`
    })

    return `COMPLETED SUBTASKS (${this.state.completedSubtasks.size}):\n${completed.join('\n')}\n\n${failed.length > 0 ? `FAILED SUBTASKS (${this.state.failedSubtasks.size}):\n${failed.join('\n')}` : ''}`
  }
}
