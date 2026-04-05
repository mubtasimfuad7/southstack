// ============================================================
// UI LAYER: P2PPanel — Network visualization + Task tracking
// ============================================================

import { usePeerStore, useP2PTaskStore, useToolLogStore } from '@/application/store'
import {
    Network, Activity, Zap, CheckCircle2, XCircle, Clock, Search, Wrench, Lock, X
} from 'lucide-react'
import type { PeerStatus, Subtask, ToolLogEntry } from '@/core/tasks/taskTypes'
import { peerNetworkManager } from '@/core/network/PeerNetworkManager'

export function P2PPanel() {
    return (
        <div className="flex flex-col h-full bg-panel border-r border-border min-w-[280px]">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-surface-100 flex-shrink-0">
                <Network size={14} className="text-secondary-400" />
                <span className="text-xs font-semibold uppercase tracking-widest text-text-primary">P2P Network</span>
            </div>

            <div className="flex-1 overflow-y-auto">
                <LocalPeerInfo />
                <PeerList />
                <TaskTracking />
                <ToolActivityLog />
            </div>
        </div>
    )
}

function LocalPeerInfo() {
    const { localPeerId, localState, acceptsRemoteTasks, setAcceptsRemoteTasks, networkConnected } = usePeerStore()

    const stateColors: Record<string, string> = {
        model_loading: 'text-warning bg-warning/10',
        idle: 'text-success bg-success/10',
        busy_self: 'text-primary-400 bg-primary-400/10',
        busy_remote: 'text-accent-400 bg-accent-400/10',
    }

    return (
        <div className="p-3 border-b border-border">
            <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] uppercase font-bold text-text-dim">This Peer</div>
                <div className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${networkConnected ? 'bg-success/20 text-success' : 'bg-error/20 text-error'}`}>
                    {networkConnected ? 'CONNECTED' : 'OFFLINE'}
                </div>
            </div>
            <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-text-primary">{localPeerId || '...'}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-bold ${stateColors[localState] || 'text-text-dim bg-surface-300'}`}>
                    {localState.replace('_', ' ')}
                </span>
            </div>

            <label className="flex items-center gap-2 mt-3 cursor-pointer">
                <input
                    type="checkbox"
                    checked={acceptsRemoteTasks}
                    onChange={(e) => setAcceptsRemoteTasks(e.target.checked)}
                    className="accent-primary-500 rounded cursor-pointer"
                />
                <span className="text-[10px] font-medium text-text-secondary">Accept Remote Subtasks</span>
            </label>
        </div>
    )
}

function PeerList() {
    const { peers } = usePeerStore()

    return (
        <div className="p-3 border-b border-border">
            <div className="text-[10px] uppercase font-bold text-text-dim mb-2 flex items-center justify-between">
                <span>Connected Mesh</span>
                <span className="bg-surface-300 px-1.5 py-0.5 rounded text-text-secondary">{peers.size}</span>
            </div>

            {peers.size === 0 ? (
                <div className="text-[10px] text-text-dim py-2 text-center border border-dashed border-border rounded">
                    No peers discovered yet.
                </div>
            ) : (
                <div className="space-y-1">
                    {Array.from(peers.values()).map(peer => (
                        <PeerRow key={peer.peerId} peer={peer} />
                    ))}
                </div>
            )}
        </div>
    )
}

function PeerRow({ peer }: { peer: PeerStatus }) {
    const age = Date.now() - peer.lastHeartbeat
    const isStale = age > 8000

    return (
        <div className="flex items-center justify-between p-1.5 rounded bg-surface-200 border border-border">
            <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${isStale ? 'bg-error' : peer.state === 'idle' ? 'bg-success' : 'bg-accent-400'}`} />
                <span className="text-xs font-mono text-text-secondary">{peer.peerId.split('-')[1]}</span>
            </div>
            <div className="flex items-center gap-2">
                <span className="text-[9px] text-text-dim">Rel: {(peer.reliabilityScore * 100).toFixed(0)}%</span>
                <span className="text-[9px] uppercase bg-surface-300 px-1 rounded text-text-dim">{peer.state.replace('_', ' ')}</span>
            </div>
        </div>
    )
}

function TaskTracking() {
    const { rootTask, subtasks, remoteSubtask } = useP2PTaskStore()

    if (!rootTask && !remoteSubtask) return null

    return (
        <div className="p-3 border-b border-border">
            <div className="text-[10px] uppercase font-bold text-text-dim mb-2">Active Tasks</div>

            {/* Task we are coordinating */}
            {rootTask && (
                <div className="mb-3">
                    <div className="text-xs font-medium text-primary-300 mb-1 flex items-center gap-1.5">
                        <Activity size={12} /> Coordinator Plan
                    </div>
                    <div className="space-y-1 pl-1 border-l-2 border-primary-500/30">
                        {Array.from(subtasks.values()).map(s => (
                            <SubtaskRow key={s.id} subtask={s} />
                        ))}
                    </div>
                </div>
            )}

            {/* Task we are executing for someone else */}
            {remoteSubtask && (
                <div>
                    <div className="text-xs font-medium text-accent-400 mb-1 flex items-center gap-1.5">
                        <Zap size={12} /> Remote Work (Worker)
                    </div>
                    <SubtaskRow subtask={remoteSubtask} />
                </div>
            )}
        </div>
    )
}

function SubtaskRow({ subtask }: { subtask: Subtask }) {
    const stateIcons: Record<string, React.ReactNode> = {
        queued: <Clock size={10} className="text-text-dim" />,
        in_progress: <Zap size={10} className="text-warning animate-pulse" />,
        completed: <CheckCircle2 size={10} className="text-success" />,
        failed: <XCircle size={10} className="text-error" />,
        requeued: <Search size={10} className="text-primary-400" />
    }

    return (
        <div className="text-xs bg-surface-200 p-1.5 rounded border border-border">
            <div className="flex items-start gap-1.5">
                <div className="mt-0.5">{stateIcons[subtask.status] || <Clock size={10} />}</div>
                <div className="flex-1 min-w-0">
                    <div className="text-text-primary whitespace-pre-wrap">{subtask.title}</div>
                    {subtask.assignedPeerId && (
                        <div className="text-[9px] text-text-dim font-mono mt-0.5">
                            @ {subtask.assignedPeerId.split('-')[1]}
                            {subtask.progress !== undefined ? ` • ${subtask.progress}%` : ''}
                            {subtask.statusText ? ` • ${subtask.statusText}` : ''}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

function ToolActivityLog() {
    const { entries } = useToolLogStore()

    return (
        <div className="p-3">
            <div className="text-[10px] uppercase font-bold text-text-dim mb-2">Remote Tool Bridge Log</div>
            {entries.length === 0 ? (
                <div className="text-[10px] text-text-dim text-center py-2">No remote accesses yet.</div>
            ) : (
                <div className="space-y-1 max-h-40 overflow-y-auto pr-1 custom-scrollbar">
                    {entries.map(e => (
                        <div key={e.id} className="text-[10px] flex items-start gap-1.5 bg-surface-200 p-1.5 rounded">
                            <div className="mt-0.5"><Wrench size={10} className="text-accent-300" /></div>
                            <div className="flex-1 min-w-0 overflow-hidden">
                                <div className="font-mono text-primary-300 truncate">
                                    {e.workerPeerId.split('-')[1] || 'local'}: {e.tool}
                                </div>
                                {e.error ? (
                                    <div className="text-error text-[9px] truncate">{e.error}</div>
                                ) : (
                                    <div className="text-text-dim text-[9px] truncate">
                                        {e.durationMs}ms • {JSON.stringify(e.args).slice(0, 30)}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
