import React from 'react';
import { DesignNode } from '../core/DesignNode';
import { useUIBuilderStore } from '../store';
import { Hash, Settings2, Trash2 } from 'lucide-react';
import { DecoratorRegistry } from '../core/DecoratorRegistry';
import { peerNetworkManager } from '@/core/network/PeerNetworkManager';
import { EditorAPI } from '../core/EditorAPI';
import { NodeType } from '../core/NodeTypes';

export const PropertyInspector: React.FC<{ node?: DesignNode }> = ({ node: propNode }) => {
  const { nodeLocks, hasEditAccess, selectedNodeIds, findNode } = useUIBuilderStore();
  const node = propNode || (selectedNodeIds.length === 1 ? findNode(selectedNodeIds[0]) : null);

  if (!node) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-500 px-6 text-center">
        <Settings2 size={32} className="opacity-10 mb-4" />
        <p className="text-[11px] font-medium">Select a single layer to edit properties.</p>
      </div>
    );
  }

  const holder = nodeLocks[node.id];
  const isLocked = holder && holder !== peerNetworkManager.getLocalPeerId();
  const isDisabled = isLocked || !hasEditAccess;

  return (
    <div className={`flex flex-col h-full bg-[#15161f] ${isDisabled ? 'opacity-50 pointer-events-none' : ''}`}>
      {/* ─── NODE HEADER ─── */}
      <div className="px-4 py-3 border-b border-white/[0.05] flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase font-black tracking-widest text-[#6366f1] mb-0.5">{node.type}</span>
          <input
            className="bg-transparent text-xs font-semibold text-slate-200 outline-none focus:text-white"
            value={node.name}
            onChange={(e) => EditorAPI.updateNode(node.id, { name: e.target.value })}
          />
        </div>
        <button
          onClick={() => EditorAPI.deleteNode(node.id)}
          className="p-1.5 hover:bg-red-500/10 text-slate-500 hover:text-red-400 rounded transition-colors"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="grow overflow-y-auto custom-scrollbar p-4 space-y-6">
        {/* ─── DECORATORS ─── */}
        {node.decorators.map(decState => {
          const decorator = DecoratorRegistry.get(decState.type);
          if (!decorator) return null;

          return (
            <section key={decState.id} className="space-y-3">
              <div className="flex items-center justify-between group">
                <label className="text-[10px] uppercase font-black tracking-widest text-slate-500">{decState.type.replace('-', ' ')}</label>
                <input
                  type="checkbox" checked={decState.enabled}
                  onChange={(e) => EditorAPI.updateDecorator(node.id, decState.id, { enabled: e.target.checked })}
                  className="w-3 h-3 accent-violet-500"
                />
              </div>

              {decState.enabled && (
                <div className="pl-1 border-l border-white/[0.03]">
                  {decorator.renderUI(node, decState.config, (newConfig) => {
                    EditorAPI.updateDecorator(node.id, decState.id, newConfig);
                  })}
                </div>
              )}
              <div className="h-px bg-white/[0.05] mt-4" />
            </section>
          );
        })}

        {/* ─── TEXT SPECIFIC ─── */}
        {node.type === NodeType.TEXT && (
          <section className="space-y-3">
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-500">Text Content</label>
            <textarea
              className="w-full bg-black/20 border border-white/[0.07] rounded-lg p-2.5 text-xs text-slate-300 outline-none focus:border-violet-500/50 min-h-[80px] resize-none"
              value={node.content || ''}
              onChange={(e) => EditorAPI.updateNode(node.id, { content: e.target.value })}
              placeholder="Type something..."
            />
          </section>
        )}
      </div>
    </div>
  );
};
