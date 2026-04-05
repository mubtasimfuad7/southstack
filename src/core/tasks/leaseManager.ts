// ============================================================
// LEASE MANAGER: Lease-based subtask assignment tracking
// Workers must renew leases; expired leases trigger requeue
// ============================================================

import type { Lease } from '@/core/tasks/taskTypes'

type LeaseExpiredCallback = (subtaskId: string, leaseId: string) => void

class LeaseManager {
  private leases = new Map<string, Lease>()              // leaseId → Lease
  private subtaskToLease = new Map<string, string>()     // subtaskId → leaseId
  private expiredCallbacks = new Set<LeaseExpiredCallback>()
  private checkTimer: ReturnType<typeof setInterval> | null = null

  private static LEASE_DURATION_MS = 25_000
  private static CHECK_INTERVAL_MS = 2_000

  constructor() {
    this.checkTimer = setInterval(() => this._checkExpired(), LeaseManager.CHECK_INTERVAL_MS)
  }

  // ── Create / Renew / Release ───────────────────────────

  createLease(subtaskId: string, workerId: string): Lease {
    // Clear any existing lease for this subtask
    this.releaseLease(subtaskId)

    const lease: Lease = {
      leaseId: `lease-${subtaskId}-${Date.now()}`,
      subtaskId,
      workerId,
      issuedAt: Date.now(),
      expiresAt: Date.now() + LeaseManager.LEASE_DURATION_MS,
      renewedAt: Date.now(),
    }
    this.leases.set(lease.leaseId, lease)
    this.subtaskToLease.set(subtaskId, lease.leaseId)
    return lease
  }

  renewLease(leaseId: string, extendByMs?: number): boolean {
    const lease = this.leases.get(leaseId)
    if (!lease) return false
    const extension = extendByMs ?? LeaseManager.LEASE_DURATION_MS
    lease.expiresAt = Date.now() + extension
    lease.renewedAt = Date.now()
    return true
  }

  releaseLease(subtaskId: string): void {
    const leaseId = this.subtaskToLease.get(subtaskId)
    if (leaseId) {
      this.leases.delete(leaseId)
      this.subtaskToLease.delete(subtaskId)
    }
  }

  // ── Validation ─────────────────────────────────────────

  isValidLease(subtaskId: string, leaseId: string): boolean {
    const stored = this.subtaskToLease.get(subtaskId)
    return stored === leaseId && !this.isExpired(leaseId)
  }

  isExpired(leaseId: string): boolean {
    const lease = this.leases.get(leaseId)
    if (!lease) return true
    return Date.now() > lease.expiresAt
  }

  getLease(subtaskId: string): Lease | undefined {
    const leaseId = this.subtaskToLease.get(subtaskId)
    return leaseId ? this.leases.get(leaseId) : undefined
  }

  // ── Callbacks ──────────────────────────────────────────

  onLeaseExpired(cb: LeaseExpiredCallback): () => void {
    this.expiredCallbacks.add(cb)
    return () => this.expiredCallbacks.delete(cb)
  }

  private _checkExpired(): void {
    const now = Date.now()
    for (const lease of this.leases.values()) {
      if (now > lease.expiresAt) {
        this.leases.delete(lease.leaseId)
        this.subtaskToLease.delete(lease.subtaskId)
        this.expiredCallbacks.forEach((cb) => cb(lease.subtaskId, lease.leaseId))
      }
    }
  }

  dispose(): void {
    if (this.checkTimer) clearInterval(this.checkTimer)
  }
}

export const leaseManager = new LeaseManager()
