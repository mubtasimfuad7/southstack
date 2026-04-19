import React, { useEffect, useState } from 'react';
import { CanvasViewport } from './CanvasViewport';
import { useUIBuilderStore } from '../store';
import { EditorAPI } from '../core/EditorAPI';
import { PropertyInspector } from './PropertyRegistry';
import { CollaborationPanel } from './CollaborationPanel';
import { AICopilotPanel } from './AICopilotPanel';
import { NodeFactory } from '../core/NodeFactory';
import { NodeType } from '../core/NodeTypes';
import {
  MousePointer2, Hand, Square, Type, Pen, MessageCircle,
  Plus, Minus, ChevronRight, ChevronDown, Layers2,
  LayoutGrid, Image, Code2, Component, PenTool,
  FilePlus, Trash2, ArrowUp, ArrowDown, Unlink, Video,
  Play
} from 'lucide-react';

// ─── Node type icons ──────────────────────────────────────────────────────────
const NODE_ICONS: Record<string, React.ReactNode> = {
  [NodeType.FRAME]: <LayoutGrid size={12} className="text-violet-400 shrink-0" />,
  [NodeType.GROUP]: <Layers2 size={12} className="text-sky-400 shrink-0" />,
  [NodeType.RECTANGLE]: <Square size={12} className="text-slate-400 shrink-0" />,
  [NodeType.TEXT]: <Type size={12} className="text-yellow-400 shrink-0" />,
  [NodeType.VECTOR]: <PenTool size={12} className="text-emerald-400 shrink-0" />,
  [NodeType.IMAGE]: <Image size={12} className="text-blue-400 shrink-0" />,
  [NodeType.VIDEO]: <Play size={12} className="text-red-400 shrink-0" />,
};

// ─── Types ────────────────────────────────────────────────────────────────────
interface CtxMenu { nodeId: string; nodeType: string; x: number; y: number; }
interface DragInfo { nodeId: string; overNodeId: string | null; pos: 'above' | 'below' | 'into' | null; }

