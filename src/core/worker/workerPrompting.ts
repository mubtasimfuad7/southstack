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
1. You MUST actually write code using the writeFile tool. Do not just describe it.
2. If TARGET FILES are listed, you MUST call writeFile for EACH file.
3. You can only write ONE file per response.
4. ONLY return "status": "done" AFTER you have successfully called writeFile for all files.

=== RESPONSE FORMAT ===
You must return ONLY valid JSON wrapped in \`\`\`json blocks. 

To call a tool (like writing a file):
\`\`\`json
{
  "action": {
    "tool": "writeFile",
    "input": {
      "path": "example.html",
      "content": "<h1>Hello</h1>"
    }
  }
}
\`\`\`

To finish the task (ONLY DO THIS AFTER WRITING FILES):
\`\`\`json
{
  "status": "done",
  "summary": "I wrote the files."
}
\`\`\`

CRITICAL: If you return "status": "done" without calling writeFile first, you will fail.`
}

export function buildWorkerMessages(subtask: Subtask, initiatorPeerId: string): ChatMessage[] {
  return [
    { role: 'system', content: buildWorkerSystemPrompt(subtask, initiatorPeerId) },
    { role: 'user', content: `Begin the subtask: ${subtask.title}\n\n${subtask.description}` },
  ]
}
