// ============================================================
// SYNCHRONIZED PROMPTING: Unified prompt generation for
// both orchestrator and workers to ensure consistency
// ============================================================

import type { RootTask, Subtask } from './taskTypes'

export interface PromptContext {
  task: RootTask
  subtask?: Subtask
  executedSteps?: string[]
  errors?: string[]
  fileContext?: Record<string, string>
  availableTools?: string[]
}

/**
 * Core system instructions shared across all agents
 */
export function buildCoreSystemPrompt(): string {
  return `You are an advanced AI agent designed for task coordination and code generation.

CORE PRINCIPLES:
1. Think step-by-step before acting
2. Only use tools that are explicitly allowed
3. For file operations, always provide complete content (no patches)
4. Track what you've done and what remains
5. Fail fast with clear error messages if something is impossible
6. Never claim completion without verification

AVAILABLE TOOL PHILOSOPHY:
- readFile: Understand structure before modifying
- writeFile: Complete file content, creates or overwrites
- mkdir: Prepare directory structure
- Others as specified in task context

RESPONSE GUIDELINES:
- Use JSON format for structured responses
- Be explicit about decisions and reasoning
- Include context in messages to workers/orchestrator
- Provide actionable feedback on failures`
}

/**
 * Orchestrator-specific system prompt
 */
export function buildOrchestratorSystemPrompt(context: PromptContext): string {
  return `${buildCoreSystemPrompt()}

ROLE: Task Orchestrator
You coordinate task decomposition and execution across distributed workers.

RESPONSIBILITIES:
1. Analyze the user's task and break into independent subtasks
2. Identify dependencies between subtasks
3. Assign subtasks to capable workers
4. Monitor execution progress
5. Aggregate results and verify completion

TASK CONTEXT:
User Request: ${context.task.prompt}

FORMAT FOR SUBTASK DECOMPOSITION:
Return JSON with this structure:
\`\`\`json
{
  "analysis": "Your understanding of the task",
  "strategy": "How you will decompose and execute",
  "subtasks": [
    {
      "id": "st-1",
      "title": "Meaningful title",
      "description": "Detailed description of work needed",
      "expectedOutput": "What success looks like",
      "targetPaths": ["files/to/create.ext"],
      "dependencies": ["st-0 if needed"],
      "reasoning": "Why this subtask exists"
    }
  ],
  "executionOrder": "Explanation of parallel/sequential execution",
  "verificarion": "How to verify completion"
}
\`\`\``
}

/**
 * Worker-specific system prompt (synchronized with orchestrator)
 */
export function buildWorkerSystemPrompt(context: PromptContext, subtask: Subtask): string {
  const executedSteps = context.executedSteps?.map((s, i) => `${i + 1}. ${s}`).join('\n') || 'None yet'
  const errors = context.errors?.map(e => `- ${e}`).join('\n') || 'None'

  return `${buildCoreSystemPrompt()}

ROLE: Task Executor Worker
You execute assigned subtasks with focus and precision.

ASSIGNED SUBTASK:
Title: ${subtask.title}
Description: ${subtask.description}
Expected Output: ${subtask.expectedOutput}
Target Files: ${subtask.targetPaths.join(', ') || 'TBD'}
Allowed Tools: ${subtask.allowedTools?.join(', ') || 'readFile, writeFile, mkdir, listFiles'}

EXECUTION PROGRESS:
Steps Completed:
${executedSteps}

Previous Errors:
${errors}

EXECUTION RULES:
1. Use readFile to understand existing files first
2. Write complete file content via writeFile (never patches)
3. Create directories with mkdir if needed
4. For each action, respond with:
   - What you're doing
   - Why you're doing it
   - Expected outcome

RESPONSE FORMAT:
\`\`\`json
{
  "status": "continue|done|failed",
  "action": {
    "tool": "writeFile|readFile|mkdir|etc",
    "input": {...}
  },
  "reasoning": "Why this action",
  "nextSteps": "What happens after this succeeds"
}
\`\`\`

Or when done:
\`\`\`json
{
  "status": "done",
  "summary": "What was accomplished",
  "filesWritten": ["path/to/file1", "path/to/file2"],
  "verification": "How to verify this was successful"
}
\`\`\`

Or if failed:
\`\`\`json
{
  "status": "failed",
  "reason": "Why it failed",
  "attempted": "What was tried",
  "recommendation": "What could fix this"
}
\`\`\``
}

/**
 * Build contextualized orchestrator prompt for next action
 */
export function buildOrchestratorActionPrompt(context: PromptContext): string {
  const completed = context.executedSteps || []
  const remaining = completed.length === 0 ? 'Initial analysis' : 'Progress monitoring'

  return `${buildOrchestratorSystemPrompt(context)}

CURRENT STATUS:
- Steps Completed: ${completed.length}
- Next Action: ${remaining}

${completed.length > 0 ? `
COMPLETION REPORT:
${completed.map((s, i) => `${i + 1}. ${s}`).join('\n')}
` : ''}

What should we do next?`
}

/**
 * Build contextualized worker prompt for next iteration
 */
export function buildWorkerActionPrompt(context: PromptContext, subtask: Subtask, lastResponse?: string): string {
  const history = context.executedSteps || []

  let prompt = buildWorkerSystemPrompt(context, subtask)

  if (lastResponse) {
    prompt += `\n\nLASTRESPONSE:\n${lastResponse}\n\nPlease continue or complete this subtask.`
  } else {
    prompt += `\n\nBEGIN: Start working on this subtask now.`
  }

  return prompt
}

/**
 * Generate message for communicating with peer workers
 */
export function buildPeerTaskMessage(subtask: Subtask, context: PromptContext): string {
  return `You have been assigned a subtask in a distributed task system.

SUBTASK: ${subtask.title}
DESCRIPTION: ${subtask.description}

Your responsibilities:
1. Work autonomously using assigned tools
2. Create the required files completely
3. Report progress and status back
4. Verify your own work before reporting done

Use the provided tools and respond with JSON as instructed in your system prompt.`
}
