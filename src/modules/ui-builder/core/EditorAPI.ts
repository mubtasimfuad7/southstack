import { useUIBuilderStore, type UIUploadedAsset } from '../store';
import { DesignNode } from './DesignNode';
import { messageBus } from '@/core/network/messageBus';
import { createMessage, UIPeerStatePayload, UICursorPayload, UIDocChangePayload } from '@/core/network/protocol';
import { peerNetworkManager } from '@/core/network/PeerNetworkManager';
import { UITypeKeys, UIDocSyncPayload, UIDocSyncRequestPayload, UIAssetAccessRequestPayload, UIAssetAccessResponsePayload, UIEditAccessRequestPayload, UIEditAccessResponsePayload, UINodeLockRequestPayload, UINodeLockResponsePayload, UINodeUnlockPayload } from './UINetworkProtocol';

/**
 * EditorAPI is the unified control layer for all UI Builder operations.
 */
export const EditorAPI = {
  // --- LOCAL ACTIONS ---

  select(nodeIds: string[], multiple = false) {
    const state = useUIBuilderStore.getState();
    
    // Release previous locks
    if (state.hasEditAccess) {
      state.selectedNodeIds.forEach(id => this.releaseNodeLock(id));
    }
    
    state.selectNodes(nodeIds, multiple);
    this.broadcastLocalState();
    
    // Request new locks
    if (state.hasEditAccess) {
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

  replaceDocument(document: any, uploadedAssets: Record<string, UIUploadedAsset> = {}) {
    const state = useUIBuilderStore.getState();
    const localId = peerNetworkManager.getLocalPeerId();
    state.loadDesignBundle(document, uploadedAssets);

    // Full-document replacement is safest when performed by the local host.
    if (!localId) return;
    if (!state.hostPeerId || state.hostPeerId === localId) {
      const msg = createMessage<UIDocSyncPayload>(UITypeKeys.DOC_SYNC, localId, {
        document,
        hostPeerId: localId
      });
      peerNetworkManager.broadcast(msg);
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

  requestAssetAccess(assetId: string, ownerPeerId: string, fileName: string) {
    const state = useUIBuilderStore.getState();
    if (state.uploadedAssets[assetId] || state.requestedAssetIds[assetId] === 'requested') return;

    const localId = peerNetworkManager.getLocalPeerId();
    state.markAssetRequested(assetId);
    const msg = createMessage<UIAssetAccessRequestPayload>(UITypeKeys.ASSET_ACCESS_REQUEST, localId, {
      assetId,
      fileName,
      requestingPeerId: localId
    }, ownerPeerId);
    peerNetworkManager.sendToPeer(ownerPeerId, msg);
  },

  respondToAssetRequest(assetId: string, peerId: string, approved: boolean) {
    const state = useUIBuilderStore.getState();
    const asset = state.uploadedAssets[assetId];
    state.resolveAssetRequest(assetId, peerId);

    const localId = peerNetworkManager.getLocalPeerId();
    const msg = createMessage<UIAssetAccessResponsePayload>(UITypeKeys.ASSET_ACCESS_RESPONSE, localId, {
      assetId,
      approved: approved && !!asset,
      fileName: asset?.fileName || 'Private photo',
      mimeType: asset?.mimeType,
      size: asset?.size,
      dataUrl: approved ? asset?.dataUrl : undefined
    }, peerId);
    peerNetworkManager.sendToPeer(peerId, msg);
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

  respondToJoinRequest(peerId: string, approved: boolean) {
    const localId = peerNetworkManager.getLocalPeerId();
    const state = useUIBuilderStore.getState();
    state.resolveJoinRequest(peerId, approved);

    if (approved) {
      // Send document to the new peer
      const msg = createMessage<UIDocSyncPayload>(UITypeKeys.DOC_SYNC, localId, {
        document: state.document,
        hostPeerId: localId
      }, peerId);
      peerNetworkManager.sendToPeer(peerId, msg);

      // Also grant edit access by default as requested by the user flow ("trusted")
      const accessMsg = createMessage<UIEditAccessResponsePayload>(UITypeKeys.EDIT_ACCESS_RESPONSE, localId, {
        status: 'approved'
      }, peerId);
      peerNetworkManager.sendToPeer(peerId, accessMsg);
    }
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
    useUIBuilderStore.getState().updatePeerState(peerId, patch);
  },

  onPeerLeave(peerId: string) {
    const state = useUIBuilderStore.getState();
    const localId = peerNetworkManager.getLocalPeerId();
    
    // Clear any locks held by the disconnected peer
    Object.entries(state.nodeLocks).forEach(([nodeId, holderId]) => {
      if (holderId === peerId) {
        state.setNodeLock(nodeId, null);
        // If we are the host, broadcast the unlock to everyone else
        if (!state.hostPeerId || state.hostPeerId === localId) {
          const responsePayload: UINodeLockResponsePayload = { nodeId, lockedByPeerId: peerId, locked: false };
          peerNetworkManager.broadcast(createMessage(UITypeKeys.NODE_LOCK_RESPONSE, localId, responsePayload));
        }
      }
    });

    state.removePeerState(peerId);

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
      console.log('[EditorAPI] Peer requested to JOIN session', msg.fromPeerId);
      useUIBuilderStore.getState().addJoinRequest(msg.fromPeerId);
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

    messageBus.on<UIAssetAccessRequestPayload>(UITypeKeys.ASSET_ACCESS_REQUEST, (msg) => {
      const state = useUIBuilderStore.getState();
      const asset = state.uploadedAssets[msg.payload.assetId];
      if (!asset) return;

      // Automatically approve if peer is already allowed (trusted)
      if (state.allowedPeers.includes(msg.fromPeerId)) {
        this.respondToAssetRequest(msg.payload.assetId, msg.fromPeerId, true);
        return;
      }

      state.addPendingAssetRequest({
        assetId: msg.payload.assetId,
        fileName: msg.payload.fileName || asset.fileName,
        peerId: msg.payload.requestingPeerId || msg.fromPeerId
      });
    });

    messageBus.on<UIAssetAccessResponsePayload>(UITypeKeys.ASSET_ACCESS_RESPONSE, (msg) => {
      if (msg.payload.approved && msg.payload.dataUrl) {
        useUIBuilderStore.getState().addUploadedAsset({
          id: msg.payload.assetId,
          fileName: msg.payload.fileName,
          mimeType: msg.payload.mimeType || 'image/*',
          size: msg.payload.size || 0,
          dataUrl: msg.payload.dataUrl,
          ownerPeerId: msg.fromPeerId
        });
      } else {
        useUIBuilderStore.getState().markAssetDenied(msg.payload.assetId);
      }
    });

    messageBus.on<UINodeLockRequestPayload>(UITypeKeys.NODE_LOCK_REQUEST, (msg) => {
      const state = useUIBuilderStore.getState();
      const localId = peerNetworkManager.getLocalPeerId();
      
      // Document owner processes lock negotiation
      if (!state.hostPeerId || state.hostPeerId === localId) {
        // Only grant locks to allowed peers
        if (state.allowedPeers.includes(msg.fromPeerId)) {
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

    // --- ORPHANED LOCK CLEANUP ---
    // Periodically check for locks held by peers that are no longer connected
    setInterval(() => {
      const state = useUIBuilderStore.getState();
      const localId = peerNetworkManager.getLocalPeerId();
      
      // Only the host should perform global cleanup
      if (!state.hostPeerId || state.hostPeerId === localId) {
        const connectedPeers = peerNetworkManager.getConnectedPeers();
        Object.entries(state.nodeLocks).forEach(([nodeId, holderId]) => {
          // If the holder is not us and not in the connected peers list, clear it
          if (holderId !== localId && !connectedPeers.includes(holderId)) {
            console.log(`[EditorAPI] Cleaning up orphaned lock for node ${nodeId} held by offline peer ${holderId}`);
            this.onPeerLeave(holderId);
          }
        });
      }
    }, 5000);
  }
};
