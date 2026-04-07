// ============================================================
// NEW ORCHESTRATION SYSTEM: Claude/Codex-style Updates
// ============================================================

## Architecture Overview

The new system implements sophisticated task orchestration inspired by Claude and Codex:

### Key Components:

1. **OrchestrationAgent** (src/core/tasks/OrchestrationAgent.ts)
   - Stateful agent that maintains conversation history
   - Reasons about task decomposition vs execution
   - Adapts strategy based on execution feedback
   - Compatible with UI callbacks through onChange()

2. **SynchronizedPrompting** (src/core/tasks/SynchronizedPrompting.ts)
   - Unified prompt generation for both orchestrator and workers
   - Shared context and reasoning framework
   - Ensures consistency across distributed execution
   - Four main prompt builders:
     * buildCoreSystemPrompt() - Base instructions for all agents
     * buildOrchestratorSystemPrompt() - Task planning and coordination
     * buildWorkerSystemPrompt() - Subtask execution
     * buildOrchestratorActionPrompt() - Next-step reasoning

## How It Works

### Phase 1: Intelligent Planning
1. **Analyze**: Model receives full project context and user task
2. **Decompose**: LLM breaks task into subtasks with reasoning
3. **Refine**: Follow-up turn verifies dependencies and ordering
4. **Result**: Subtasks store both WHAT and WHY for worker context

### Phase 2: Distributed Execution
1. **Assignment**: Ready subtasks given to peer workers with full context
2. **Progress**: Workers report thinking/iterations, not just progress %
3. **Coordination**: Orchestrator tracks and adapts based on execution
4. **File Creation**: Actual tool calls validated (no fake claims)

### Phase 3: Verification
1. **Completion Report**: Model summarizes what was accomplished
2. **Verification**: Model verifies original task requirements met
3. **Sync**: Files written to local OS filesystem automatically
4. **Status**: Returns completed status to UI

## Key Improvements Over Previous System

| Feature | Before | After |
|---------|--------|-------|
| Planning | Stateless single-turn decomposition | Stateful multi-turn reasoning with refinement |
| Context | No shared context between agents | Synchronized prompts across all agents |
| Reasoning | Model just makes decisions | Model explains reasoning at each step |
| Tool Calls | Worker claims what it did | Actual tool execution validated |
| Adaptation | Fixed strategy | Agent adapts based on execution feedback |
| Visibility | Task status % only | Detailed reasoning and thinking loops |
| Error Handling | Stops on failure | Iterates with feedback to retry |
| Verification | No verification | Model verifies requirements met |

## Usage in Code

### Before (Old System):
```typescript
const orchestrator = new TaskOrchestrator(rootTask, model)
orchestrator.onChange((rt, st) => { /* UI update */ })
await orchestrator.start()
```

### After (New System):
```typescript
const agent = new OrchestrationAgent(rootTask, model)
agent.onChange((rt, st) => { /* UI update */ })
await agent.start()  // or agent.orchestrate()
```

Backwards compatible! Drop-in replacement.

## Prompt Structure Example

### Orchestrator sees:
- Full project file tree
- User's original request in natural language
- Peer availability and capabilities
- Execution history (if continuing)
- Result: Plans with dependencies and reasoning

### Worker sees:
- Specific subtask with full description and context
- Expected output specification
- List of allowed tools
- Previous steps and errors
- Result: Executes with awareness of larger goal

## Key Benefits

1. **Coherent Task Decomposition**
   - Plans consider full context, not just local task
   - Dependencies properly identified
   - Parallelization opportunities maximized

2. **Intelligent Worker Coordination**
   - Workers understand why they're doing work
   - Can make context-aware decisions
   - Report useful debugging info

3. **Robust Execution**
   - File creation actually validated
   - Fake completions rejected
   - Failure feedback drives retries

4. **Better Visibility**
   - Model reasoning shown in UI
   - Tool calls transparent
   - Thinking process visible for debugging

5. **Graceful Adaptation**
   - If execution fails, model knows why
   - Can adjust strategy mid-execution
   - Verification catches incomplete work

## Future Enhancements

1. **Memory Between Sessions**
   - Store completed task patterns
   - Learn from execution successes/failures
   - Improve future planning

2. **Multi-Model Orchestration**
   - Use different models for planning vs execution
   - Cost optimization (expensive planner, cheap workers)
   - Specialized model selection per task type

3. **Incremental Execution**
   - Stream subtask results back to model
   - Adapt plan based on early results
   - Support long-running tasks with checkpoints

4. **Tool Learning**
   - Model learns tool APIs through execution
   - Fewer hallucinated tool calls over time
   - Better error recovery
