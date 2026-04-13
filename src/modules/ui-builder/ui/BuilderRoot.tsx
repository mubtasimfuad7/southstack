import React, { useEffect, useState } from 'react';
import { CanvasViewport } from './CanvasViewport';
import { useUIBuilderStore } from '../store';
import { EditorAPI } from '../core/EditorAPI';
import { PropertyInspector } from './PropertyRegistry';
import { CollaborationPanel } from './CollaborationPanel';
import {
  MousePointer2,
  Square,
  Type,
  Layers,
  Plus,
  Minus,
  ChevronRight,
  ChevronDown,
  Grid
} from 'lucide-react';

export const BuilderRoot: React.FC = () => {
  const { document, selectedNodeIds, viewport, setViewport } = useUIBuilderStore();
  const [activeTool, setActiveTool] = useState('select');

  useEffect(() => {
    EditorAPI.init();
  }, []);

  const selectedNode = selectedNodeIds.length === 1
    ? findNodeById(document.pages[0].nodes, selectedNodeIds[0])
    : null;

  function findNodeById(nodes: any[], id: string): any | null {
    for (const node of nodes) {
      if (node.id === id) return node;
      if (node.children) {
        const found = findNodeById(node.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface-400 overflow-hidden select-none text-text-primary font-sans">
      {/* Header */}
      <div className="h-12 bg-surface-100 border-b border-border flex items-center justify-between px-2 shrink-0">
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-2 px-3 mr-4 border-r border-border/50">
            <div className="w-6 h-6 bg-primary-600 rounded-md flex items-center justify-center text-white font-black text-xs">S</div>
            <span className="text-[11px] font-bold uppercase tracking-wider">UI Builder</span>
          </div>
          <div className="flex items-center gap-0.5 bg-surface-200/50 p-1 rounded-lg border border-border/30">
            <ToolButton active={activeTool === 'select'} onClick={() => setActiveTool('select')} icon={<MousePointer2 size={14} />} />
            <ToolButton active={activeTool === 'frame'} onClick={() => setActiveTool('frame')} icon={<Grid size={14} />} />
            <ToolButton active={activeTool === 'rect'} onClick={() => setActiveTool('rect')} icon={<Square size={14} />} />
            <ToolButton active={activeTool === 'text'} onClick={() => setActiveTool('text')} icon={<Type size={14} />} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-surface-200 rounded-md border border-border px-2 py-1 gap-2">
            <button onClick={() => setViewport({ zoom: viewport.zoom * 0.8 })}><Minus size={12} /></button>
            <span className="text-[10px] font-mono min-w-[40px] text-center">{Math.round(viewport.zoom * 100)}%</span>
            <button onClick={() => setViewport({ zoom: viewport.zoom * 1.2 })}><Plus size={12} /></button>
          </div>
          <button className="px-4 py-1.5 bg-primary-600 hover:bg-primary-500 text-white rounded-md text-[11px] font-bold">Generate with AI</button>
        </div>
      </div>

      <CollaborationPanel />

      <div className="flex-1 flex overflow-hidden">
        {/* Layers */}
        <div className="w-60 border-r border-border bg-surface-100 shrink-0 flex flex-col">
          <div className="h-9 px-3 border-b border-border flex items-center bg-surface-200/30">
            <span className="text-[10px] font-bold uppercase tracking-widest text-text-dim flex items-center gap-2"><Layers size={12} /> Layers</span>
          </div>
          <div className="flex-1 overflow-y-auto p-1">
            {document.pages[0].nodes.map(node => (
              <LayerItem key={node.id} node={node} selected={selectedNodeIds.includes(node.id)} onSelect={(id) => EditorAPI.select([id])} />
            ))}
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 relative bg-surface-300">
          <CanvasViewport />
        </div>

        {/* Properties */}
        <div className="w-64 border-l border-border bg-surface-100 shrink-0 flex flex-col">
          <div className="h-9 px-3 border-b border-border flex items-center bg-surface-200/30">
            <span className="text-[10px] font-bold uppercase tracking-widest text-text-dim">Design</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {selectedNode ? <PropertyInspector node={selectedNode} /> : (
              <div className="flex flex-col items-center justify-center h-64 opacity-20"><Grid size={48} className="mb-4" /><span className="text-[11px] font-bold uppercase">Select an element</span></div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const ToolButton = ({ active, onClick, icon }: any) => (
  <button onClick={onClick} className={`w-8 h-8 flex items-center justify-center rounded-md ${active ? 'bg-primary-600 text-white' : 'text-text-dim hover:bg-surface-300'}`}>{icon}</button>
);

const LayerItem = ({ node, selected, depth = 0, onSelect }: any) => {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children && node.children.length > 0;
  return (
    <div className="space-y-0.5">
      <div
        className={`flex items-center h-7 px-2 rounded-md cursor-pointer ${selected ? 'bg-primary-600/10 text-primary-300' : 'hover:bg-surface-200 text-text-dim'}`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => onSelect(node.id)}
      >
        <div className="w-4 flex items-center mr-1">
          {hasChildren && <button onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>{expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}</button>}
        </div>
        <span className="text-[11px] font-medium truncate">{node.name}</span>
      </div>
      {hasChildren && expanded && node.children.map((child: any) => (<LayerItem key={child.id} node={child} selected={selected} depth={depth + 1} onSelect={onSelect} />))}
    </div>
  );
};
