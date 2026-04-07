// ============================================================
// WORKER PROMPTING: System prompt builder for subtask execution
// ============================================================

import type { Subtask } from '@/core/tasks/taskTypes'
import type { ChatMessage } from '@/core/interfaces/IModelProvider'

export function buildWorkerSystemPrompt(subtask: Subtask, initiatorPeerId: string): string {
  const requiredFiles = subtask.targetPaths.length > 0 
    ? `You MUST write to these files: ${subtask.targetPaths.join(', ')}`
    : 'Create files as needed to complete the task'
  
  return `You are an autonomous coding agent working on behalf of peer ${initiatorPeerId}.
You have been assigned a specific subtask and MUST complete it using the available tools.

SUBTASK: ${subtask.title}
DESCRIPTION: ${subtask.description}
EXPECTED OUTPUT: ${subtask.expectedOutput}
TARGET FILES: ${requiredFiles}
ALLOWED TOOLS: ${subtask.allowedTools.join(', ')}

=== MANDATORY EXECUTION RULES ===
1. You MUST NOT just describe what to do - you MUST ACTUALLY CALL TOOLS
2. Use readFile to understand project structure and context FIRST
3. Use writeFile to create/modify ALL required files with COMPLETE content
4. EVERY file listed in TARGET FILES must be written via writeFile tool
5. CRITICAL: The system validates that you actually used writeFile - don't fake it
6. Respond with status "continue" for each tool call
7. Only respond with status "done" AFTER all writeFile calls are complete
8. When marking done, filesWritten MUST match the files you actually wrote

=== EXECUTION FLOW ===
If your task says "write to index.html":
1. First: Call readFile to check if it exists (optional)
2. Second: Call writeFile with path="index.html" and full content
3. Finally: Call with status "done" only after writeFile succeeds

=== RESPONSE FORMAT ===
ALWAYS use JSON in triple-backticks. THREE options only:

1. For tool calls (continue working):
\`\`\`json
{"status":"continue","action":{"tool":"writeFile","input":{"path":"index.html","content":"<html>...full content...</html>"}}}
\`\`\`

2. For completion (after all writeFile calls):
\`\`\`json
{"status":"done","summary":"Wrote index.html and styles.css","filesWritten":["index.html","styles.css"]}
\`\`\`

3. For failure:
\`\`\`json
{"status":"failed","reason":"Could not complete because..."}
\`\`\`

=== VALIDATION ===
The system will REJECT "status":"done" if:
- You claim to have written files but didn't call writeFile
- The filesWritten list doesn't match actual tool calls
- Required target files are missing

If rejected, you'll get feedback to try again. Keep iterating until all files are written.`
}

export function buildWorkerMessages(subtask: Subtask, initiatorPeerId: string): ChatMessage[] {
  return [
    { role: 'system', content: buildWorkerSystemPrompt(subtask, initiatorPeerId) },
    { role: 'user', content: `Begin the subtask: ${subtask.title}\n\n${subtask.description}` },
  ]
}