// ─── Root ─────────────────────────────────────────────────────────────────────
export const BuilderRoot: React.FC<{ onClose?: () => void }> = ({ onClose }) => {
  const {
    document, selectedNodeIds,
    activeLayoutId, activePageId, setActiveNavigation,
    findNode, addPage, activeTool, setActiveTool, groupNodes, ungroupNode, reorderNode
  } = useUIBuilderStore();

  useEffect(() => { EditorAPI.init(); }, []);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;
      if (isMod && !e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        const latestIds = useUIBuilderStore.getState().selectedNodeIds;
        if (latestIds.length >= 2) useUIBuilderStore.getState().groupNodes(latestIds);
      }
      if (isMod && e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        const state = useUIBuilderStore.getState();
        if (state.selectedNodeIds.length === 1) state.ungroupNode(state.selectedNodeIds[0]);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        selectedNodeIds.forEach(id => useUIBuilderStore.getState().deleteNode(id));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNodeIds]);

  const currentLayout = document.layouts.find(l => l.id === activeLayoutId) || document.layouts[0];
  const currentPage = currentLayout.pages.find(p => p.id === activePageId) || currentLayout.pages[0];
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);

  const handleLayerSelect = (id: string, multi: boolean) => { EditorAPI.select([id], multi); };
  const handleContextMenu = (e: React.MouseEvent, node: any) => {
    e.preventDefault();
    setCtxMenu({ nodeId: node.id, nodeType: node.type, x: e.clientX, y: e.clientY });
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#1b1c2e] text-slate-200 font-sans select-none overflow-hidden">
      {/* HEADER */}
      <header className="h-10 shrink-0 flex items-center justify-between px-3 border-b border-white/[0.07] bg-[#15161f]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-6 h-6 bg-violet-600 rounded flex items-center justify-center shrink-0">
            <LayoutGrid size={14} className="text-white" />
          </div>
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs font-semibold truncate">{currentLayout.name}</span>
            <span className="text-slate-600">/</span>
            <span className="text-xs font-medium text-slate-400 truncate tracking-tight">{currentPage.name}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-[10px] font-bold text-violet-400 bg-violet-400/10 px-2 py-0.5 rounded border border-violet-400/20 mr-2">Design Mode</div>
          <CollaborationPanel />
          {onClose && (
            <button 
              onClick={onClose} 
              className="w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors ml-1 border border-transparent hover:border-slate-700" 
              title="Close UI Builder"
            >
              ✕
            </button>
          )}
        </div>
      </header>

      {/* MAIN BODY */}
      <div className="grow flex overflow-hidden">
        {/* LEFT SIDEBAR */}
        <aside className="w-64 shrink-0 border-r border-white/[0.07] bg-[#15161f] flex flex-col overflow-hidden">
          <div className="h-1/3 flex flex-col border-b border-white/[0.07] overflow-hidden">
            <div className="p-2 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Pages</span>
              <button onClick={() => addPage('New Page')} className="p-1 hover:bg-white/5 rounded text-slate-400 hover:text-white transition-colors">
                <FilePlus size={14} />
              </button>
            </div>
            <div className="grow overflow-y-auto px-1 py-1 space-y-0.5 custom-scrollbar">
              {currentLayout.pages.map(page => (
                <div
                  key={page.id}
                  onClick={() => setActiveNavigation(activeLayoutId, page.id)}
                  className={`group flex items-center px-2 py-1.5 rounded cursor-pointer transition-colors ${activePageId === page.id ? 'bg-violet-600/15 text-violet-400 shadow-sm' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}
                >
                  <span className="text-xs font-medium grow truncate">{page.name}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="grow flex flex-col overflow-hidden">
            <div className="p-2 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Layers</span>
            </div>
            <div className="grow overflow-y-auto custom-scrollbar" onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }}>
              <LayersPanel
                nodes={currentPage.nodes}
                selectedIds={selectedNodeIds}
                onSelect={handleLayerSelect}
                onContextMenu={handleContextMenu}
              />
            </div>
          </div>
        </aside>

        {/* CANVAS AREA */}
        <main className="grow relative bg-[#1b1c2e]" onClick={() => setCtxMenu(null)}>
          <CanvasViewport />

          {/* Bottom Tool Bar */}
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-10 flex items-center gap-0.5 bg-[#20212f]/95 backdrop-blur-md border border-white/10 p-1 rounded-xl shadow-2xl ring-1 ring-black/20">
            <ToolBtn icon={<MousePointer2 size={15} />} active={activeTool === 'select'} onClick={() => setActiveTool('select')} label="Move (V)" />
            <ToolBtn icon={<Hand size={15} />} active={activeTool === 'pan'} onClick={() => setActiveTool('pan')} label="Hand (H)" />
            <Sep />
            <ToolBtn icon={<LayoutGrid size={15} />} active={activeTool === 'frame'} onClick={() => setActiveTool('frame')} label="Frame (F)" />
            <ToolBtn icon={<Square size={15} />} active={activeTool === 'rect'} onClick={() => setActiveTool('rect')} label="Rectangle (R)" />
            <ToolBtn icon={<Type size={15} />} active={activeTool === 'text'} onClick={() => setActiveTool('text')} label="Text (T)" />
            <ToolBtn icon={<Pen size={15} />} active={activeTool === 'vector'} onClick={() => setActiveTool('vector')} label="Vector (P)" />
            <Sep />
            <ToolBtn icon={<Image size={15} />} active={activeTool === 'image'} onClick={() => setActiveTool('image')} label="Image (I)" />
            <ToolBtn icon={<Play size={15} />} active={activeTool === 'video'} onClick={() => setActiveTool('video')} label="Video (U)" />
            {selectedNodeIds.length >= 2 && (
              <>
                <Sep />
                <button
                  title="Group selected layers (Ctrl+G)"
                  onClick={() => groupNodes(selectedNodeIds)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-white/8 hover:text-sky-400 transition-colors"
                >
                  <Layers2 size={15} />
                </button>
              </>
            )}
          </div>
        </main>

        {/* RIGHT SIDEBAR */}
        <aside className="w-64 shrink-0 border-l border-white/[0.07] bg-[#15161f] flex flex-col overflow-hidden">
          <div className="grow overflow-y-auto custom-scrollbar">
            <PropertyInspector />
          </div>
        </aside>
      </div>

      {/* CONTEXT MENU */}
      {ctxMenu && (
        <div
          className="fixed z-[100] w-48 bg-[#222336] border border-white/10 rounded-lg shadow-2xl py-1 transform -translate-y-2 animate-in fade-in slide-in-from-top-1 duration-150"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          {selectedNodeIds.length >= 2 && (
            <MenuBtn icon={<Layers2 size={13} />} label="Group Selection" sub="Ctrl+G" onClick={() => { groupNodes(selectedNodeIds); setCtxMenu(null); }} />
          )}
          {ctxMenu.nodeType === NodeType.GROUP && (
            <MenuBtn icon={<Unlink size={13} />} label="Ungroup" sub="Ctrl+Shift+G" onClick={() => { ungroupNode(ctxMenu.nodeId); setCtxMenu(null); }} />
          )}
          <MenuBtn icon={<ArrowUp size={13} />} label="Bring Forward" sub="]" onClick={() => { reorderNode(ctxMenu.nodeId, 'up'); setCtxMenu(null); }} />
          <MenuBtn icon={<ArrowDown size={13} />} label="Send Backward" sub="[" onClick={() => { reorderNode(ctxMenu.nodeId, 'down'); setCtxMenu(null); }} />
          <div className="h-px bg-white/5 my-1" />
          <MenuBtn icon={<Trash2 size={13} />} label="Delete" sub="Del" onClick={() => { useUIBuilderStore.getState().deleteNode(ctxMenu.nodeId); setCtxMenu(null); }} danger />
        </div>
      )}

      <AICopilotPanel />
    </div>
  );
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const ToolBtn: React.FC<{ icon: React.ReactNode, active: boolean, onClick: () => void, label: string }> = ({ icon, active, onClick, label }) => (
  <button
    title={label} onClick={onClick}
    className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all ${active ? 'bg-violet-600 text-white shadow-lg scale-110' : 'text-slate-400 hover:bg-white/8 hover:text-slate-200'}`}
  >
    {icon}
  </button>
);

const MenuBtn: React.FC<{ icon: React.ReactNode, label: string, sub?: string, onClick: () => void, danger?: boolean }> = ({ icon, label, sub, onClick, danger }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center justify-between px-3 py-1.5 text-xs transition-colors ${danger ? 'text-red-400 hover:bg-red-500/10' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}
  >
    <div className="flex items-center gap-2.5">
      <span className="opacity-70">{icon}</span>
      <span>{label}</span>
    </div>
    {sub && <span className="text-[9px] text-slate-600 font-mono tracking-tighter">{sub}</span>}
  </button>
);

const Sep = () => <div className="w-px h-4 bg-white/10 mx-1" />;

const LayersPanel: React.FC<{
  nodes: any[]; selectedIds: string[]; onSelect: (id: string, multi: boolean) => void; onContextMenu: (e: React.MouseEvent, node: any) => void
}> = ({ nodes, selectedIds, onSelect, onContextMenu }) => {
  const [drag, setDrag] = useState<DragInfo>({ nodeId: '', overNodeId: null, pos: null });
  const { moveNodeToGroup, addNode } = useUIBuilderStore();

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('nodeId', id);
    setDrag({ ...drag, nodeId: id });
  };

  const handleDragOver = (e: React.DragEvent, id: string, type: string) => {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    let pos: 'above' | 'below' | 'into' = y < rect.height * 0.25 ? 'above' : y > rect.height * 0.75 ? 'below' : 'into';
    if (type !== NodeType.FRAME && type !== NodeType.GROUP) pos = y < rect.height / 2 ? 'above' : 'below';
    setDrag(d => ({ ...d, overNodeId: id, pos }));
  };

  const handleDrop = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('nodeId');
    if (draggedId === id) return;
    if (drag.pos === 'into') moveNodeToGroup(draggedId, id);
    else moveNodeToGroup(draggedId, null);
    setDrag({ nodeId: '', overNodeId: null, pos: null });
  };

  return (
    <div className="px-1 py-1 space-y-0.5" onDragLeave={() => setDrag(d => ({ ...d, overNodeId: null, pos: null }))}>
      {nodes.map(node => (
        <LayerItem
          key={node.id} node={node} depth={0} selectedIds={selectedIds} dragInfo={drag}
          onSelect={onSelect} onContextMenu={onContextMenu}
          onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop}
          onAddChild={(parentId, type) => {
            const newNode = type === 'frame' ? NodeFactory.createFrame(NodeFactory.makeId(), 'Frame') : type === 'rect' ? NodeFactory.createRect(NodeFactory.makeId(), 'Rect') : NodeFactory.createText(NodeFactory.makeId(), 'Text', 'Type something');
            addNode(newNode, parentId);
          }}
        />
      ))}
    </div>
  );
};

