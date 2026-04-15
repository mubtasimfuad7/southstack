import { ModelProvider } from '@/core/interfaces/IModelProvider';
import { DesignDocument } from '../core/DesignDocument';
import { UiSubtask } from './UiAiProtocol';
import { DesignNode } from '../core/DesignNode';

export class UiTaskPlanner {
  constructor(private model: ModelProvider) {}

  async plan(
    prompt: string,
    document: DesignDocument,
    selectedNodeIds: string[],
    rootTaskId: string,
    initiatorPeerId: string
  ): Promise<UiSubtask[]> {
    const selectedNodes = this._findNodes(document, selectedNodeIds);
    
    const systemPrompt = `You are a UI Engineering Architect. Your task is to decompose a user's UI editing request into atomic subtasks.
Each subtask will be executed by a different AI worker.

UI SCHEMA CONTEXT:
Nodes have types: 'frame', 'rectangle', 'text', 'image', 'video'.
Styling is handled via Decorators (style, layout, media, text).

TARGET NODES:
${JSON.stringify(selectedNodes, null, 2)}

DECOMPOSITION RULES:
1. Break large requests into node-specific subtasks.
2. For Frames, you can delegate child editing to separate subtasks.
3. Define exact dependencies (e.g., if a child needs the parent frame to resize first).
4. Return ONLY valid JSON in the specified format.

OUTPUT FORMAT:
{
  "subtasks": [
    {
      "id": "st-1",
      "title": "Task title",
      "description": "Specific instruction for the AI worker",
      "targetNodeIds": ["node-id-1"],
      "dependencies": []
    }
  ]
}`;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: `Decompose this command: ${prompt}` }
    ];

    try {
      const response = await this.model.generate(messages, { temperature: 0.1 });
      const parsed = this._parseResponse(response);
      
      return parsed.subtasks.map((s: any) => ({
        id: s.id,
        rootTaskId,
        initiatorPeerId,
        title: s.title,
        description: s.description,
        nodeIds: s.targetNodeIds,
        contextNodes: this._findNodes(document, s.targetNodeIds),
        allowedTools: ['ui_updateNode', 'ui_updateDecorator'],
        dependencies: s.dependencies || [],
        status: 'queued'
      }));
    } catch (err) {
      console.error('[UiTaskPlanner] Failed to plan:', err);
      // Fallback: single subtask if planning fails
      return [{
        id: 'st-fallback',
        rootTaskId,
        initiatorPeerId,
        title: 'Execute UI Edit',
        description: prompt,
        nodeIds: selectedNodeIds,
        contextNodes: selectedNodes,
        allowedTools: ['ui_updateNode', 'ui_updateDecorator'],
        dependencies: [],
        status: 'queued'
      }];
    }
  }

  private _findNodes(doc: DesignDocument, ids: string[]): DesignNode[] {
    const found: DesignNode[] = [];
    const search = (nodes: DesignNode[]) => {
      for (const node of nodes) {
        if (ids.includes(node.id)) found.push(node);
        if (node.children) search(node.children);
      }
    };
    doc.layouts.forEach(l => l.pages.forEach(p => search(p.nodes)));
    return found;
  }

  private _parseResponse(raw: string): any {
    const match = raw.match(/```json\s*([\s\S]*?)\s*```/) || raw.match(/(\{[\s\S]*\})/) || [null, raw];
    return JSON.parse(match[1].trim());
  }
}
