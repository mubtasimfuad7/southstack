// ============================================================
// CORE: StateManager
// Shared state via Yjs CRDT. Syncs peer awareness, session
// metadata, and agent state across connected peers.
// Uses a custom libp2p provider for Yjs sync messages.
// ============================================================

import * as Y from 'yjs'
import type { P2PNetworkManager } from '@/infrastructure/p2p/P2PNetworkManager'
import { StreamReader, StreamWriter } from '@/infrastructure/p2p/StreamManager'
import type { PeerIdStr } from '@/infrastructure/p2p/types'
import { P2PEvents } from '@/infrastructure/p2p/types'

const YJS_SYNC_PROTOCOL = '/yjs-sync/1.0.0'

interface YjsSyncMessage {
  type: 'sync-step1' | 'sync-step2' | 'update'
  data: number[]  // Uint8Array serialized as number[]
}

// ──────────────────────────────────────────────────────────
// StateManager
// ──────────────────────────────────────────────────────────

export class StateManager {
  readonly doc = new Y.Doc()

  // Shared maps (update these to sync state across peers)
  readonly peers    = this.doc.getMap<Record<string, unknown>>('peers')
  readonly sessions = this.doc.getMap<Record<string, unknown>>('sessions')
  readonly agentLog = this.doc.getArray<string>('agentLog')

  private syncedPeers = new Set<PeerIdStr>()

  constructor(private manager: P2PNetworkManager) {
    // Watch for local Yjs updates and broadcast to all peers
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote') return // don't echo back
      this._broadcastUpdate(update).catch(console.warn)
    })
  }

  // ──────────────────────────────────────────────────────────
  // Start: register Yjs sync handlers and
  // trigger sync on peer join
  // ──────────────────────────────────────────────────────────

  start(): void {
    // Handle incoming Yjs sync streams
    this.manager.handle(YJS_SYNC_PROTOCOL, async (stream, connection) => {
      const peerId = connection.remotePeer.toString()
      const reader = new StreamReader<YjsSyncMessage>(stream)
      const writer = new StreamWriter<YjsSyncMessage>(stream)

      for await (const msg of reader) {
        if (msg.type === 'sync-step1') {
          // Respond with our state vector and full document state
          const diff = Y.encodeStateAsUpdate(this.doc, new Uint8Array(msg.data))

          await writer.write({
            type: 'sync-step2',
            data: Array.from(diff),
          })

          // Apply their state vector update
          Y.applyUpdate(this.doc, new Uint8Array(msg.data), 'remote')
          this.syncedPeers.add(peerId)
        } else if (msg.type === 'sync-step2') {
          Y.applyUpdate(this.doc, new Uint8Array(msg.data), 'remote')
          this.syncedPeers.add(peerId)
        } else if (msg.type === 'update') {
          Y.applyUpdate(this.doc, new Uint8Array(msg.data), 'remote')
        }
      }

      writer.close()
    })

    // When a new peer is authorized, initiate sync
    this.manager.emitter.on(P2PEvents.PEER_AUTHORIZED, ({ peerId }) => {
      this._initiateSync(peerId).catch(console.warn)
    })

    // When peer disconnects, clean up awareness
    this.manager.emitter.on(P2PEvents.PEER_DISCONNECTED, ({ peerId }) => {
      this.syncedPeers.delete(peerId)
      this.peers.delete(peerId)
    })
  }

  stop(): void {
    this.manager.unhandle(YJS_SYNC_PROTOCOL).catch(() => {})
    this.doc.destroy()
  }

  // ──────────────────────────────────────────────────────────
  // Awareness helpers — update local peer info
  // ──────────────────────────────────────────────────────────

  updateLocalAwareness(info: Record<string, unknown>): void {
    const selfId = this.manager.getPeerId()
    this.peers.set(selfId, { ...info, lastSeen: Date.now() })
  }

  logAgentEvent(msg: string): void {
    this.agentLog.push([`[${new Date().toISOString()}] ${msg}`])
  }

  // ──────────────────────────────────────────────────────────
  // Internal
  // ──────────────────────────────────────────────────────────

  private async _initiateSync(peerId: PeerIdStr): Promise<void> {
    if (this.syncedPeers.has(peerId)) return
    try {
      const stream = await this.manager.dialProtocol(peerId, YJS_SYNC_PROTOCOL)
      const writer = new StreamWriter<YjsSyncMessage>(stream)
      const reader = new StreamReader<YjsSyncMessage>(stream)

      // Send our state vector (step 1)
      const sv = Y.encodeStateVector(this.doc)
      await writer.write({ type: 'sync-step1', data: Array.from(sv) })

      // Process sync-step2 response
      for await (const msg of reader) {
        if (msg.type === 'sync-step2') {
          Y.applyUpdate(this.doc, new Uint8Array(msg.data), 'remote')
          this.syncedPeers.add(peerId)
          break
        }
      }

      writer.close()
    } catch (err) {
      console.warn(`[StateManager] Sync failed with ${peerId}:`, err)
    }
  }

  private async _broadcastUpdate(update: Uint8Array): Promise<void> {
    const msg: YjsSyncMessage = { type: 'update', data: Array.from(update) }
    const peers = this.manager.registry.getAuthorized()

    await Promise.allSettled(
      peers.map(async (peer) => {
        if (peer.peerId === this.manager.getPeerId()) return
        try {
          const stream = await this.manager.dialProtocol(peer.peerId, YJS_SYNC_PROTOCOL)
          const writer = new StreamWriter<YjsSyncMessage>(stream)
          await writer.write(msg)
          writer.close()
        } catch {
          // Peer may be temporarily unreachable; non-fatal
        }
      })
    )
  }
}
