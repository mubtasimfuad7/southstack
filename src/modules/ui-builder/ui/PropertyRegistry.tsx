import React, { useState } from 'react';
import { DesignNode } from '../core/DesignNode';
import { useUIBuilderStore } from '../store';
import { Plus, Hash } from 'lucide-react';
import { DecoratorRegistry } from '../core/DecoratorRegistry';
import { peerNetworkManager } from '@/core/network/PeerNetworkManager';
import { EditorAPI } from '../core/EditorAPI';

export const PropertyInspector: React.FC<{ node: DesignNode }> = ({ node }) => {
  const { nodeLocks, hasEditAccess } = useUIBuilderStore();
  const triggerRender = useState(0)[1]; // Force refresh helper

  const holder = nodeLocks[node.id];
  const isLocked = holder && holder !== peerNetworkManager.getLocalPeerId();
  const isDisabled = isLocked || !hasEditAccess;

  return (
    <div className={`p-4 space-y-8 ${isDisabled ? 'opacity-50 pointer-events-none' : ''}`}>
      {/* Transformation */}
      <section className="space-y-4">
        <label className="text-[10px] uppercase font-black text-text-dim">Transformation</label>
        <div className="grid grid-cols-2 gap-4">
          <PropInput label="X" value={node.x} onChange={(v: any) => EditorAPI.updateNode(node.id, { x: v })} />
          <PropInput label="Y" value={node.y} onChange={(v: any) => EditorAPI.updateNode(node.id, { y: v })} />
          <PropInput label="W" value={node.width} onChange={(v: any) => EditorAPI.updateNode(node.id, { width: v })} />
          <PropInput label="H" value={node.height} onChange={(v: any) => EditorAPI.updateNode(node.id, { height: v })} />
        </div>
      </section>

      <div className="h-px bg-border/50" />

      {/* Logic-based Decorators */}
      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <label className="text-[10px] uppercase font-black text-text-dim">Style Decorators</label>
          <Plus size={14} className="text-text-dim cursor-pointer hover:text-text-primary" />
        </div>

        {node.decorators.map(decState => {
          const decorator = DecoratorRegistry.get(decState.type);
          if (!decorator) return null;

          return (
            <div key={decState.id} className="bg-surface-200/50 border border-border rounded-lg p-3">
              <div className="mb-2 text-[10px] font-bold uppercase text-text-secondary">{decState.type.replace('-', ' ')}</div>

              {/* The Decorator renders its own controls and handles its own events */}
              {decorator.renderUI(node, decState.config, (newConfig) => {
                // Trigger an EditorAPI update to refresh the document and broadcast
                EditorAPI.updateDecorator(node.id, decState.id, newConfig);
              })}
            </div>
          );
        })}

        {node.type === 'TEXT' && (
          <div className="space-y-3">
            <span className="text-[9px] uppercase font-bold text-text-dim">Content</span>
            <textarea
              className="bg-surface-200 border border-border w-full rounded-lg p-2 text-[11px] outline-none"
              value={node.content}
              onChange={(e) => EditorAPI.updateNode(node.id, { content: e.target.value })}
            />
          </div>
        )}
      </section>
    </div>
  );
};

const PropInput = ({ label, value, onChange }: any) => (
  <div className="flex flex-col gap-1">
    <span className="text-[8px] text-text-dim uppercase font-bold tracking-tight">{label}</span>
    <div className="relative flex items-center">
      <Hash size={10} className="absolute left-2 text-text-dim" />
      <input type="number" className="bg-surface-200 border border-border pl-6 pr-2 py-1.5 rounded-lg text-[11px] w-full outline-none focus:border-primary-500" value={value} onChange={(e) => onChange(parseInt(e.target.value) || 0)} />
    </div>
  </div>
);
