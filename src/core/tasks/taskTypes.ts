// ============================================================
// P2P TASK TYPES: Core data models for tasks, subtasks, leases
// ============================================================

import type { ToolName, PeerLocalState, PeerCapabilities } from '@/core/network/protocol'

// ── Peer Status ────────────────────────────────────────────

export interface PeerStatus {
  peerId: string
  displayName: string
  state: PeerLocalState
  currentTaskIds: string[]
  acceptsRemoteTasks: boolean
  capabilities: PeerCapabilities
  lastHeartbeat: number
  reliabilityScore: number   // 0.0–1.0, starts at 0.8, adjusted on success/fail
  latencyMs?: number
}

// ── Root Task ──────────────────────────────────────────────

export type RootTaskStatus =
  | 'planning'
  | 'running'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface RootTask {
  id: string
  ownerPeerId: string
  prompt: string
  status: RootTaskStatus
  createdAt: number
  updatedAt: number
  subtaskIds: string[]
  verificationResult?: { pass: boolean; issues: string[] }
  metadata?: {
    planningProgress?: {
      tokenCount: number
      elapsed: number
      status: string
      tokens: string[]
      finished?: boolean
    }
  }
}

// ── Subtask ────────────────────────────────────────────────

export type SubtaskStatus =
  | 'queued'            // waiting; deps may be unresolved
  | 'assigned'          // offer sent, not yet accepted
  | 'in_progress'       // worker accepted + running
  | 'awaiting_tool_result'  // worker waiting for tool response
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'requeued'          // was in_progress, dropped back to queue
  | 'cancelled'

export interface Subtask {
  id: string
  rootTaskId: string
  initiatorPeerId: string
  assignedPeerId?: string

  title: string
  description: string
  expectedOutput: string
  targetPaths: string[]
  allowedTools: ToolName[]

  /** IDs of subtasks that must be 'completed' before this one can be dispatched */
  dependencies: string[]
  lockedFiles: string[]

  status: SubtaskStatus
  retryCount: number
  maxRetries: number

  leaseId?: string
  leaseExpiresAt?: number
  progress?: number
  statusText?: string
  resultSummary?: string
  filesWritten?: string[]
  failureReason?: string

  // Worker model thinking (visible to UI)
  workerThinking?: {
    iteration: number
    modelResponse?: string
    toolCall?: {
      tool: string
      input: Record<string, unknown>
    }
    tokensGenerated?: number
    timeElapsed?: number
  }
  workerThinkingHistory?: Array<{
    iteration: number
    modelResponse?: string
    toolCall?: {
      tool: string
      input: Record<string, unknown>
    }
    tokensGenerated?: number
    timeElapsed?: number
  }>

  createdAt: number
  updatedAt: number
}

// ── Lease ─────────────────────────────────────────────────

export interface Lease {
  leaseId: string
  subtaskId: string
  workerId: string
  issuedAt: number
  expiresAt: number
  renewedAt: number
}

// ── Tool Request / Response ────────────────────────────────

export interface ToolRequest {
  requestId: string
  taskId: string
  subtaskId: string
  workerPeerId: string
  tool: ToolName
  args: Record<string, unknown>
  issuedAt: number
}

export interface ToolLogEntry {
  id: string
  at: number
  tool: ToolName
  args: Record<string, unknown>
  workerPeerId: string
  subtaskId: string
  result?: unknown
  error?: string
  durationMs?: number
}

// ── Dependency resolution helper ───────────────────────────

/** Returns true if all dependencies of a subtask are completed */
export function areDepsResolved(
  subtask: Subtask,
  allSubtasks: Map<string, Subtask>,
): boolean {
  return subtask.dependencies.every((depId) => {
    const dep = allSubtasks.get(depId)
    return dep?.status === 'completed'
  })
}

/** Get subtasks that are eligible to be dispatched right now */
export function getDispatchableSubtasks(
  subtasks: Map<string, Subtask>,
): Subtask[] {
  return [...subtasks.values()].filter(
    (s) => s.status === 'queued' && areDepsResolved(s, subtasks),
  )
}
