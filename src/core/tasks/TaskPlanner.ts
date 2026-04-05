// ============================================================
// TASK PLANNER: LLM-driven subtask decomposition
// Produces a dependency DAG of typed Subtask objects
// ============================================================

import type { ModelProvider } from '@/core/interfaces/IModelProvider'
import type { Subtask } from './taskTypes'
import type { ToolName } from '@/core/network/protocol'

const ALL_TOOLS: ToolName[] = [
  'getProjectTree', 'listFiles', 'readFile', 'writeFile',
  'deleteFile', 'mkdir', 'moveFile', 'searchFiles',
]

export class TaskPlanner {
  constructor(private model: ModelProvider) {}

  async plan(prompt: string, fileTreeContext: string, rootTaskId: string, initiatorPeerId: string): Promise<Subtask[]> {
    const systemPrompt = `You are a task planner for a distributed coding agent system.
Your job is to decompose a user's coding task into a list of well-scoped subtasks that can be executed in parallel or sequence by different AI agents.

RULES:
- Each subtask must be atomic and independently executable.
- **FORCED DECOMPOSITION**: You MUST break down any substantial feature into at least 2-4 parallelizable subtasks. Do NOT return a single giant subtask if it can be split.
- Declare explicit file targets in targetPaths.
- Use dependencies[] to declare ordering (IDs of subtasks that must complete first).
- Subtasks with no dependencies run immediately in parallel.
- Subtasks with dependencies wait until ALL deps are completed.
- Keep lockedFiles to write-targets only.
- Always return valid JSON.

AVAILABLE TOOLS: ${ALL_TOOLS.join(', ')}

OUTPUT FORMAT (JSON only, no markdown):
{
  "subtasks": [
    {
      "id": "st-1",
      "title": "short title",
      "description": "what to do",
      "expectedOutput": "what the result should look like",
      "targetPaths": ["path/to/file.ts"],
      "allowedTools": ["readFile","writeFile","mkdir"],
      "dependencies": [],
      "lockedFiles": ["path/to/file.ts"]
    }
  ]
}

Current project structure:
${fileTreeContext.slice(0, 1500)}`

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: `Decompose this task into subtasks:\n${prompt}` },
    ]

    let raw = ''
    try {
      raw = await this.model.generate(messages, { maxTokens: 2000, temperature: 0.2 })
    } catch (e) {
      console.error('[TaskPlanner] Model error', e)
      return this._fallbackPlan(prompt, rootTaskId, initiatorPeerId)
    }

    return this._parse(raw, rootTaskId, initiatorPeerId)
  }

  private _parse(raw: string, rootTaskId: string, initiatorPeerId: string): Subtask[] {
    try {
      // Extract JSON - handle both raw JSON and markdown code blocks
      const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/) ||
                        raw.match(/```\s*([\s\S]*?)\s*```/) ||
                        raw.match(/(\{[\s\S]*\})/)
      const jsonStr = jsonMatch ? jsonMatch[1] : raw.trim()
      const parsed = JSON.parse(jsonStr)

      const rawSubtasks: Array<{
        id: string
        title: string
        description: string
        expectedOutput: string
        targetPaths?: string[]
        allowedTools?: string[]
        dependencies?: string[]
        lockedFiles?: string[]
      }> = parsed.subtasks ?? []

      const now = Date.now()
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
    } catch (e) {
      console.warn('[TaskPlanner] Failed to parse plan, using fallback', e)
      return this._fallbackPlan('Task from prompt', rootTaskId, initiatorPeerId)
    }
  }

  private _fallbackPlan(prompt: string, rootTaskId: string, initiatorPeerId: string): Subtask[] {
    const now = Date.now()
    return [{
      id: `st-fallback-${Date.now()}`,
      rootTaskId,
      initiatorPeerId,
      title: 'Execute task',
      description: prompt,
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
