export type PeerIdStr = string

export type PeerAvailability = 'available' | 'busy' | 'offline'

export interface PeerModelAvailability {
  id: string
  status: PeerAvailability
}

export interface PeerMetadata {
  peerId: PeerIdStr
  multiaddrs: string[]
  models: string[]
  modelStatus: Record<string, PeerAvailability>
  modelReady: boolean
  transportReady: boolean
  availability: PeerAvailability
  load: number
  latencyMs: number
  authorized: boolean
  connectedAt: number
  lastSeen: number
  totalRequests: number
  failedRequests: number
  roomCode?: string
}

export interface SignalingPeerRecord {
  peerId: PeerIdStr
  multiaddrs: string[]
  models?: string[]
  modelReady?: boolean
  availability?: PeerAvailability
  roomCode?: string
}

export interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate' | 'peer-list' | 'announce' | 'announce-leave' | 'relay-info'
  from?: string
  to?: string
  payload: unknown
}

export interface AuthRequest {
  type: 'auth_request'
  roomCode: string
  peerId: PeerIdStr
  multiaddrs: string[]
  models: string[]
  modelReady?: boolean
  timestamp: number
}

export interface AuthResponse {
  type: 'auth_response'
  accepted: boolean
  peerId: PeerIdStr
  roomCode: string
  multiaddrs: string[]
  models: string[]
  modelReady?: boolean
  reason?: string
}

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface InferenceRequest {
  type: 'inference_request'
  requestId: string
  messages: ChatMessage[]
  modelId: string
  maxTokens?: number
  temperature?: number
}

export interface InferenceAck {
  type: 'inference_ack'
  requestId: string
  accepted: boolean
  reason?: string
}

export interface TokenChunk {
  type: 'token_chunk'
  requestId: string
  token: string
  done: boolean
  totalTokens?: number
}

export interface StreamCancel {
  type: 'stream_cancel'
  requestId: string
  reason: string
}

export interface ModelDiscoveryRequest {
  type: 'model_discovery_request'
}

export interface ModelDiscoveryResponse {
  type: 'model_discovery_response'
  peerId: PeerIdStr
  roomCode: string
  models: string[]
  modelStatus: Record<string, PeerAvailability>
  modelReady: boolean
  availability: PeerAvailability
}

export interface PeerRegistryAnnouncement {
  type: 'peer_registry_announcement'
  peerId: PeerIdStr
  roomCode: string
  multiaddrs: string[]
  models: string[]
  modelStatus: Record<string, PeerAvailability>
  modelReady: boolean
  load: number
  availability: PeerAvailability
  timestamp: number
}

export interface PeerRegistryRequest {
  type: 'peer_registry_request'
  peerId: PeerIdStr
  roomCode: string
  timestamp: number
}

export interface ToolRPCRequest {
  type: 'tool_rpc_request'
  requestId: string
  toolName: string
  input: Record<string, unknown>
  callerPeerId: PeerIdStr
}

export interface ToolRPCResponse {
  type: 'tool_rpc_response'
  requestId: string
  result?: unknown
  error?: string
}

export interface PreemptSignal {
  type: 'preempt'
  requestId: string
  reason: string
}

export interface CheckpointData {
  requestId: string
  messages: ChatMessage[]
  tokensGenerated: string
  toolHistory: ToolRPCResponse[]
  stepIndex: number
  timestamp: number
}

export type P2PMessage =
  | AuthRequest
  | AuthResponse
  | InferenceRequest
  | InferenceAck
  | TokenChunk
  | StreamCancel
  | ToolRPCRequest
  | ToolRPCResponse
  | PreemptSignal
  | ModelDiscoveryRequest
  | ModelDiscoveryResponse
  | PeerRegistryRequest
  | PeerRegistryAnnouncement

export const P2PEvents = {
  NODE_STARTED: 'node:started',
  NODE_STOPPED: 'node:stopped',
  PEER_CONNECTED: 'peer:connected',
  PEER_DISCONNECTED: 'peer:disconnected',
  PEER_AUTHORIZED: 'peer:authorized',
  PEER_REJECTED: 'peer:rejected',
  INFERENCE_REQUEST: 'inference:request',
  INFERENCE_TOKEN: 'inference:token',
  INFERENCE_DONE: 'inference:done',
  INFERENCE_ERROR: 'inference:error',
  TOOL_RPC_REQUEST: 'tool:rpc:request',
  TOOL_RPC_RESPONSE: 'tool:rpc:response',
  PREEMPT: 'preempt',
  CHECKPOINT_SAVED: 'checkpoint:saved',
  MODELS_DISCOVERED: 'models:discovered',
  PEER_REGISTRY_UPDATED: 'peer:registry:updated',
  ERROR: 'error',
} as const

export interface P2PEventMap {
  [key: string]: unknown
  [P2PEvents.NODE_STARTED]: { listenAddrs: string[] }
  [P2PEvents.NODE_STOPPED]: Record<string, never>
  [P2PEvents.PEER_CONNECTED]: { peerId: PeerIdStr; multiaddr: string }
  [P2PEvents.PEER_DISCONNECTED]: { peerId: PeerIdStr }
  [P2PEvents.PEER_AUTHORIZED]: { peerId: PeerIdStr; metadata: PeerMetadata }
  [P2PEvents.PEER_REJECTED]: { peerId: PeerIdStr; reason: string }
  [P2PEvents.INFERENCE_REQUEST]: InferenceRequest
  [P2PEvents.INFERENCE_TOKEN]: TokenChunk
  [P2PEvents.INFERENCE_DONE]: { requestId: string; fullText: string }
  [P2PEvents.INFERENCE_ERROR]: { requestId: string; error: string }
  [P2PEvents.TOOL_RPC_REQUEST]: ToolRPCRequest
  [P2PEvents.TOOL_RPC_RESPONSE]: ToolRPCResponse
  [P2PEvents.PREEMPT]: PreemptSignal
  [P2PEvents.CHECKPOINT_SAVED]: CheckpointData
  [P2PEvents.MODELS_DISCOVERED]: { peerId: PeerIdStr; models: string[]; modelStatus: Record<string, PeerAvailability> }
  [P2PEvents.PEER_REGISTRY_UPDATED]: { peerId: PeerIdStr; metadata: PeerMetadata }
  [P2PEvents.ERROR]: { message: string; error?: unknown }
}

export interface AgentStepConfig {
  maxSteps: number
  maxToolCalls: number
  stepTimeoutMs: number
  totalTimeoutMs: number
}

export const DEFAULT_AGENT_CONFIG: AgentStepConfig = {
  maxSteps: 20,
  maxToolCalls: 50,
  stepTimeoutMs: 30_000,
  totalTimeoutMs: 300_000,
}

export interface PeerScore {
  peerId: PeerIdStr
  score: number
  latencyMs: number
  load: number
  successRate: number
  modelCompatible: boolean
}
