import React, { useEffect, useState } from 'react';
import { Users, Shield, Check, X, LogOut } from 'lucide-react';
import { useUIBuilderStore } from '../store';
import { EditorAPI } from '../core/EditorAPI';
import { peerNetworkManager } from '@/core/network/PeerNetworkManager';

export const CollaborationPanel: React.FC = () => {
    const { hostPeerId, hasEditAccess, pendingEditRequests } = useUIBuilderStore();
    const [peers, setPeers] = useState<string[]>([]);
    const [selectedPeer, setSelectedPeer] = useState<string>('');

    useEffect(() => {
        const updatePeers = () => setPeers(peerNetworkManager.getConnectedPeers());
        updatePeers();
        const interval = setInterval(updatePeers, 3000);
        return () => clearInterval(interval);
    }, []);

    const localId = peerNetworkManager.getLocalPeerId();
    const isRemoteSession = hostPeerId !== null && hostPeerId !== localId;

    return (
        <div className="bg-surface-100 border-b border-border p-3 flex items-center justify-between">
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-text-primary">
                    <Users size={16} />
                    <span className="text-xs font-bold uppercase tracking-wider">
                        {!isRemoteSession ? 'Local UI (Host)' : hasEditAccess ? "Editing Peer's UI (Trusted)" : "Viewing Peer's UI (Read Only)"}
                    </span>
                </div>

                {isRemoteSession ? (
                    <div className="flex items-center gap-3">
                        {!hasEditAccess && (
                            <button
                                onClick={() => EditorAPI.requestEditAccess()}
                                className="px-3 py-1.5 bg-primary-500/10 text-primary-500 hover:bg-primary-500/20 text-xs rounded-lg transition-colors font-bold"
                            >
                                Request Edit Access
                            </button>
                        )}
                        <button
                            onClick={() => EditorAPI.leaveSession()}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs rounded-lg transition-colors font-bold"
                        >
                            <LogOut size={12} />
                            Leave Session
                        </button>
                    </div>
                ) : (
                    <div className="flex items-center gap-2">
                        <select
                            value={selectedPeer}
                            onChange={(e) => setSelectedPeer(e.target.value)}
                            className="bg-surface-200 border border-border rounded text-xs px-2 py-1 outline-none text-text-secondary"
                        >
                            <option value="">Select a peer's session to view...</option>
                            {peers.map(p => (
                                <option key={p} value={p}>{p}</option>
                            ))}
                        </select>

                        <button
                            onClick={() => {
                                if (selectedPeer && selectedPeer !== localId) {
                                    EditorAPI.joinSession(selectedPeer);
                                }
                            }}
                            disabled={!selectedPeer || selectedPeer === localId}
                            className="px-3 py-1 bg-primary-500/10 text-primary-500 hover:bg-primary-500/20 text-xs rounded font-bold disabled:opacity-50 transition-colors"
                        >
                            Join Session
                        </button>
                    </div>
                )}
            </div>

            {/* Incoming Requests Panel (Only visible if you are the host) */}
            {!isRemoteSession && pendingEditRequests.length > 0 && (
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 text-warning-400 text-xs font-bold animate-pulse">
                        <Shield size={14} />
                        {pendingEditRequests.length} edit request(s)
                    </div>

                    <div className="flex bg-surface-200 rounded-lg p-1 border border-border">
                        {pendingEditRequests.map(reqId => (
                            <div key={reqId} className="flex items-center gap-2 px-2 text-[10px] uppercase font-bold text-text-secondary">
                                {reqId.substring(0, 8)}...
                                <div className="flex gap-1">
                                    <button onClick={() => EditorAPI.respondToEditRequest(reqId, true)} className="text-success-400 hover:bg-surface-400 p-1 rounded">
                                        <Check size={12} />
                                    </button>
                                    <button onClick={() => EditorAPI.respondToEditRequest(reqId, false)} className="text-error-400 hover:bg-surface-400 p-1 rounded">
                                        <X size={12} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
