import { messageBus } from '@/core/network/messageBus';
import { UI_AI_TYPE_KEYS } from './UiAiProtocol';
import { UiWorkerRuntime } from './UiWorkerRuntime';
import { localModelProvider } from '@/execution/llm/LocalModelProvider';
import { peerNetworkManager } from '@/core/network/PeerNetworkManager';
import { uiAiOrchestrator } from './UiAiOrchestrator';

export class UiAiManager {
  private static instance: UiAiManager;

  static getInstance(): UiAiManager {
    if (!this.instance) this.instance = new UiAiManager();
    return this.instance;
  }

  init(): void {
    console.log('[UiAiManager] Initializing UI AI Distributed Listeners');
    
    // Peer-side: Listen for Task Offers
    messageBus.on(UI_AI_TYPE_KEYS.TASK_OFFER as any, async (msg: any) => {
      const { subtask } = msg.payload;
      const localId = peerNetworkManager.getLocalPeerId();
      
      console.log(`[UiAiManager] Received UI Task Offer: ${subtask.title} from ${msg.fromPeerId}`);
      
      // Accept logic (simple: if not busy)
      const runtime = new UiWorkerRuntime(localId, msg.fromPeerId, localModelProvider);
      
      // Send accept message
      const acceptMsg = createMessage(UI_AI_TYPE_KEYS.TASK_ACCEPT as any, localId, {
        subtaskId: subtask.id
      }, msg.fromPeerId);
      peerNetworkManager.sendToPeer(msg.fromPeerId, acceptMsg as any);

      // Execute
      await runtime.execute(subtask);
    });
  }

  async executeCommand(prompt: string): Promise<void> {
    return uiAiOrchestrator.executeCommand(prompt);
  }
}

export const uiAiManager = UiAiManager.getInstance();

function createMessage(type: string, fromId: string, payload: any, toId: string) {
    return {
        id: `${fromId}-${Date.now()}`,
        type,
        fromPeerId: fromId,
        toPeerId: toId,
        payload,
        timestamp: Date.now(),
        protocolVersion: '0.1.0'
    };
}
