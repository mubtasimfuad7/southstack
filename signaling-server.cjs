#!/usr/bin/env node

const http = require('http')
const os = require('os')
const { WebSocketServer, WebSocket } = require('ws')

const SIGNALING_PORT = parseInt(process.env.SIGNALING_PORT ?? process.argv[2] ?? '9001', 10)
const RELAY_PORT = parseInt(process.env.RELAY_PORT ?? process.argv[3] ?? '9091', 10)

const peers = new Map()

function getPreferredLanHost() {
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

function replaceRelayHost(ma, hostHeader) {
  const host = String(hostHeader ?? '').split(':')[0]
  const lanHost = getPreferredLanHost()
  const fallbackHost = lanHost || host

  if (!fallbackHost) {
    return ma
  }

  if (!host || host === '0.0.0.0') {
    return ma.replace(/\/ip4\/(0\.0\.0\.0|127\.0\.0\.1)\//, `/ip4/${fallbackHost}/`)
  }

  if (host === 'localhost' || host === '127.0.0.1') {
    return ma.replace(/\/ip4\/(0\.0\.0\.0|127\.0\.0\.1)\//, `/ip4/${fallbackHost}/`)
  }

  return ma.replace(/\/ip4\/(0\.0\.0\.0|127\.0\.0\.1)\//, `/ip4/${host}/`)
}

function getPublicRelayMultiaddrs(relayNode, hostHeader) {
  return relayNode.getMultiaddrs()
    .map((addr) => replaceRelayHost(addr.toString(), hostHeader))
    .filter((addr, index, all) => all.indexOf(addr) === index)
    .filter((addr) => !addr.includes('/ip4/127.0.0.1/'))
}

async function createRelayNode() {
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
      listen: [`/ip4/0.0.0.0/tcp/${RELAY_PORT}/ws`],
    },
    transports: [webSockets()],
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

async function main() {
  const relayNode = await createRelayNode()

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end(`Southstack signaling: ${peers.size} peer(s)\nRelay: ${relayNode.getMultiaddrs().join(', ')}\n`)
  })

  const wss = new WebSocketServer({ server })

  wss.on('connection', (ws, req) => {
    let selfId = null
    const relayMultiaddrs = getPublicRelayMultiaddrs(relayNode, req.headers.host)

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'relay-info',
        from: 'server',
        payload: { multiaddrs: relayMultiaddrs },
      }))
    }

    ws.on('message', (raw) => {
      let msg
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }

      const { type, from, to, payload } = msg

      if (type === 'announce' && from) {
        selfId = from
        const roomCode = payload?.roomCode ?? ''
        peers.set(selfId, { ws, multiaddrs: payload?.multiaddrs ?? [], roomCode })
        console.log(`[Signal] Peer announced: ${selfId} in room ${roomCode || '(none)'} (total: ${peers.size})`)

        const announcement = JSON.stringify({
          type: 'announce',
          from: selfId,
          payload: { multiaddrs: payload?.multiaddrs ?? [], roomCode },
        })

        for (const [pid, { ws: peerWs, roomCode: peerRoomCode }] of peers) {
          if (pid !== selfId && peerRoomCode === roomCode && peerWs.readyState === WebSocket.OPEN) {
            peerWs.send(announcement)
          }
        }
        return
      }

      if (type === 'peer-list' && from) {
        const requestedRoomCode = payload?.roomCode ?? ''
        const list = []

        for (const [pid, data] of peers) {
          if (pid !== from && data.roomCode === requestedRoomCode) {
            list.push({ peerId: pid, multiaddrs: data.multiaddrs, roomCode: data.roomCode })
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

    ws.on('close', () => {
      if (selfId) {
        peers.delete(selfId)
        console.log(`[Signal] Peer left: ${selfId} (remaining: ${peers.size})`)

        const leave = JSON.stringify({ type: 'announce-leave', from: selfId, payload: {} })
        for (const [, { ws: peerWs }] of peers) {
          if (peerWs.readyState === WebSocket.OPEN) {
            peerWs.send(leave)
          }
        }
      }
    })

    ws.on('error', (err) => {
      console.error('[Signal] WebSocket error:', err.message)
    })
  })

  server.listen(SIGNALING_PORT, '0.0.0.0', () => {
    const lanHost = getPreferredLanHost()
    console.log(`[Signal] Southstack signaling server running on ws://0.0.0.0:${SIGNALING_PORT}`)
    if (lanHost) {
      console.log(`[Signal] Preferred LAN URL: ws://${lanHost}:${SIGNALING_PORT}`)
    }
    console.log(`[Relay] Libp2p relay running on:`)
    getPublicRelayMultiaddrs(relayNode).forEach((addr) => console.log(`        ${addr}`))
    console.log('        Share your LAN IP so peers can use ws://<LAN-IP>:9001')
  })

  process.on('SIGINT', async () => {
    console.log('\n[Signal] Shutting down...')
    wss.close()
    server.close()
    await relayNode.stop()
    process.exit(0)
  })
}

main().catch((err) => {
  console.error('[Startup] Failed to start signaling/relay server:', err)
  process.exit(1)
})
