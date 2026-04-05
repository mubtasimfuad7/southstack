// ============================================================
// VITE SIGNALING PLUGIN: Embedded WebSocket signaling server
// Auto-starts with npm run dev --host
// No extra terminal needed. Relays SDP/ICE between LAN peers.
// ============================================================

import type { Plugin } from 'vite'
import { WebSocketServer, type WebSocket } from 'ws'

interface Client {
  peerId: string
  ws: WebSocket
}

export function signalingPlugin(): Plugin {
  return {
    name: 'p2p-signaling',
    configureServer(server) {
      const wss = new WebSocketServer({ noServer: true })
      const clients = new Map<string, Client>()  // peerId → client

      wss.on('connection', (ws) => {
        let peerId = ''

        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString()) as {
              type: string
              peerId?: string
              toPeerId?: string
              fromPeerId?: string
              [key: string]: unknown
            }

            if (msg.type === 'announce' && msg.peerId) {
              peerId = msg.peerId
              clients.set(peerId, { peerId, ws })

              // Tell the new peer who else is connected
              const existingPeerIds = [...clients.keys()].filter((id) => id !== peerId)
              ws.send(JSON.stringify({ type: 'peers', peers: existingPeerIds }))

              // Notify existing peers about the newcomer
              for (const [id, client] of clients) {
                if (id !== peerId && client.ws.readyState === 1) {
                  client.ws.send(JSON.stringify({ type: 'peers', peers: [peerId] }))
                }
              }
            } else if (msg.toPeerId) {
              // Relay to specific peer
              const target = clients.get(msg.toPeerId as string)
              if (target?.ws.readyState === 1) {
                target.ws.send(JSON.stringify({ ...msg, fromPeerId: peerId }))
              }
            }
          } catch (e) {
            console.warn('[signaling] parse error', e)
          }
        })

        ws.on('close', () => {
          if (peerId) {
            clients.delete(peerId)
            console.log(`[signaling] Peer left: ${peerId} (${clients.size} remaining)`)
          }
        })

        ws.on('error', () => {
          if (peerId) clients.delete(peerId)
        })
      })

      // Hook into Vite's HTTP server upgrade
      server.httpServer?.on('upgrade', (request, socket, head) => {
        if (request.url === '/signaling') {
          wss.handleUpgrade(request, socket as import('node:net').Socket, head, (ws) => {
            wss.emit('connection', ws, request)
          })
        }
      })

      console.log('[signaling] P2P signaling server ready at ws://<host>/signaling')
    },
  }
}
