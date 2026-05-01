import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import './index.css'

// Import xterm CSS
import '@xterm/xterm/css/xterm.css'

// P2P Boot Sequence
import { peerNetworkManager } from '@/core/network/PeerNetworkManager'
import { peerStateStore } from '@/core/peers/PeerStateStore'
import { remoteToolBridge } from '@/core/tools/RemoteToolBridge'
import { workerOfferHandler } from '@/core/worker/WorkerOfferHandler'
import { localModelProvider } from '@/execution/llm/LocalModelProvider'
import { usePeerStore } from '@/application/store'

  ; (async () => {
    // Generate a random peer ID for this session
    const localPeerId = `peer-${Math.random().toString(36).slice(2, 8)}`
    const savedPeerName = localStorage.getItem('southstack.peerName')?.trim()
    const localPeerName = savedPeerName || localPeerId

    // Expose store state getters for network layer
    const getState = () => peerStateStore.getLocalState()
    const getAccepts = () => peerStateStore.getAcceptsRemoteTasks()
    const getCaps = () => peerStateStore.getCapabilities()
    const getName = () => peerStateStore.getLocalDisplayName() || localPeerId

    // Initialize background services
    peerStateStore.setLocalDisplayName(localPeerName)
    await peerNetworkManager.init(localPeerId, getState, getAccepts, getCaps, getName)
    remoteToolBridge.startHosting(localPeerId)
    workerOfferHandler.init(() => localModelProvider)

    // Sync peer state to React Zustand store for UI
    usePeerStore.getState().setLocalPeerId(localPeerId)
    usePeerStore.getState().setLocalPeerName(localPeerName)

    peerNetworkManager.onNetworkStateChange((connected) => {
      usePeerStore.getState().setNetworkConnected(connected)
    })

    peerStateStore.onLocalStateChange((s) => {
      usePeerStore.getState().setLocalState(s)
    })

    peerStateStore.onLocalDisplayNameChange((name) => {
      usePeerStore.getState().setLocalPeerName(name)
    })

    peerStateStore.onRegistryChange((peers) => {
      usePeerStore.getState().setPeers(peers)
    })

    // Start React
    const rootEl = document.getElementById('root')!
    createRoot(rootEl).render(
      <StrictMode>
        <App />
      </StrictMode>
    )
  })()