const LayerItem: React.FC<{
  node: any; depth: number; selectedIds: string[]; dragInfo: DragInfo;
  onSelect: (id: string, multi: boolean) => void;
  onContextMenu: (e: React.MouseEvent, node: any) => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragOver: (e: React.DragEvent, id: string, type: string) => void;
  onDrop: (e: React.DragEvent, id: string) => void;
  onAddChild: (parentId: string, type: 'frame' | 'rect' | 'text') => void;
}> = ({ node, depth, selectedIds, dragInfo, onSelect, onContextMenu, onDragStart, onDragOver, onDrop, onAddChild }) => {
  const [isOpen, setIsOpen] = useState(true);
  const isSelected = selectedIds.includes(node.id);
  const isDropTarget = dragInfo.overNodeId === node.id;

  return (
    <div className="flex flex-col">
      <div
        draggable
        onDragStart={(e) => onDragStart(e, node.id)}
        onDragOver={(e) => onDragOver(e, node.id, node.type)}
        onDrop={(e) => onDrop(e, node.id)}
        className={`group flex items-center h-[26px] gap-1.5 cursor-pointer px-2 rounded transition-colors mx-1 relative
          ${isSelected ? 'bg-violet-600/20 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}
          ${isDropTarget && dragInfo.pos === 'into' ? 'ring-1 ring-violet-500 bg-violet-600/10' : ''}`}
        style={{ paddingLeft: `${depth * 10 + 8}px` }}
        onClick={(e) => onSelect(node.id, e.ctrlKey || e.metaKey)}
        onContextMenu={(e) => onContextMenu(e, node)}
      >
        <div className="w-4 h-4 flex items-center justify-center">
          {node.children && node.children.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
              className="p-0.5 hover:bg-white/10 rounded transition-colors"
            >
              {isOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            </button>
          )}
        </div>
        {NODE_ICONS[node.type] || <Square size={12} />}
        <span className="text-[11px] font-medium truncate grow tracking-tight">{node.name}</span>

        {(node.type === NodeType.FRAME || node.type === NodeType.GROUP) && (
          <div className="hidden group-hover:flex items-center gap-1">
            <button onClick={(e) => { e.stopPropagation(); onAddChild(node.id, 'rect'); }} className="p-1 hover:bg-white/10 rounded text-slate-500 hover:text-white"><Plus size={10} /></button>
          </div>
        )}
      </div>
      {isDropTarget && dragInfo.pos === 'above' && <div className="h-0.5 bg-violet-500 mx-1 rounded-full z-10" />}
      {isDropTarget && dragInfo.pos === 'below' && <div className="h-0.5 bg-violet-500 mx-1 rounded-full z-10" />}
      {isOpen && node.children && node.children.length > 0 && (
        <div className="flex flex-col">
          {node.children.map((child: any) => (
            <LayerItem
              key={child.id} node={child} depth={depth + 1} selectedIds={selectedIds} dragInfo={dragInfo}
              onSelect={onSelect} onContextMenu={onContextMenu} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onAddChild={onAddChild}
            />
          ))}
        </div>
      )}
    </div>
  );
};
