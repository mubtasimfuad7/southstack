import { useUIBuilderStore, PeerState } from '../store';
import { DesignNode } from './DesignNode';
import { messageBus } from '@/core/network/messageBus';
import { createMessage, UIPeerStatePayload, UICursorPayload, UIDocChangePayload } from '@/core/network/protocol';
import { peerNetworkManager } from '@/core/network/PeerNetworkManager';

/**
 * EditorAPI is the unified control layer for all UI Builder operations.
 */
export const EditorAPI = {
  // --- LOCAL ACTIONS ---

  select(nodeIds: string[], multiple = false) {
    useUIBuilderStore.getState().selectNodes(nodeIds, multiple);
    this.broadcastLocalState();
  },

  hover(nodeId: string | null) {
    useUIBuilderStore.getState().setHoveredNode(nodeId);
    this.broadcastLocalState();
  },

  moveCursor(x: number, y: number) {
    this.broadcastCursor(x, y);
  },

  updateNode(nodeId: string, patch: Partial<DesignNode>) {
    useUIBuilderStore.getState().updateNode(nodeId, patch);
    this.broadcastDocumentChange({ type: 'update', nodeId, patch });
  },

  addNode(node: DesignNode, parentId?: string) {
    useUIBuilderStore.getState().addNode(node, parentId);
    this.broadcastDocumentChange({ type: 'add', node, parentId });
  },

  deleteNode(nodeId: string) {
    useUIBuilderStore.getState().deleteNode(nodeId);
    this.broadcastDocumentChange({ type: 'delete', nodeId });
  },

  // --- REMOTE ACTIONS ---

  onPeerUpdate(peerId: string, patch: Partial<PeerState>) {
    useUIBuilderStore.getState().updatePeerState(peerId, patch);
  },

  onPeerLeave(peerId: string) {
    useUIBuilderStore.getState().removePeer(peerId);
  },

  onRemoteDocumentChange(change: any) {
    const { updateNode, addNode, deleteNode } = useUIBuilderStore.getState();
    
    switch (change.type) {
      case 'update':
        updateNode(change.nodeId, change.patch);
        break;
      case 'add':
        addNode(change.node, change.parentId);
        break;
      case 'delete':
        deleteNode(change.nodeId);
        break;
    }
  },

  // --- BROADCAST HELPERS ---

  broadcastLocalState() {
    const state = useUIBuilderStore.getState();
    const localPeerId = peerNetworkManager.getLocalPeerId();
    if (!localPeerId) return;

    const payload: UIPeerStatePayload = {
      selection: state.selectedNodeIds,
      hoveredNodeId: state.hoveredNodeId
    };
    
    const msg = createMessage('ui/peer-state', localPeerId, payload);
    peerNetworkManager.broadcast(msg);
  },

  broadcastCursor(x: number, y: number) {
    const localPeerId = peerNetworkManager.getLocalPeerId();
    if (!localPeerId) return;

    const payload: UICursorPayload = { x, y };
    const msg = createMessage('ui/cursor', localPeerId, payload);
    peerNetworkManager.broadcast(msg);
  },

  broadcastDocumentChange(change: UIDocChangePayload) {
    const localPeerId = peerNetworkManager.getLocalPeerId();
    if (!localPeerId) return;

    const msg = createMessage('ui/doc-change', localPeerId, change);
    peerNetworkManager.broadcast(msg);
  },

  // --- INITIALIZATION ---

  init() {
    console.log('[EditorAPI] Initializing P2P Listeners');
    
    messageBus.on<UIPeerStatePayload>('ui/peer-state', (msg) => {
      this.onPeerUpdate(msg.fromPeerId, {
        selection: msg.payload.selection,
        hoveredNodeId: msg.payload.hoveredNodeId,
        userName: msg.payload.userName,
        color: msg.payload.color
      });
    });

    messageBus.on<UICursorPayload>('ui/cursor', (msg) => {
      this.onPeerUpdate(msg.fromPeerId, {
        cursor: msg.payload
      });
    });

    messageBus.on<UIDocChangePayload>('ui/doc-change', (msg) => {
      this.onRemoteDocumentChange(msg.payload);
    });

    // Listen for peers leaving to clean up cursors
    messageBus.on('peer/goodbye', (msg) => {
      this.onPeerLeave(msg.fromPeerId);
    });
  }
};
