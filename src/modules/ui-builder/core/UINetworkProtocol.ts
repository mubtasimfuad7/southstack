import { MessageType } from '@/core/network/protocol';
import { DesignDocument } from './DesignDocument';

// ── Overloaded Protocol Definitions ──────────────────────────────────────────
// These types use TypeScript casting to ride on the existing messageBus without modifying the core system schema.

export const UITypeKeys = {
  DOC_SYNC_REQUEST: 'ui/doc-sync-request' as MessageType,
  DOC_SYNC: 'ui/doc-sync' as MessageType,
  EDIT_ACCESS_REQUEST: 'ui/edit-access-request' as MessageType,
  EDIT_ACCESS_RESPONSE: 'ui/edit-access-response' as MessageType,
  NODE_LOCK_REQUEST: 'ui/node-lock-request' as MessageType,
  NODE_LOCK_RESPONSE: 'ui/node-lock-response' as MessageType,
  NODE_UNLOCK: 'ui/node-unlock' as MessageType,
  ASSET_ACCESS_REQUEST: 'ui/asset-access-request' as MessageType,
  ASSET_ACCESS_RESPONSE: 'ui/asset-access-response' as MessageType,
};

export interface UIDocSyncRequestPayload {
  requestingPeerId: string;
}

export interface UIDocSyncPayload {
  document: DesignDocument;
  hostPeerId: string;
}

export interface UIEditAccessRequestPayload {
  requestingPeerId: string;
}

export interface UIEditAccessResponsePayload {
  status: 'approved' | 'rejected';
}

export interface UINodeLockRequestPayload {
  requestingPeerId: string;
  nodeId: string;
}

export interface UINodeLockResponsePayload {
  nodeId: string;
  lockedByPeerId: string;
  locked: boolean;
}

export interface UINodeUnlockPayload {
  peerId: string;
  nodeId: string;
}

export interface UIAssetAccessRequestPayload {
  assetId: string;
  fileName: string;
  requestingPeerId: string;
}

export interface UIAssetAccessResponsePayload {
  assetId: string;
  approved: boolean;
  fileName: string;
  mimeType?: string;
  size?: number;
  dataUrl?: string;
}
