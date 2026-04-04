// ============================================================
// UI LAYER: P2PPanel
// Modern, premium P2P control panel with glassmorphism,
// vibrant accents, and real-time network feedback.
// ============================================================

import React, { useState, useEffect, useRef } from 'react'
import { 
  X, 
  Network, 
  Users, 
  Activity, 
  Globe, 
  Plus, 
  Copy, 
  Check, 
  Wifi, 
  WifiOff, 
  Terminal as TerminalIcon
} from 'lucide-react'
import { useP2PStore } from '@/application/p2pStore'
import { p2pSession } from '@/infrastructure/p2p/P2PSession'
import { useNotificationStore } from '@/application/notificationStore'

interface P2PPanelProps {
  onClose: () => void
}

export const P2PPanel: React.FC<P2PPanelProps> = ({ onClose }) => {
  const { 
    role, 
    status, 
    selfPeerId, 
    signalingUrl,
    roomCode, 
    peers, 
    log, 
    error,
    setRole,
    setActiveProvider,
    setSignalingUrl,
    setRoomCode,
    reset,
    clearLog
  } = useP2PStore()

  const [joinCode, setJoinCode] = useState('')
  const [signalInput, setSignalInput] = useState(() => signalingUrl || p2pSession.getDefaultSignalingUrl())
  const [copied, setCopied] = useState(false)
  const logEndRef = useRef<HTMLDivElement>(null)
  const addNotification = useNotificationStore((s) => s.addNotification)
  const usingSameOriginJoinUrl = signalInput.includes('/__signal')
  const visiblePeers = peers.filter((peer) => peer.peerId !== selfPeerId)

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [log])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlRoomCode = params.get('roomCode')?.trim().toUpperCase() ?? ''
    const urlSignal = params.get('signal')?.trim() || params.get('signalingUrl')?.trim() || ''

    if (urlSignal) {
      setSignalInput(urlSignal)
      setSignalingUrl(urlSignal)
    }

    if (!urlRoomCode) return

    setJoinCode(urlRoomCode)

    if (role === 'none') {
      setRole('joiner')
    }
  }, [role, setRole, setSignalingUrl])

  const handleCopyCode = () => {
    if (!roomCode) return
    navigator.clipboard.writeText(roomCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleHost = async () => {
    const code = roomCode || Math.random().toString(36).slice(2, 8).toUpperCase()
    setRoomCode(code)
    setSignalingUrl(signalInput)
    setRole('host')
    try {
      await p2pSession.start({
        role: 'host',
        roomCode: code,
        signalingUrl: signalInput,
      })
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : 'Failed to host room')
    }
  }

  const handleJoin = async () => {
    const code = joinCode.trim().toUpperCase()
    if (!code) return

    setSignalingUrl(signalInput)
    setRoomCode(code)
    setRole('joiner')
    try {
      await p2pSession.start({
        role: 'joiner',
        roomCode: code,
        signalingUrl: signalInput,
      })
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : 'Failed to join room')
    }
  }

  const handleDisconnect = async () => {
    await p2pSession.disconnect()
    reset()
  }

  const getStatusIcon = () => {
    switch (status) {
      case 'connected': return <Wifi size={16} className="text-success" />
      case 'error': return <WifiOff size={16} className="text-error" />
      default: return <Activity size={16} className="animate-pulse text-warning" />
    }
  }

  return (
    <div className="flex flex-col h-full bg-surface-300 text-text-primary overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border/50 bg-surface-400">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center text-green-400">
            <Network size={18} />
          </div>
          <div>
            <h2 className="text-sm font-bold tracking-tight">P2P NETWORK</h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`w-1.5 h-1.5 rounded-full ${status === 'connected' ? 'bg-success animate-pulse' : 'bg-text-dim'}`}></span>
              <span className="text-[10px] uppercase font-bold tracking-wider text-text-dim">
                {status} {role !== 'none' && `— ${role}`}
              </span>
            </div>
          </div>
        </div>
        <button 
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-white/5 text-text-dim hover:text-text-primary transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar">
        {/* Main Actions (Host/Join) */}
        {role === 'none' ? (
          <div className="space-y-4">
            <div className="p-4 rounded-xl border border-border/50 bg-surface-200">
              <label className="block text-[11px] font-bold text-text-dim uppercase tracking-wider mb-2">
                {usingSameOriginJoinUrl ? 'Shared App URL' : 'Signaling Server URL'}
              </label>
              <input
                type="text"
                value={signalInput}
                onChange={(e) => setSignalInput(e.target.value)}
                placeholder="https://192.168.1.10:5173"
                className="w-full bg-surface-400 border border-border focus:border-blue-500 outline-none rounded-lg px-3 py-2 text-sm transition-all"
              />
              <p className="mt-2 text-[10px] text-text-dim">
                {usingSameOriginJoinUrl
                  ? 'Share the same app URL and room code. Peers on this URL are matched through the same-origin signaling proxy.'
                  : 'Used only for LAN peer discovery. Existing peers continue over libp2p after it shuts down.'}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
            <button
              onClick={handleHost}
              className="group relative flex flex-col items-center justify-center p-6 rounded-xl border border-border/50 bg-surface-200 hover:bg-surface-100 hover:border-green-500/30 transition-all active:scale-[0.98]"
            >
              <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center text-green-400 mb-3 group-hover:scale-110 transition-transform">
                <Globe size={24} />
              </div>
              <span className="text-sm font-bold">Host Room</span>
              <span className="text-[10px] text-text-dim mt-1 text-center">Start a new decentralized session</span>
            </button>

            <button
              onClick={() => setRole('joiner')}
              className="group relative flex flex-col items-center justify-center p-6 rounded-xl border border-border/50 bg-surface-200 hover:bg-surface-100 hover:border-blue-500/30 transition-all active:scale-[0.98]"
            >
              <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-400 mb-3 group-hover:scale-110 transition-transform">
                <Plus size={24} />
              </div>
              <span className="text-sm font-bold">Join Room</span>
              <span className="text-[10px] text-text-dim mt-1 text-center">Connect to an existing peer</span>
            </button>
            </div>
          </div>
        ) : role === 'joiner' && status === 'disconnected' ? (
          <div className="p-4 rounded-xl border border-border/50 bg-surface-200">
            <label className="block text-[11px] font-bold text-text-dim uppercase tracking-wider mb-2">
              {usingSameOriginJoinUrl ? 'Shared App URL' : 'Signaling Server URL'}
            </label>
            <input
              type="text"
              value={signalInput}
              onChange={(e) => setSignalInput(e.target.value)}
              placeholder="https://192.168.1.10:5173"
              className="w-full bg-surface-400 border border-border focus:border-blue-500 outline-none rounded-lg px-3 py-2 text-sm transition-all mb-4"
            />
            <label className="block text-[11px] font-bold text-text-dim uppercase tracking-wider mb-2">Room Code</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="Enter room code..."
                className="flex-1 bg-surface-400 border border-border focus:border-blue-500 outline-none rounded-lg px-3 py-2 text-sm transition-all"
              />
              <button
                onClick={handleJoin}
                className="px-4 bg-blue-600 hover:bg-blue-50 text-white text-sm font-bold rounded-lg transition-all shadow-lg shadow-blue-500/20 active:scale-95"
              >
                Join
              </button>
            </div>
            <button 
              onClick={reset}
              className="mt-3 text-[10px] text-text-dim hover:text-text-primary transition-colors"
            >
              Go Back
            </button>
          </div>
        ) : (
          /* Active Connection Info */
          <div className="space-y-4">
            {error && (
              <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-[11px] text-red-300">
                {error}
              </div>
            )}
            <div className="p-4 rounded-xl border border-border/50 bg-surface-200 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-3 flex gap-2">
                {getStatusIcon()}
              </div>
              
              <div className="space-y-3">
                <div>
                  <label className="block text-[10px] font-bold text-text-dim uppercase tracking-wider">Your Peer ID</label>
                  <p className="text-[11px] font-mono text-text-secondary mt-1 break-all bg-black/20 p-2 rounded border border-white/5">
                    {selfPeerId || 'Initializing...'}
                  </p>
                </div>

                {roomCode && (
                  <div>
                    <label className="block text-[10px] font-bold text-text-dim uppercase tracking-wider">Room Access Code</label>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-lg font-bold tracking-widest text-green-400">{roomCode}</span>
                      <button 
                        onClick={handleCopyCode}
                        className="p-1.5 rounded-md hover:bg-white/5 text-text-dim hover:text-success transition-all"
                      >
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-4 pt-4 border-t border-border/50 grid grid-cols-2 gap-4">
                <div className="flex items-center gap-2">
                  <Users size={14} className="text-text-dim" />
                  <span className="text-xs font-bold">{visiblePeers.length} Peers</span>
                </div>
                <div className="flex items-center gap-2">
                  <Activity size={14} className="text-text-dim" />
                  <span className="text-xs font-bold">{status === 'connected' ? 'Stable' : 'Offline'}</span>
                </div>
              </div>
            </div>

            {/* Peers List */}
            <div className="space-y-2">
              <h3 className="text-[10px] font-bold text-text-dim uppercase tracking-wider px-1">Active Providers</h3>
              {visiblePeers.length === 0 ? (
                <div className="py-8 flex flex-col items-center justify-center rounded-xl border border-dashed border-border/50 opacity-40">
                  <Users size={24} className="mb-2" />
                  <span className="text-xs">Waiting for connections...</span>
                </div>
              ) : (
                <div className="space-y-2">
                  {visiblePeers.map(peer => (
                    <button
                      key={peer.peerId}
                      type="button"
                      onClick={() => setActiveProvider(peer.transportReady && peer.models.length > 0 && peer.availability === 'available' ? peer.peerId : null)}
                      className="w-full flex items-center justify-between p-3 rounded-lg border border-border/30 bg-surface-200/50 text-left"
                    >
                      <div className="flex items-center gap-2.5 overflow-hidden">
                        <div className="w-2 h-2 rounded-full bg-success shadow-[0_0_8px_rgba(34,197,94,0.4)]"></div>
                        <div className="truncate">
                          <p className="text-xs font-bold truncate max-w-[200px]">{peer.peerId}</p>
                          <p className="text-[9px] text-text-dim uppercase font-bold">
                            {peer.transportReady
                              ? (peer.models.length > 0 ? peer.availability : 'syncing model info')
                              : 'transport not ready'} • {peer.models.join(', ') || 'Model hidden'}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <div className="flex flex-col items-end">
                           <span className="text-[10px] font-bold text-success">{peer.latencyMs}ms</span>
                           <span className="text-[9px] text-text-dim">Latency</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Network Logs */}
        <div className="flex flex-col h-48 rounded-xl border border-border/50 bg-surface-400 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-surface-500 border-b border-border/50">
            <div className="flex items-center gap-2">
              <TerminalIcon size={12} className="text-text-dim" />
              <span className="text-[10px] font-bold text-text-dim uppercase tracking-wider">Network Log</span>
            </div>
            <button 
              onClick={clearLog}
              className="text-[9px] font-bold text-text-dim hover:text-text-primary px-1.5 py-0.5 rounded hover:bg-white/5"
            >
              Clear
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 font-mono text-[10px] space-y-1 custom-scrollbar">
            {log.length === 0 ? (
              <span className="text-text-dim italic">System idle...</span>
            ) : (
              log.map(entry => (
                <div key={entry.id} className="flex gap-2">
                  <span className="text-text-dim select-none opacity-50">[{new Date(entry.ts).toLocaleTimeString()}]</span>
                  <span className={
                    entry.level === 'error' ? 'text-error' :
                    entry.level === 'success' ? 'text-success' :
                    entry.level === 'warn' ? 'text-warning' : 'text-text-secondary'
                  }>
                    {entry.message}
                  </span>
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      </div>

      {/* Footer / Status Bar */}
      <div className="px-5 py-3 border-t border-border/50 bg-surface-400 flex items-center justify-between">
        <button 
          onClick={handleDisconnect}
          className="px-3 py-1.5 rounded-lg border border-border bg-button-secondary hover:bg-button-secondary-hover text-xs font-bold transition-all"
        >
          Disconnect
        </button>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-primary-400 shadow-[0_0_8px_rgba(59,130,246,0.4)]"></div>
            <span className="text-[10px] font-bold text-text-dim uppercase">RTC</span>
          </div>
          <div className="flex items-center gap-1.5 opacity-50">
            <div className="w-1.5 h-1.5 rounded-full bg-border"></div>
            <span className="text-[10px] font-bold text-text-dim uppercase">DHT</span>
          </div>
        </div>
      </div>
    </div>
  )
}
