import type { Plugin, PreviewServer, ViteDevServer } from 'vite'
import os from 'node:os'
import path from 'node:path'
import type { IncomingMessage } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import { getCertificate } from '@vitejs/plugin-basic-ssl'

const SIGNAL_PATH = '/__signal'
const RELAY_PORT = 9091

type PeerRecord = {
  ws: WebSocket
  multiaddrs: string[]
  models: string[]
  modelReady: boolean
  availability: string
  roomCode: string
}

function getPreferredLanHost(): string | null {
  const interfaces = os.networkInterfaces()

  for (const group of Object.values(interfaces)) {
    for (const iface of group ?? []) {
      if (iface == null || iface.family !== 'IPv4' || iface.internal) {
        continue
      }

      if (
        iface.address.startsWith('192.168.') ||
        iface.address.startsWith('10.') ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(iface.address)
      ) {
        return iface.address
      }
    }
  }

  for (const group of Object.values(interfaces)) {
    for (const iface of group ?? []) {
      if (iface == null || iface.family !== 'IPv4' || iface.internal) {
        continue
      }

      return iface.address
    }
  }

  return null
}

function replaceRelayHost(ma: string, hostHeader?: string): string {
  const host = String(hostHeader ?? '').split(':')[0]
  const lanHost = getPreferredLanHost()
  const fallbackHost = lanHost || host

  if (!fallbackHost) {
    return ma
  }

  if (!host || host === '0.0.0.0' || host === 'localhost' || host === '127.0.0.1') {
    return ma.replace(/\/ip4\/(0\.0\.0\.0|127\.0\.0\.1)\//, `/ip4/${fallbackHost}/`)
  }

  return ma.replace(/\/ip4\/(0\.0\.0\.0|127\.0\.0\.1)\//, `/ip4/${host}/`)
}

function getPublicRelayMultiaddrs(relayNode: { getMultiaddrs(): Array<{ toString(): string }> }, hostHeader?: string): string[] {
  return relayNode
    .getMultiaddrs()
    .map((addr) => replaceRelayHost(addr.toString(), hostHeader))
    .filter((addr, index, all) => all.indexOf(addr) === index)
    .filter((addr) => !addr.includes('/ip4/127.0.0.1/'))
}

async function createRelayNode() {
  const certificate = await getCertificate(path.join('node_modules', '.vite', 'basic-ssl'))
  const [{ createLibp2p }, { webSockets }, { noise }, { yamux }, { identify }, relayModule] = await Promise.all([
    import('libp2p'),
    import('@libp2p/websockets'),
    import('@libp2p/noise'),
    import('@libp2p/yamux'),
    import('@libp2p/identify'),
    import('@libp2p/circuit-relay-v2'),
  ])

  const relayNode = await createLibp2p({
    start: false,
    addresses: {
      listen: [`/ip4/0.0.0.0/tcp/${RELAY_PORT}/tls/ws`],
    },
    transports: [webSockets({
      https: {
        key: certificate,
        cert: certificate,
      },
    })],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    connectionGater: {
      denyDialMultiaddr: async () => false,
    },
    services: {
      identify: identify(),
      relay: relayModule.circuitRelayServer(),
    },
  })

  await relayNode.start()
  return relayNode
}

function shouldHandleUpgrade(req: IncomingMessage): boolean {
  try {
    const url = new URL(req.url ?? '/', 'https://southstack.local')
    return url.pathname === SIGNAL_PATH
  } catch {
    return false
  }
}

export function embeddedSignalingPlugin(): Plugin {
  let initialized = false
  let shuttingDown = false

  return {
    name: 'southstack-embedded-signaling',
    apply: 'serve',
    configureServer(server) {
      void attachEmbeddedSignaling(server, () => initialized, (value) => {
        initialized = value
      }, () => shuttingDown, (value) => {
        shuttingDown = value
      })
    },
    configurePreviewServer(server) {
      void attachEmbeddedSignaling(server, () => initialized, (value) => {
        initialized = value
      }, () => shuttingDown, (value) => {
        shuttingDown = value
      })
    },
  }
}

async function attachEmbeddedSignaling(
  server: ViteDevServer | PreviewServer,
  getInitialized: () => boolean,
  setInitialized: (value: boolean) => void,
  getShuttingDown: () => boolean,
  setShuttingDown: (value: boolean) => void,
): Promise<void> {
  if (getInitialized()) return

  const httpServer = server.httpServer
  if (!httpServer) {
    console.warn('[Signal] Vite HTTP server is unavailable; embedded signaling was not started.')
    return
  }

  setInitialized(true)

  const relayNode = await createRelayNode()
  const peers = new Map<string, PeerRecord>()
  const wss = new WebSocketServer({ noServer: true })
  const seenSockets = new WeakSet<object>()

  const closePeer = (selfId: string | null) => {
    if (!selfId) return

    peers.delete(selfId)
    console.log(`[Signal] Peer left: ${selfId} (remaining: ${peers.size})`)

    const leave = JSON.stringify({ type: 'announce-leave', from: selfId, payload: {} })
    for (const [, { ws: peerWs }] of peers) {
      if (peerWs.readyState === WebSocket.OPEN) {
        peerWs.send(leave)
      }
    }
  }

  wss.on('connection', (ws, req) => {
    let selfId: string | null = null
    const relayMultiaddrs = getPublicRelayMultiaddrs(relayNode, req.headers.host)

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'relay-info',
        from: 'server',
        payload: { multiaddrs: relayMultiaddrs },
      }))
    }

    ws.on('message', (raw) => {
      let msg: {
        type?: string
        from?: string
        to?: string
        payload?: { roomCode?: string; multiaddrs?: string[]; models?: string[]; modelReady?: boolean; availability?: string }
      }

      try {
        msg = JSON.parse(raw.toString()) as typeof msg
      } catch {
        return
      }

      const { type, from, to, payload } = msg

      if (type === 'announce' && from) {
        selfId = from
        const roomCode = payload?.roomCode ?? ''
        peers.set(selfId, {
          ws,
          multiaddrs: payload?.multiaddrs ?? [],
          models: payload?.models ?? [],
          modelReady: payload?.modelReady ?? false,
          availability: payload?.availability ?? 'offline',
          roomCode,
        })
        console.log(`[Signal] Peer announced: ${selfId} in room ${roomCode || '(none)'} (total: ${peers.size})`)

        const announcement = JSON.stringify({
          type: 'announce',
          from: selfId,
          payload: {
            multiaddrs: payload?.multiaddrs ?? [],
            models: payload?.models ?? [],
            modelReady: payload?.modelReady ?? false,
            availability: payload?.availability ?? 'offline',
            roomCode,
          },
        })

        for (const [peerId, { ws: peerWs, roomCode: peerRoomCode }] of peers) {
          if (peerId !== selfId && peerRoomCode === roomCode && peerWs.readyState === WebSocket.OPEN) {
            peerWs.send(announcement)
          }
        }
        return
      }

      if (type === 'peer-list' && from) {
        const requestedRoomCode = payload?.roomCode ?? ''
        const list: Array<{ peerId: string; multiaddrs: string[]; models: string[]; modelReady: boolean; availability: string; roomCode: string }> = []

        for (const [peerId, data] of peers) {
          if (peerId !== from && data.roomCode === requestedRoomCode) {
            list.push({
              peerId,
              multiaddrs: data.multiaddrs,
              models: data.models,
              modelReady: data.modelReady,
              availability: data.availability,
              roomCode: data.roomCode,
            })
          }
        }

        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'peer-list', from: 'server', payload: list }))
        }
        return
      }

      if ((type === 'offer' || type === 'answer' || type === 'ice-candidate') && to) {
        const target = peers.get(to)
        if (target && target.ws.readyState === WebSocket.OPEN) {
          target.ws.send(JSON.stringify(msg))
        }
      }
    })

    ws.on('close', () => closePeer(selfId))
    ws.on('error', (err) => {
      console.error('[Signal] WebSocket error:', err.message)
    })
  })

  const upgradeHandler = (req: IncomingMessage, socket: Parameters<typeof wss.handleUpgrade>[1], head: Buffer) => {
    if (!shouldHandleUpgrade(req) || seenSockets.has(socket)) {
      return
    }

    seenSockets.add(socket)
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req)
    })
  }

  httpServer.on('upgrade', upgradeHandler)

  const cleanup = async () => {
    if (getShuttingDown()) return
    setShuttingDown(true)
    httpServer.off('upgrade', upgradeHandler)
    wss.close()
    peers.clear()
    await relayNode.stop()
  }

  httpServer.once('close', () => {
    void cleanup()
  })

  const lanHost = getPreferredLanHost()
  const vitePort = server.config.server.port ?? 5173
  console.log(`[Signal] Embedded signaling ready at wss://0.0.0.0:${vitePort}${SIGNAL_PATH}`)
  if (lanHost) {
    console.log(`[Signal] Shared app URL: https://${lanHost}:${vitePort}`)
  }
  console.log('[Relay] Embedded libp2p relay running on:')
  getPublicRelayMultiaddrs(relayNode).forEach((addr) => console.log(`        ${addr}`))
}
