// ============================================================
// TASK PLANNER: LLM-driven subtask decomposition
// Produces a dependency DAG of typed Subtask objects
// ============================================================

import type { ModelProvider, ChatMessage } from '@/core/interfaces/IModelProvider'
import type { Subtask } from './taskTypes'
import type { ToolName } from '@/core/network/protocol'

const ALL_TOOLS: ToolName[] = [
  'getProjectTree', 'listFiles', 'readFile', 'writeFile',
  'deleteFile', 'mkdir', 'moveFile', 'searchFiles',
]
const EXPLORATION_TOOLS = ['getProjectTree', 'listFiles', 'readFile', 'searchFiles']

export class TaskPlanner {
  constructor(private model: ModelProvider) {}

  async plan(
    prompt: string, 
    fileTreeContext: string, 
    rootTaskId: string, 
    initiatorPeerId: string,
    onProgress?: (progress: { tokenCount: number; elapsed: number; status: string; token: string }) => void
  ): Promise<Subtask[]> {
    const systemPrompt = `You are an expert task planner for a distributed coding agent system.
Your job is to decompose a user's coding task into a list of well-scoped subtasks that can be executed in parallel or sequence by different AI agents.

Before generating the final subtasks, you MUST explore the codebase to understand what needs to be done.
AVAILABLE EXPLORATION TOOLS: ${EXPLORATION_TOOLS.join(', ')}

To use a tool, return ONLY JSON in this format:
{
  "action": {
    "tool": "searchFiles",
    "input": {"query": "React"}
  }
}

Once you have enough context, generate the final subtasks. The output MUST be ONLY JSON in this format:
{
  "subtasks": [
    {
      "id": "st-1",
      "title": "short title",
      "description": "what to do (very detailed instructions)",
      "expectedOutput": "what the result should look like",
      "targetPaths": ["path/to/file.ts"],
      "allowedTools": ["readFile","writeFile","mkdir"],
      "dependencies": [],
      "lockedFiles": ["path/to/file.ts"]
    }
  ]
}

RULES:
- Each subtask must be atomic and independently executable.
- **FORCED DECOMPOSITION**: You MUST break down any substantial feature into at least 2-4 parallelizable subtasks.
- Declare explicit file targets in targetPaths.
- Use dependencies[] to declare ordering (IDs of subtasks that must complete first). Wait until ALL deps are completed.
- Keep lockedFiles to write-targets only.
- Always return valid JSON.

Current Project Structure Snapshot (First 1500 chars):
${fileTreeContext.slice(0, 1500)}`

    const messages: ChatMessage[] = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: `Decompose this task into subtasks:\n${prompt}` },
    ]

    let tokenCount = 0
    const startTime = Date.now()

    try {
      const { toolExecutor } = await import('@/core/tools/toolExecutor')
      
      for (let iteration = 0; iteration < 7; iteration++) {
        const raw = await this.model.generate(messages, { 
          maxTokens: 2000, 
          temperature: 0.2,
          onToken: (token: string) => {
            tokenCount++
            const elapsed = Date.now() - startTime
            onProgress?.({
              tokenCount,
              elapsed,
              status: `Planning (Iter ${iteration+1})`,
              token
            })
          }
        })
        
        messages.push({ role: 'assistant', content: raw })
        
        const parsed = this._extractJSON(raw)
        if (!parsed) {
           messages.push({ role: 'user', content: 'Invalid JSON. You must return exactly {"action": ...} or {"subtasks": ...}' })
           continue
        }
        
        if (parsed.subtasks) {
          return this._buildSubtasks(parsed.subtasks, rootTaskId, initiatorPeerId)
        }
        
        if (parsed.action) {
           try {
             const result = await toolExecutor.execute(parsed.action.tool, parsed.action.input || {}, `planner-${rootTaskId}`)
             messages.push({ role: 'user', content: `Tool result: ${JSON.stringify(result).slice(0, 2000)}` })
           } catch (e) {
             const errStr = e instanceof Error ? e.message : String(e)
             messages.push({ role: 'user', content: `Tool error: ${errStr}` })
           }
           continue
        }
        
        messages.push({ role: 'user', content: 'You must return either {"action": ...} or {"subtasks": ...}' })
      }
      
      return this._fallbackPlan(prompt, rootTaskId, initiatorPeerId)
      
    } catch (e) {
      console.error('[TaskPlanner] Model error', e)
      return this._fallbackPlan(prompt, rootTaskId, initiatorPeerId)
    }
  }

  private _extractJSON(raw: string): any | null {
    try {
      let jsonStr = ''
      const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/) ||
                        raw.match(/```\s*([\s\S]*?)\s*```/)
      if (jsonMatch) {
        jsonStr = jsonMatch[1]
      } else {
        const firstBrace = raw.indexOf('{')
        const lastBrace = raw.lastIndexOf('}')
        if (firstBrace !== -1 && lastBrace !== -1) {
          jsonStr = raw.substring(firstBrace, lastBrace + 1)
        } else {
          jsonStr = raw.trim()
        }
      }
      return JSON.parse(jsonStr)
    } catch {
      return null
    }
  }

  private _buildSubtasks(rawSubtasks: any[], rootTaskId: string, initiatorPeerId: string): Subtask[] {
    const now = Date.now()
    if (!Array.isArray(rawSubtasks) || rawSubtasks.length === 0) {
       return this._fallbackPlan('Extracted 0 subtasks', rootTaskId, initiatorPeerId)
    }
    
    return rawSubtasks.map((s) => ({
      id: s.id || `st-${Math.random().toString(36).slice(2, 8)}`,
      rootTaskId,
      initiatorPeerId,
      title: s.title || 'Untitled subtask',
      description: s.description || '',
      expectedOutput: s.expectedOutput || '',
      targetPaths: s.targetPaths ?? [],
      allowedTools: (s.allowedTools ?? ALL_TOOLS) as ToolName[],
      dependencies: s.dependencies ?? [],
      lockedFiles: s.lockedFiles ?? [],
      status: 'queued' as const,
      retryCount: 0,
      maxRetries: 2,
      createdAt: now,
      updatedAt: now,
    }))
  }

  private _fallbackPlan(prompt: string, rootTaskId: string, initiatorPeerId: string): Subtask[] {
    const now = Date.now()
    return [{
      id: `st-fallback-${Date.now()}`,
      rootTaskId,
      initiatorPeerId,
      title: 'Execute task',
      description: `Execute the following task:\n${prompt}\n\nRequirements:\n- Explore the codebase to understand what files to modify.\n- Use available tools to complete the task.\n- Confirm completion.`,
      expectedOutput: 'Task completed successfully',
      targetPaths: [],
      allowedTools: ALL_TOOLS,
      dependencies: [],
      lockedFiles: [],
      status: 'queued',
      retryCount: 0,
      maxRetries: 2,
      createdAt: now,
      updatedAt: now,
    }]
  }
}
