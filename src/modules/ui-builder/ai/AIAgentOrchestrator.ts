import { localModelProvider } from '@/execution/llm/LocalModelProvider';
import { ChatMessage } from '@/core/interfaces/IModelProvider';
import { uiBuilderTools, AITool } from './AITools';
import { EditorAPI } from '../core/EditorAPI';
import { useUIBuilderStore } from '../store';

export type AgentStatus = 'idle' | 'analyzing' | 'acting' | 'error';

export interface AIResponse {
  role: 'assistant' | 'tool';
  content: string;
  metadata?: any;
}

export class AIAgentOrchestrator {
  private history: ChatMessage[] = [];
  private onMessageHbs = new Set<(msg: AIResponse) => void>();
  private onStatusChangeHbs = new Set<(status: AgentStatus) => void>();
  
  private status: AgentStatus = 'idle';

  constructor() {
    this.history.push({
      role: 'system',
      content: this.getSystemPrompt()
    });
  }

  private setStatus(status: AgentStatus) {
    this.status = status;
    this.onStatusChangeHbs.forEach(cb => cb(status));
  }

  onMessage(cb: (msg: AIResponse) => void) {
    this.onMessageHbs.add(cb);
    return () => this.onMessageHbs.delete(cb);
  }

  onStatusChange(cb: (status: AgentStatus) => void) {
    this.onStatusChangeHbs.add(cb);
    return () => this.onStatusChangeHbs.delete(cb);
  }

  private emitMessage(msg: AIResponse) {
    this.onMessageHbs.forEach(cb => cb(msg));
  }

  private getSystemPrompt(): string {
    const toolsDescription = uiBuilderTools.map(t => 
      `Tool: ${t.name}\nDescription: ${t.description}\nArgs: ${JSON.stringify(t.parameters)}\n`
    ).join('\n');

    return `You are the UI Builder Design Agent. Your goal is to help the user build beautiful, professional UIs dynamically.
You have access to tools that modify the canvas.

DOMAIN KNOWLEDGE:
- The UI is a tree of nodes. Every node has an \`id\`, \`name\`, \`type\`, \`x\`, \`y\`, \`width\`, \`height\`, and \`children\`.
- Valid Node Types & Properties:
  - "FRAME", "GROUP": Structured containers for other elements.
  - "TEXT": Uses \`content\` (the string) and \`textColor\` properties.
  - "RECTANGLE": Uses \`bgColor\` property.
  - "IMAGE", "VIDEO": Uses \`src\` property for URLs.
- Capabilities:
  - Build UI using \`create_element\`.
  - Resize/Move using \`update_layout\`.
  - Remove elements using \`delete_element\`.
  - Style visually using \`update_style\` with "Decorators" instead of CSS.
- Valid Decorator Types for \`update_style\`:
  - "background": uses \`{ "color": "#hexcode" }\`
  - "text-color": uses \`{ "color": "#hexcode" }\`
  - "text-align": uses \`{ "align": "left" | "center" | "right", "verticalAlign": "top" | "middle" | "bottom" }\`
  - "style": uses \`{ "opacity": 100, "blur": 0, "shadowEnabled": true, "shadow": { "x":0, "y":4, "blur":10, "color": "rgba(0,0,0,0.1)" } }\`
  - "source": uses \`{ "url": "https://..." }\` for IMAGE or VIDEO nodes

HOW TO USE TOOLS:
To generate actions, you MUST reply EXACTLY with a JSON block containing an "actions" array. Each action is a tool call.
\`\`\`json
{
  "actions": [
    {
      "name": "tool_name",
      "args": {
        "param1": "value1"
      }
    }
  ]
}
\`\`\`
Do not write anything else in the message. The Orchestrator will execute these actions together in one batch.

GENERAL INSTRUCTIONS:
1. Context Assessment: Always refer to the "SELECTED NODE IDs" to determine the target of a user's styling/layout instructions.
2. Batching: You can output multiple actions in the array to accomplish the task in one shot.
3. Formatting: ONLY output the JSON array.

EXAMPLE PATTERN (DO NOT COPY BLINDLY):
Context: SELECTED NODE IDs: ["node-123"]
User Request: "Change the background to blue and make it wider"
Assistant:
\`\`\`json
{
  "actions": [
    {
      "name": "update_style",
      "args": { "nodeId": "node-123", "decoratorType": "background", "configValues": { "color": "#2563eb" } }
    },
    {
      "name": "update_layout",
      "args": { "nodeId": "node-123", "width": 800 }
    }
  ]
}
\`\`\`

AVAILABLE TOOLS:
${toolsDescription}`;
  }

  private getDocumentContext(): string {
    const state = useUIBuilderStore.getState();
    const layout = state.document.layouts.find(l => l.id === state.activeLayoutId);
    const page = layout?.pages.find(p => p.id === state.activePageId);
    
    // Simplify the context so it doesn't overflow small models
    const simplifyNode = (n: any): any => ({
      id: n.id,
      name: n.name,
      type: n.type,
      x: n.x, y: n.y, width: n.width, height: n.height,
      children: n.children ? n.children.map(simplifyNode) : undefined
    });

    return JSON.stringify(page?.nodes.map(simplifyNode) || []);
  }

