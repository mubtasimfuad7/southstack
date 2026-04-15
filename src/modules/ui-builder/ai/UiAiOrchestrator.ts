import { useUIBuilderStore } from '../store';
import { EditorAPI } from '../core/EditorAPI';
import { UiTaskPlanner } from './UiTaskPlanner';
import { UiSubtask, UI_AI_TYPE_KEYS } from './UiAiProtocol';
import { localModelProvider } from '@/execution/llm/LocalModelProvider';
import { peerNetworkManager } from '@/core/network/PeerNetworkManager';
import { peerStateStore } from '@/core/peers/PeerStateStore';
import { createMessage } from '@/core/network/protocol';
import { messageBus } from '@/core/network/messageBus';

export class UiAiOrchestrator {
  private planner: UiTaskPlanner;
  private subtasks = new Map<string, UiSubtask>();
  private activeRootTask: any = null;

  constructor() {
    this.planner = new UiTaskPlanner(localModelProvider);
    this._initListeners();
  }

  async executeCommand(prompt: string): Promise<void> {
    const state = useUIBuilderStore.getState();
    const selectedIds = state.selectedNodeIds;

    if (selectedIds.length === 0) {
      throw new Error('Please select at least one element to edit with AI.');
    }

    // 1. Plan
    console.log(`[UiAiOrchestrator] Planning for prompt: ${prompt}`);
    const rootTaskId = `ui-root-${Date.now()}`;
    const localPeerId = peerNetworkManager.getLocalPeerId();
    
    this.activeRootTask = { id: rootTaskId, prompt, status: 'planning' };
    
    const tasks = await this.planner.plan(prompt, state.document, selectedIds, rootTaskId, localPeerId);
    tasks.forEach(t => this.subtasks.set(t.id, t));

    // 2. Lock Nodes
    console.log(`[UiAiOrchestrator] Locking ${selectedIds.length} nodes`);
    selectedIds.forEach(id => EditorAPI.requestNodeLock(id));

    // 3. Schedule
    this._scheduleNext();
  }

  private _scheduleNext(): void {
    const pending = Array.from(this.subtasks.values()).filter(t => t.status === 'queued');
    if (pending.length === 0) {
      this._checkCompletion();
      return;
    }

    // Simple scheduling: Find idle peers or run locally
    const peers = Array.from(peerStateStore.getRemotePeers().values()).filter(p => p.state === 'idle' && p.acceptsRemoteTasks);
    
    pending.forEach(task => {
      const targetPeer = peers.shift();
      if (targetPeer) {
        this._offerToPeer(task, targetPeer.peerId);
      } else {
        this._runLocally(task);
      }
    });
  }

  private _offerToPeer(task: UiSubtask, peerId: string): void {
    task.status = 'assigned';
    task.assignedPeerId = peerId;
    
    const msg = createMessage(UI_AI_TYPE_KEYS.TASK_OFFER as any, peerNetworkManager.getLocalPeerId(), {
      subtask: task
    }, peerId);
    
    peerNetworkManager.sendToPeer(peerId, msg);
  }

  private async _runLocally(task: UiSubtask): Promise<void> {
    task.status = 'in_progress';
    task.assignedPeerId = peerNetworkManager.getLocalPeerId();
    
    const { UiWorkerRuntime } = await import('./UiWorkerRuntime');
    const runtime = new UiWorkerRuntime(task.assignedPeerId, task.assignedPeerId, localModelProvider);
    
    await runtime.execute(task);
  }

  private _checkCompletion(): void {
    const allDone = Array.from(this.subtasks.values()).every(t => t.status === 'completed' || t.status === 'failed');
    if (allDone) {
      console.log('[UiAiOrchestrator] Command execution finished.');
      // Release locks
      useUIBuilderStore.getState().selectedNodeIds.forEach(id => EditorAPI.releaseNodeLock(id));
    }
  }

  private _initListeners(): void {
    // Listen for tool requests from workers
    messageBus.on(UI_AI_TYPE_KEYS.TOOL_REQUEST as any, (msg: any) => {
      const { requestId, tool, args, subtaskId } = msg.payload;
      this._handleToolCall(tool, args, subtaskId).then(result => {
        const response = createMessage(UI_AI_TYPE_KEYS.TOOL_RESPONSE as any, peerNetworkManager.getLocalPeerId(), {
          requestId, result
        }, msg.fromPeerId);
        peerNetworkManager.sendToPeer(msg.fromPeerId, response);
      });
    });

    // Listen for results
    messageBus.on(UI_AI_TYPE_KEYS.TASK_RESULT as any, (msg: any) => {
      const { subtaskId, success, resultSummary } = msg.payload;
      const task = this.subtasks.get(subtaskId);
      if (task) {
        task.status = success ? 'completed' : 'failed';
        this._checkCompletion();
      }
    });
  }

  private async _handleToolCall(tool: string, args: any, subtaskId: string): Promise<any> {
    console.log(`[UiAiOrchestrator] Executing UI Tool: ${tool}`, args);
    if (tool === 'ui_updateNode') {
      EditorAPI.updateNode(args.id, args.patch);
      return { success: true };
    }
    if (tool === 'ui_updateDecorator') {
      EditorAPI.updateDecorator(args.nodeId, args.type, args.config);
      return { success: true };
    }
    return { error: 'Unknown tool' };
  }
}

export const uiAiOrchestrator = new UiAiOrchestrator();
