import { useUIBuilderStore } from '../store';
import { DesignNode } from './DesignNode';
import { messageBus } from '@/core/network/messageBus';
import { createMessage, UIPeerStatePayload, UICursorPayload, UIDocChangePayload } from '@/core/network/protocol';
import { peerNetworkManager } from '@/core/network/PeerNetworkManager';
import { UITypeKeys, UIDocSyncPayload, UIDocSyncRequestPayload, UIEditAccessRequestPayload, UIEditAccessResponsePayload, UINodeLockRequestPayload, UINodeLockResponsePayload, UINodeUnlockPayload } from './UINetworkProtocol';

/**
 * EditorAPI is the unified control layer for all UI Builder operations.
 */
export const EditorAPI = {
  // --- LOCAL ACTIONS ---

  select(nodeIds: string[], multiple = false) {
    const state = useUIBuilderStore.getState();
    const localId = peerNetworkManager.getLocalPeerId();
    
    // Release previous locks if editing a remote doc
    if (state.hostPeerId && state.hostPeerId !== localId) {
      state.selectedNodeIds.forEach(id => this.releaseNodeLock(id));
    }
    
    state.selectNodes(nodeIds, multiple);
    this.broadcastLocalState();
    
    // Request new locks if editing a remote doc and we have access
    if (state.hostPeerId && state.hostPeerId !== localId && state.hasEditAccess) {
      nodeIds.forEach(id => this.requestNodeLock(id));
    }
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
    if (useUIBuilderStore.getState().hasEditAccess) {
      this.broadcastDocumentChange({ type: 'update', nodeId, patch });
    }
  },

  addNode(node: DesignNode, parentId?: string) {
    useUIBuilderStore.getState().addNode(node, parentId);
    if (useUIBuilderStore.getState().hasEditAccess) {
      this.broadcastDocumentChange({ type: 'add', node, parentId });
    }
  },

  deleteNode(nodeId: string) {
    useUIBuilderStore.getState().deleteNode(nodeId);
    if (useUIBuilderStore.getState().hasEditAccess) {
      this.broadcastDocumentChange({ type: 'delete', nodeId });
    }
  },

  addDecorator(nodeId: string, decorator: any) {
    useUIBuilderStore.getState().addDecorator(nodeId, decorator);
    if (useUIBuilderStore.getState().hasEditAccess) {
      this.broadcastDocumentChange({ type: 'add-decorator', nodeId, decorator });
    }
  },

  updateDecorator(nodeId: string, decoratorId: string, config: any) {
    useUIBuilderStore.getState().updateDecorator(nodeId, decoratorId, config);
    if (useUIBuilderStore.getState().hasEditAccess) {
      this.broadcastDocumentChange({ type: 'update-decorator', nodeId, decoratorId, config });
    }
  },

  // --- COLLABORATION ACTIONS ---

  joinSession(peerId: string) {
    useUIBuilderStore.getState().joinSession(peerId, false);
    
    // Explicitly request the sync document
    const localId = peerNetworkManager.getLocalPeerId();
    const msg = createMessage<UIDocSyncRequestPayload>(UITypeKeys.DOC_SYNC_REQUEST, localId, {
      requestingPeerId: localId
    }, peerId);
    peerNetworkManager.sendToPeer(peerId, msg);
  },

  requestEditAccess() {
    const state = useUIBuilderStore.getState();
    const localId = peerNetworkManager.getLocalPeerId();
    if (!state.hostPeerId || state.hostPeerId === localId || state.hasEditAccess) return;

    const msg = createMessage<UIEditAccessRequestPayload>(UITypeKeys.EDIT_ACCESS_REQUEST, localId, {
      requestingPeerId: localId
    }, state.hostPeerId);
    peerNetworkManager.sendToPeer(state.hostPeerId, msg);
  },

  respondToEditRequest(peerId: string, approved: boolean) {
    const localId = peerNetworkManager.getLocalPeerId();
    const state = useUIBuilderStore.getState();
    state.resolveEditRequest(peerId, approved);
    
    const msg = createMessage<UIEditAccessResponsePayload>(UITypeKeys.EDIT_ACCESS_RESPONSE, localId, {
      status: approved ? 'approved' : 'rejected'
    }, peerId);
    peerNetworkManager.sendToPeer(peerId, msg);
  },

  requestNodeLock(nodeId: string) {
    const state = useUIBuilderStore.getState();
    const localId = peerNetworkManager.getLocalPeerId();
    if (!state.hasEditAccess) return;

    if (!state.hostPeerId || state.hostPeerId === localId) {
      // Local Host locks it directly
      const currentLock = state.nodeLocks[nodeId];
      if (!currentLock || currentLock === localId) {
        state.setNodeLock(nodeId, localId);
        const responsePayload: UINodeLockResponsePayload = { nodeId, lockedByPeerId: localId, locked: true };
        peerNetworkManager.broadcast(createMessage(UITypeKeys.NODE_LOCK_RESPONSE, localId, responsePayload));
      }
    } else {
      // Remote peer asks host
      const msg = createMessage<UINodeLockRequestPayload>(UITypeKeys.NODE_LOCK_REQUEST, localId, {
        requestingPeerId: localId,
        nodeId
      }, state.hostPeerId);
      peerNetworkManager.sendToPeer(state.hostPeerId, msg);
    }
  },

  releaseNodeLock(nodeId: string) {
    const state = useUIBuilderStore.getState();
    const localId = peerNetworkManager.getLocalPeerId();

    if (!state.hostPeerId || state.hostPeerId === localId) {
      // Local Host unlocks it directly
      if (state.nodeLocks[nodeId] === localId) {
        state.setNodeLock(nodeId, null);
        const responsePayload: UINodeLockResponsePayload = { nodeId, lockedByPeerId: localId, locked: false };
        peerNetworkManager.broadcast(createMessage(UITypeKeys.NODE_LOCK_RESPONSE, localId, responsePayload));
      }
    } else {
      const msg = createMessage<UINodeUnlockPayload>(UITypeKeys.NODE_UNLOCK, localId, {
        peerId: localId,
        nodeId
      }, state.hostPeerId);
      peerNetworkManager.sendToPeer(state.hostPeerId, msg);
    }
  },

  leaveSession() {
    const state = useUIBuilderStore.getState();
    const localId = peerNetworkManager.getLocalPeerId();

    // Release any node lock we own before leaving
    Object.entries(state.nodeLocks).forEach(([nodeId, locker]) => {
       if (locker === localId) {
          this.releaseNodeLock(nodeId);
       }
    });

    useUIBuilderStore.getState().joinSession(null, true);
  },

  // --- REMOTE ACTIONS ---

  onPeerUpdate(peerId: string, patch: any) {
    // No-op for document. The `ui/doc-sync` handles bulk transfers manually.
  },

  onPeerLeave(peerId: string) {
    const state = useUIBuilderStore.getState();
    
    // Clear any locks held by the disconnected peer
    Object.entries(state.nodeLocks).forEach(([nodeId, holderId]) => {
      if (holderId === peerId) state.setNodeLock(nodeId, null);
    });

    if (state.hostPeerId === peerId) {
      console.warn(`[EditorAPI] Host peer left. Terminating collaborative session.`);
      this.leaveSession();
    }
  },

  onRemoteDocumentChange(change: any, originPeerId: string) {
    const state = useUIBuilderStore.getState();
    const { updateNode, addNode, deleteNode, addDecorator, updateDecorator } = state;
    if (change.type === 'update') updateNode(change.nodeId, change.patch);
    if (change.type === 'add') addNode(change.node, change.parentId);
    if (change.type === 'delete') deleteNode(change.nodeId);
    if (change.type === 'add-decorator') addDecorator(change.nodeId, change.decorator);
    if (change.type === 'update-decorator') updateDecorator(change.nodeId, change.decoratorId, change.config);
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
    console.log('[EditorAPI] Initializing UI P2P Event Listeners');
    
    // Existing Native AI Protocol Messages
    messageBus.on<UIPeerStatePayload>('ui/peer-state', (msg) => {
      this.onPeerUpdate(msg.fromPeerId, msg.payload);
    });
    messageBus.on<UICursorPayload>('ui/cursor', (msg) => {
      this.onPeerUpdate(msg.fromPeerId, { cursor: msg.payload });
    });
    messageBus.on<UIDocChangePayload>('ui/doc-change', (msg) => {
      this.onRemoteDocumentChange(msg.payload, msg.fromPeerId);
    });

    messageBus.on('peer/goodbye', (msg) => {
      this.onPeerLeave(msg.fromPeerId);
    });

    // Handle DOC SYNC Requests from new viewers
    messageBus.on<UIDocSyncRequestPayload>(UITypeKeys.DOC_SYNC_REQUEST, (msg) => {
      const state = useUIBuilderStore.getState();
      const localId = peerNetworkManager.getLocalPeerId();
      
      const response = createMessage<UIDocSyncPayload>(UITypeKeys.DOC_SYNC, localId, {
        document: state.document,
        hostPeerId: localId
      }, msg.fromPeerId);
      peerNetworkManager.sendToPeer(msg.fromPeerId, response);
    });

    // Explicit View Sync
    messageBus.on<UIDocSyncPayload>(UITypeKeys.DOC_SYNC, (msg) => {
      const state = useUIBuilderStore.getState();
      // Only accept syncs if we have chosen to join their session
      if (state.hostPeerId === msg.payload.hostPeerId) {
        useUIBuilderStore.getState().setDocument(msg.payload.document);
      }
    });

    // Explicit Edit Access
    messageBus.on<UIEditAccessRequestPayload>(UITypeKeys.EDIT_ACCESS_REQUEST, (msg) => {
      console.log('[EditorAPI] Peer requested EDIT access', msg.fromPeerId);
      useUIBuilderStore.getState().addEditRequest(msg.fromPeerId);
    });

    messageBus.on<UIEditAccessResponsePayload>(UITypeKeys.EDIT_ACCESS_RESPONSE, (msg) => {
      if (msg.payload.status === 'approved') {
        console.log('[EditorAPI] Edit Access granted.');
        useUIBuilderStore.getState().setEditAccess(true);
      } else {
        console.warn('[EditorAPI] Edit Access rejected by host.');
      }
    });

    messageBus.on<UINodeLockRequestPayload>(UITypeKeys.NODE_LOCK_REQUEST, (msg) => {
      const state = useUIBuilderStore.getState();
      const localId = peerNetworkManager.getLocalPeerId();
      
      // Document owner processes lock negotiation
      if (!state.hostPeerId || state.hostPeerId === localId) {
        // Allow all connected peers to request locks for now
        if (true) {
          const currentLock = state.nodeLocks[msg.payload.nodeId];
          const isLocked = currentLock && currentLock !== msg.fromPeerId;
          
          if (!isLocked) {
            state.setNodeLock(msg.payload.nodeId, msg.fromPeerId);
            const responsePayload: UINodeLockResponsePayload = {
              nodeId: msg.payload.nodeId,
              lockedByPeerId: msg.fromPeerId,
              locked: true
            };
            peerNetworkManager.broadcast(createMessage(UITypeKeys.NODE_LOCK_RESPONSE, localId, responsePayload));
          }
        }
      }
    });

    messageBus.on<UINodeLockResponsePayload>(UITypeKeys.NODE_LOCK_RESPONSE, (msg) => {
      useUIBuilderStore.getState().setNodeLock(msg.payload.nodeId, msg.payload.locked ? msg.payload.lockedByPeerId : null);
    });

    messageBus.on<UINodeUnlockPayload>(UITypeKeys.NODE_UNLOCK, (msg) => {
      const state = useUIBuilderStore.getState();
      const localId = peerNetworkManager.getLocalPeerId();
      
      if (!state.hostPeerId || state.hostPeerId === localId) {
        if (state.nodeLocks[msg.payload.nodeId] === msg.fromPeerId) {
          state.setNodeLock(msg.payload.nodeId, null);
          const responsePayload: UINodeLockResponsePayload = {
            nodeId: msg.payload.nodeId,
            lockedByPeerId: msg.fromPeerId,
            locked: false
          };
          peerNetworkManager.broadcast(createMessage(UITypeKeys.NODE_LOCK_RESPONSE, localId, responsePayload));
        }
      }
    });
  }
};
