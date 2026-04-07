// ============================================================
// PEER SELECTORS: Eligibility queries over the peer registry
// ============================================================

import { peerStateStore } from './PeerStateStore'
import type { PeerStatus } from '@/core/tasks/taskTypes'

/** Peers that can accept a remote subtask right now */
export function getEligibleWorkers(): PeerStatus[] {
  const peers = [...peerStateStore.getRemotePeers().values()]
  const eligible = peers.filter(
    (p) =>
      p.state === 'idle' &&
      p.acceptsRemoteTasks &&
      p.capabilities.protocolVersion === '0.1.0',
  )
  
  if (eligible.length === 0 && peers.length > 0) {
    console.debug('[PeerSelectors] No eligible workers found. Peer states:', 
      peers.map(p => ({ id: p.peerId, state: p.state, accepts: p.acceptsRemoteTasks }))
    )
  }
  
  return eligible
}

/** Eligible workers sorted by reliability (desc) then latency (asc) */
export function getRankedWorkers(): PeerStatus[] {
  return getEligibleWorkers().sort((a, b) => {
    const reliabilityDiff = b.reliabilityScore - a.reliabilityScore
    if (reliabilityDiff !== 0) return reliabilityDiff
    return (a.latencyMs ?? 999) - (b.latencyMs ?? 999)
  })
}

/** All connected non-offline peers */
export function getActivePeers(): PeerStatus[] {
  return [...peerStateStore.getRemotePeers().values()].filter(
    (p) => p.state !== 'offline',
  )
}
