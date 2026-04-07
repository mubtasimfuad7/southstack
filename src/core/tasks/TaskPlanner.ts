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

  async plan(
    prompt: string, 
    fileTreeContext: string, 
    rootTaskId: string, 
    initiatorPeerId: string,
    onProgress?: (progress: { tokenCount: number; elapsed: number; status: string; token: string }) => void
  ): Promise<Subtask[]> {
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
    let tokenCount = 0
    const startTime = Date.now()

    try {
      raw = await this.model.generate(messages, { 
        maxTokens: 2000, 
        temperature: 0.2,
        onToken: (token: string) => {
          tokenCount++
          const elapsed = Date.now() - startTime
          onProgress?.({
            tokenCount,
            elapsed,
            status: `Generating plan (${tokenCount} tokens, ${(elapsed / 1000).toFixed(1)}s)`,
            token
          })
        }
      })
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
    
    // Analyze prompt to detect file types and structure
    const promptLower = prompt.toLowerCase()
    const subtasks: Subtask[] = []
    
    // Detect if web project (HTML/CSS/JS)
    const hasHTML = promptLower.includes('html') || promptLower.includes('web') || promptLower.includes('page')
    const hasCSS = promptLower.includes('css') || promptLower.includes('style') || promptLower.includes('design')
    const hasJS = promptLower.includes('javascript') || promptLower.includes('js') || promptLower.includes('function') || promptLower.includes('interactive')

    // Generate subtasks based on detected components
    let subtaskCount = 0

    if (hasHTML || hasCSS || hasJS) {
      // Web-based project: break into components with full context
      if (hasHTML) {
        subtasks.push({
          id: `st-html-${Date.now()}-${subtaskCount++}`,
          rootTaskId,
          initiatorPeerId,
          title: 'Implement HTML structure for the application',
          description: `USER REQUIREMENT: ${prompt}

Your task is to create a complete HTML file that implements the above requirement.

REQUIREMENTS:
1. Analyze the user's requirement and understand what needs to be built
2. Create a complete, valid HTML5 document with:
   - Proper DOCTYPE and semantic structure
   - All necessary UI elements to fulfill the requirement
   - Proper IDs and classes for CSS styling and JavaScript interaction
   - Form inputs, buttons, displays, or other elements as needed
3. Include inline CSS styling in a <style> tag if needed for basic layout
4. Include a <script> tag that will be enhanced by separate JS subtask
5. Use writeFile() tool to save to "index.html"
6. Ensure the HTML is self-contained and ready for CSS and JS enhancements

CRITICAL: You MUST call writeFile() with the complete HTML content before marking done.
The HTML should provide the full structure and visual foundation for the application.`,
          expectedOutput: 'Complete, valid HTML5 file with all UI elements needed for the application',
          targetPaths: ['index.html', 'public/index.html'],
          allowedTools: ['writeFile', 'readFile', 'mkdir'] as ToolName[],
          dependencies: [],
          lockedFiles: ['index.html', 'public/index.html'],
          status: 'queued' as const,
          retryCount: 0,
          maxRetries: 2,
          createdAt: now,
          updatedAt: now,
        })
      }

      if (hasCSS && hasHTML) {
        subtasks.push({
          id: `st-css-${Date.now()}-${subtaskCount++}`,
          rootTaskId,
          initiatorPeerId,
          title: 'Add CSS styling to match the design',
          description: `USER REQUIREMENT: ${prompt}

The HTML structure has been created. Your task is to add comprehensive CSS styling.

REQUIREMENTS:
1. Read the existing index.html file to understand the structure
2. Create a complete CSS file that:
   - Styles all HTML elements to fulfill the design requirements
   - Uses flexbox/grid for layout as needed
   - Implements colors, fonts, spacing, and visual hierarchy
   - Includes responsive design where appropriate
   - Makes the application visually complete and functional-looking
3. Handle interactive states (hover, focus, active) for UI elements
4. Use writeFile() tool to save to "style.css" (or embed in HTML's <style> tag)
5. Ensure styling makes the application look professional and complete

CRITICAL: You MUST call writeFile() with the complete CSS before marking done.
The CSS should make the HTML visually appealing and ready for JavaScript enhancement.`,
          expectedOutput: 'Complete CSS file with all styling needed for the application design',
          targetPaths: ['style.css', 'index.css', 'public/style.css'],
          allowedTools: ['writeFile', 'readFile', 'mkdir'] as ToolName[],
          dependencies: [subtasks[0].id],
          lockedFiles: ['style.css', 'index.css', 'public/style.css'],
          status: 'queued' as const,
          retryCount: 0,
          maxRetries: 2,
          createdAt: now,
          updatedAt: now,
        })
      }

      if (hasJS) {
        subtasks.push({
          id: `st-js-${Date.now()}-${subtaskCount++}`,
          rootTaskId,
          initiatorPeerId,
          title: 'Implement JavaScript interactivity and logic',
          description: `USER REQUIREMENT: ${prompt}

The HTML and CSS have been created. Your task is to implement all JavaScript functionality.

REQUIREMENTS:
1. Read the existing index.html file to understand the structure and event listeners
2. Create a complete JavaScript file that:
   - Implements all interactive features described in the requirement
   - Responds to user interactions (clicks, input changes, etc.)
   - Updates the DOM dynamically as needed
   - Implements any calculations, animations, or logic required
   - Manages application state
3. Include helper functions, event listeners, and initialization code
4. Use writeFile() tool to save to "script.js" (or embed in index.html's <script> tag)
5. Ensure the JavaScript makes the application fully functional per the requirement

CRITICAL: You MUST call writeFile() with the complete JavaScript before marking done.
The JavaScript should make the application interactive and complete all required functionality.`,
          expectedOutput: 'Complete JavaScript file with all interactivity and logic needed for the application',
          targetPaths: ['script.js', 'index.js', 'public/script.js'],
          allowedTools: ['writeFile', 'readFile', 'mkdir'] as ToolName[],
          dependencies: [],
          lockedFiles: ['script.js', 'index.js', 'public/script.js'],
          status: 'queued' as const,
          retryCount: 0,
          maxRetries: 2,
          createdAt: now,
          updatedAt: now,
        })
      }
    } else {
      // Generic task - single subtask
      subtasks.push({
        id: `st-general-${Date.now()}`,
        rootTaskId,
        initiatorPeerId,
        title: 'Complete task',
        description: `Execute the following task:
${prompt}

Requirements:
- Use available tools (writeFile, readFile, mkdir, etc.) as needed
- Create or modify files to complete the task
- Use writeFile() to persist any changes
- Confirm task completion`,
        expectedOutput: 'Task completed successfully with all required files created/modified',
        targetPaths: [],
        allowedTools: ALL_TOOLS,
        dependencies: [],
        lockedFiles: [],
        status: 'queued' as const,
        retryCount: 0,
        maxRetries: 2,
        createdAt: now,
        updatedAt: now,
      })
    }

    return subtasks.length > 0 ? subtasks : [{
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