  async submitPrompt(prompt: string): Promise<void> {
    if (!localModelProvider.isReady()) {
      await localModelProvider.initialize();
    }

    this.setStatus('analyzing');
    this.emitMessage({ role: 'assistant', content: `Analyzing: "${prompt}"...` });

    // We only push the raw, short prompt into persistent history so the token
    // window doesn't explode over multiple turns.
    this.history.push({ role: 'user', content: prompt });

    // Dynamically inject the massive document context ONLY into the final volatile array sent to the LLM.
    const executionHistory = [...this.history];
    const lastMsgIndex = executionHistory.length - 1;
    
    const state = useUIBuilderStore.getState();
    const selectedStr = state.selectedNodeIds.length > 0 ? JSON.stringify(state.selectedNodeIds) : "None";
    
    executionHistory[lastMsgIndex] = {
      role: 'user',
      content: `CURRENT PAGE NODES:\n${this.getDocumentContext()}\n\nSELECTED NODE IDs: ${selectedStr}\n\nUSER REQUEST: ${prompt}`
    };

    try {
      let assistantResponse = '';
      const responsePromise = localModelProvider.generateStream(executionHistory, (token) => {
        assistantResponse += token;
      }, { maxTokens: 1024, temperature: 0.1 });
      
      await responsePromise;
      this.history.push({ role: 'assistant', content: assistantResponse });

      const jsonMatch = assistantResponse.match(/```json\s*([\s\S]*?)\s*```/) || 
                        assistantResponse.match(/\{[\s\S]*\}/);
                        
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        if (parsed.actions && Array.isArray(parsed.actions)) {
          this.emitMessage({ role: 'assistant', content: `\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\`` });
          this.setStatus('acting');
          this.emitMessage({ role: 'assistant', content: `Executing ${parsed.actions.length} actions in transaction...` });
          
          await this.executeTransactionBatch(parsed.actions);
          this.setStatus('idle');
          return;
        }
      }
      
      // If we got here, no actions were found.
      this.setStatus('idle');
      this.emitMessage({ role: 'assistant', content: 'No valid actions generated. Try again.' });

    } catch (e) {
      this.setStatus('error');
      this.emitMessage({ role: 'assistant', content: `Agent Error: ${(e as Error).message}` });
    }
  }

  private async executeTransactionBatch(actions: any[]): Promise<void> {
    const state = useUIBuilderStore.getState();
    const locksToRelease = new Set<string>();
    const snapshot = new Map<string, any>();
    const newlyCreatedIds: string[] = [];

    // Phase 1: Identify all targeted nodes and acquire locks.
    for (const action of actions) {
      if (action.args?.nodeId) {
        locksToRelease.add(action.args.nodeId);
      }
      if (action.args?.parentId) {
        locksToRelease.add(action.args.parentId);
      }
    }
    
    // Acquire locks and snapshot original state
    for (const id of locksToRelease) {
      EditorAPI.requestNodeLock(id);
      const node = state.findNode(id);
      if (node) {
        // Deep clone the node to serve as a backup if we need to rollback
        snapshot.set(id, JSON.parse(JSON.stringify(node)));
      }
    }

    try {
      // Phase 2: Execute
      for (const action of actions) {
        const { name, args } = action;
        const tool = uiBuilderTools.find(t => t.name === name);
        if (!tool) throw new Error(`Tool ${name} not found`);

        this.emitMessage({ role: 'tool', content: `Executing: ${name}` });
        const result = await tool.execute(args);
        
        // If a tool dynamically creates a node, track it for rollback deletion if a later step fails.
        if (result && result.id) {
          newlyCreatedIds.push(result.id);
        }
      }

      this.emitMessage({ role: 'assistant', content: `Transaction completed successfully.` });

    } catch (error: any) {
      this.emitMessage({ role: 'tool', content: `Transaction Failed. Rolling back! (${error.message})` });
      
      // Phase 3: Rollback!
      // Delete any nodes that were dynamically created
      for (const newId of newlyCreatedIds) {
        EditorAPI.deleteNode(newId);
      }
      
      // Restore backups for existing nodes
      for (const [id, backupNode] of snapshot.entries()) {
        if (state.findNode(id)) {
           EditorAPI.updateNode(id, backupNode);
        }
      }
    } finally {
      // Phase 4: Release all locks
      for (const id of locksToRelease) {
        EditorAPI.releaseNodeLock(id);
      }
    }
  }

  clearHistory() {
    this.history = [{
      role: 'system',
      content: this.getSystemPrompt()
    }];
    this.emitMessage({ role: 'assistant', content: 'Conversation reset. How can I help you design?' });
  }
}
