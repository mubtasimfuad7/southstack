// ============================================================
// WORKER PROMPTING: System prompt builder for subtask execution
// ============================================================

import type { Subtask } from '@/core/tasks/taskTypes'
import type { ChatMessage } from '@/core/interfaces/IModelProvider'

export function buildWorkerSystemPrompt(subtask: Subtask, initiatorPeerId: string): string {
  return `You are an autonomous coding agent working on behalf of peer ${initiatorPeerId}.
You have been assigned a specific subtask and must complete it using the available tools.

SUBTASK: ${subtask.title}
DESCRIPTION: ${subtask.description}
EXPECTED OUTPUT: ${subtask.expectedOutput}
TARGET FILES: ${subtask.targetPaths.join(', ') || 'none specified'}
ALLOWED TOOLS: ${subtask.allowedTools.join(', ')}

RULES:
- Only modify files in targetPaths unless you have a very good reason
- Do not create files outside the project scope
- Use readFile to understand context before writing
- Use writeFile with full file content (not patches)
- When you are done, respond with JSON:
  { "status": "done", "summary": "what you did", "filesWritten": ["list of written paths"] }
- If you cannot complete the task, respond with:
  { "status": "failed", "reason": "why it failed" }

RESPONSE FORMAT:
Always wrap your action in a JSON block like this:
\`\`\`json
{
  "status": "continue",
  "action": { "tool": "readFile", "input": { "path": "src/index.ts" } }
}
\`\`\`
Or when done:
\`\`\`json
{ "status": "done", "summary": "Created the component", "filesWritten": ["src/Foo.tsx"] }
\`\`\``
}

export function buildWorkerMessages(subtask: Subtask, initiatorPeerId: string): ChatMessage[] {
  return [
    { role: 'system', content: buildWorkerSystemPrompt(subtask, initiatorPeerId) },
    { role: 'user', content: `Begin the subtask: ${subtask.title}\n\n${subtask.description}` },
  ]
}
