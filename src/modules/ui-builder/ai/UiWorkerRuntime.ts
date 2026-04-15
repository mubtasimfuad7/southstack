import { ModelProvider, ChatMessage } from '@/core/interfaces/IModelProvider';
import { UiSubtask, UI_AI_TYPE_KEYS } from './UiAiProtocol';
import { messageBus } from '@/core/network/messageBus';
import { peerNetworkManager } from '@/core/network/PeerNetworkManager';
import { createMessage } from '@/core/network/protocol';

export class UiWorkerRuntime {
  private stopped = false;

  constructor(
    private workerId: string,
    private initiatorId: string,
    private model: ModelProvider
  ) {}

  async execute(subtask: UiSubtask): Promise<void> {
    console.log(`[UiWorkerRuntime] Executing UI Subtask: ${subtask.title}`);
    
    const systemPrompt = `You are a UI Design AI tasked with modifying existing UI components.
You operate on a JSON representation of nodes.

DECORATOR SCHEMA:
- style: { opacity: 0-100, shadow: { x, y, blur, color }, blur: number }
- layout: { fillType: 'fixed'|'percentage', width: number, height: number, widthPct: number }
- media: { url: string, loop: boolean }
- text: { content: string, fontSize: number, color: string, align: 'left'|'center'|'right' }

INSTRUCTIONS:
1. Analyze the current state of the nodes.
2. Apply the requested changes: "${subtask.description}"
3. You can call tools: ui_updateNode(id, patch), ui_updateDecorator(nodeId, type, config).
4. Return ONLY valid JSON in this format:
{
  "status": "done" | "failed",
  "reason": "if failed",
  "actions": [ { "tool": "ui_updateNode", "input": { ... } } ]
}

CURRENT NODES:
${JSON.stringify(subtask.contextNodes, null, 2)}`;

    let history: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Apply the changes now.' }
    ];

    try {
      // Send initial progress
      this._sendProgress(subtask, 10, 'Thinking...');

      const response = await this.model.generate(history, { temperature: 0.2 });
      const parsed = this._parseResponse(response);

      if (parsed.status === 'done' && parsed.actions) {
        // Execute actions (tools)
        for (const action of parsed.actions) {
          await this._callRemoteTool(subtask, action.tool, action.input);
        }
        this._sendResult(subtask, true, 'Successfully updated nodes');
      } else {
        this._sendResult(subtask, false, parsed.reason || 'Failed to generate valid update');
      }
    } catch (err) {
      console.error('[UiWorkerRuntime] Execution error:', err);
      this._sendResult(subtask, false, String(err));
    }
  }

  private async _callRemoteTool(subtask: UiSubtask, tool: string, input: any): Promise<void> {
    const requestId = `ui-req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const msg = createMessage(UI_AI_TYPE_KEYS.TOOL_REQUEST as any, this.workerId, {
      requestId,
      tool,
      args: input,
      subtaskId: subtask.id
    }, this.initiatorId);

    return messageBus.request(requestId, () => {
      peerNetworkManager.sendToPeer(this.initiatorId, msg);
    }, 10000);
  }

  private _sendProgress(subtask: UiSubtask, progress: number, statusText: string): void {
    const msg = createMessage(UI_AI_TYPE_KEYS.TASK_PROGRESS as any, this.workerId, {
      subtaskId: subtask.id,
      progress,
      statusText
    }, this.initiatorId);
    peerNetworkManager.sendToPeer(this.initiatorId, msg);
  }

  private _sendResult(subtask: UiSubtask, success: boolean, summary: string): void {
    const msg = createMessage(UI_AI_TYPE_KEYS.TASK_RESULT as any, this.workerId, {
      subtaskId: subtask.id,
      success,
      resultSummary: summary
    }, this.initiatorId);
    peerNetworkManager.sendToPeer(this.initiatorId, msg);
  }

  private _parseResponse(raw: string): any {
    const match = raw.match(/```json\s*([\s\S]*?)\s*```/) || raw.match(/(\{[\s\S]*\})/) || [null, raw];
    return JSON.parse(match[1].trim());
  }
}
