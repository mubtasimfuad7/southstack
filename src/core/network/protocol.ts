// ============================================================
// P2P PROTOCOL: Versioned message envelope + all typed payloads
// All WebRTC data channel messages use this format.
// ============================================================

export const PROTOCOL_VERSION = '0.1.0' as const

// ── Base envelope ──────────────────────────────────────────

export interface P2PMessage<T = unknown> {
  id: string
  type: MessageType
  protocolVersion: typeof PROTOCOL_VERSION
  fromPeerId: string
  toPeerId?: string       // undefined = broadcast
  timestamp: number
  payload: T
}

// ── Message type registry ──────────────────────────────────

export type MessageType =
  | 'peer/hello'
  | 'peer/status'
  | 'peer/heartbeat'
  | 'peer/goodbye'
  | 'task/offer'
  | 'task/accept'
  | 'task/reject'
  | 'task/progress'
  | 'task/result'
  | 'task/cancel'
  | 'task/requeue'
  | 'lease/renew'
  | 'lease/expired'
  | 'tool/request'
  | 'tool/response'
  | 'tool/error'
  | 'sync/peer_snapshot'
  | 'ui/peer-state'
  | 'ui/cursor'
  | 'ui/doc-change'

// ── Peer state ─────────────────────────────────────────────

export type PeerLocalState =
  | 'model_loading'   // joined but model not ready (visible, not eligible)
  | 'idle'            // ready to accept remote tasks
  | 'busy_self'       // executing own task (not available)
  | 'busy_remote'     // executing remote task (not available for more)
  | 'offline'
  | 'error'

export interface PeerCapabilities {
  modelName: string
  maxConcurrentRemoteTasks: number
  supportedTools: ToolName[]
  protocolVersion: typeof PROTOCOL_VERSION
}

// ── Payload types ──────────────────────────────────────────

export interface HelloPayload {
  displayName: string
  state: PeerLocalState
  capabilities: PeerCapabilities
  acceptsRemoteTasks: boolean
}

export interface StatusPayload {
  state: PeerLocalState
  currentTaskIds: string[]
  acceptsRemoteTasks: boolean
  reliabilityScore: number
}

export interface HeartbeatPayload {
  state: PeerLocalState
  acceptsRemoteTasks: boolean
}

export interface GoodbyePayload {
  reason?: string
}

export interface TaskOfferPayload {
  subtaskId: string
  rootTaskId: string
  initiatorPeerId: string
  title: string
  description: string
  expectedOutput: string
  targetPaths: string[]
  allowedTools: ToolName[]
  dependencies: string[]    // subtask IDs that must be completed first
  lockedFiles: string[]
  leaseId: string
  leaseExpiresAt: number
  maxRetries: number
}

export interface TaskAcceptPayload {
  subtaskId: string
  leaseId: string
}

export interface TaskRejectPayload {
  subtaskId: string
  reason: string
}

export interface TaskProgressPayload {
  subtaskId: string
  leaseId: string
  progress: number          // 0–100
  statusText: string
  workerThinking?: {        // Model reasoning visible to orchestrator
    iteration: number
    modelResponse?: string  // Last model output (first 500 chars)
    toolCall?: {
      tool: string
      input: Record<string, unknown>
    }
    tokensGenerated?: number
    timeElapsed?: number
  }
}

export interface TaskResultPayload {
  subtaskId: string
  leaseId: string
  success: boolean
  resultSummary: string
  filesWritten: string[]
}

export interface TaskCancelPayload {
  subtaskId: string
  leaseId: string
  reason: string
}

export interface TaskRequeuePayload {
  subtaskId: string
  reason: string
}

export interface LeaseRenewPayload {
  subtaskId: string
  leaseId: string
  extendByMs: number
}

export interface LeaseExpiredPayload {
  subtaskId: string
  leaseId: string
}

// ── Tool types ─────────────────────────────────────────────

export type ToolName =
  | 'getProjectTree'
  | 'listFiles'
  | 'readFile'
  | 'writeFile'
  | 'deleteFile'
  | 'mkdir'
  | 'moveFile'
  | 'searchFiles'

export interface ToolRequestPayload {
  requestId: string
  taskId: string
  subtaskId: string
  workerPeerId: string
  tool: ToolName
  args: Record<string, unknown>
  issuedAt: number
}

export interface ToolResponsePayload {
  requestId: string
  result: unknown
}

export interface ToolErrorPayload {
  requestId: string
  error: string
}

export interface PeerSnapshotPayload {
  peers: Array<{
    peerId: string
    state: PeerLocalState
    capabilities: PeerCapabilities
    acceptsRemoteTasks: boolean
    lastHeartbeat: number
    reliabilityScore: number
  }>
}

// ── UI Builder types ───────────────────────────────────────

export interface UIPeerStatePayload {
  selection: string[]
  hoveredNodeId: string | null
  userName?: string
  color?: string
}

export interface UICursorPayload {
  x: number
  y: number
}

export interface UIDocChangePayload {
  type: 'update' | 'add' | 'delete' | 'add-decorator' | 'update-decorator'
  nodeId?: string
  patch?: Record<string, any>
  node?: any
  parentId?: string
  decorator?: any
  decoratorId?: string
  config?: any
}

// ── Factory ────────────────────────────────────────────────

let _msgCounter = 0

export function createMessage<T>(
  type: MessageType,
  fromPeerId: string,
  payload: T,
  toPeerId?: string,
): P2PMessage<T> {
  return {
    id: `${fromPeerId}-${Date.now()}-${++_msgCounter}`,
    type,
    protocolVersion: PROTOCOL_VERSION,
    fromPeerId,
    toPeerId,
    timestamp: Date.now(),
    payload,
  }
}

// ── Type guards ────────────────────────────────────────────

export function isValidMessage(raw: unknown): raw is P2PMessage {
  if (typeof raw !== 'object' || raw === null) return false
  const m = raw as Record<string, unknown>
  return (
    typeof m.id === 'string' &&
    typeof m.type === 'string' &&
    typeof m.fromPeerId === 'string' &&
    typeof m.timestamp === 'number' &&
    m.protocolVersion === PROTOCOL_VERSION
  )
}
