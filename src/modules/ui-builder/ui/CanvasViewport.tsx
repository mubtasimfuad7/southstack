import React, { useRef, useEffect, useState } from 'react';
import { useUIBuilderStore } from '../store';
import { CanvasRenderer } from '../renderer/CanvasRenderer';
import { DesignNode } from '../core/DesignNode';
import { EditorAPI } from '../core/EditorAPI';
import { NodeFactory } from '../core/NodeFactory';
import { NodeType } from '../core/NodeTypes';
import { peerNetworkManager } from '@/core/network/PeerNetworkManager';

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rot';

interface Transform { x: number; y: number; rotation: number; }
interface DrawState { startX: number; startY: number; endX: number; endY: number; }

const DRAWING_TOOLS = new Set(['frame', 'rect', 'text', 'vector', 'image', 'video']);

type AssetRef = { assetId: string; ownerPeerId: string; fileName: string };

const findMissingAssetRefs = (document: any): AssetRef[] => {
  const refs = new Map<string, AssetRef>();
  const visit = (node: DesignNode) => {
    const source = node.decorators.find(d => d.type === 'source')?.config;
    if (source?.assetId && source?.ownerPeerId) {
      refs.set(source.assetId, {
        assetId: source.assetId,
        ownerPeerId: source.ownerPeerId,
        fileName: source.fileName || 'Private photo'
      });
    }
    node.children?.forEach(visit);
  };
  document.layouts?.forEach((layout: any) => {
    layout.pages?.forEach((page: any) => page.nodes?.forEach(visit));
  });
  return [...refs.values()];
};

export const CanvasViewport: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasRenderer>(new CanvasRenderer());

  const {
    document, selectedNodeIds, hoveredNodeId, peerStates, viewport, nodeLocks,
    hasEditAccess, activeLayoutId, activePageId, uploadedAssets, requestedAssetIds,
    setViewport, findNode, getParentNode, activeTool, setActiveTool
  } = useUIBuilderStore();

  const [isDragging, setIsDragging] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [activeResizeHandle, setActiveResizeHandle] = useState<ResizeHandle | null>(null);
  const [isRotating, setIsRotating] = useState(false);
  const [drawState, setDrawState] = useState<DrawState | null>(null);
  const [isMarquee, setIsMarquee] = useState(false);

  const dragStartPos = useRef({ x: 0, y: 0 });
  const initialNodePos = useRef<{ id: string, x: number, y: number, w: number, h: number, rot: number }[]>([]);

  // ── resize canvas ───────────────────────────────────────────────────────────
  const updateCanvasSize = () => {
    if (canvasRef.current?.parentElement) {
      canvasRef.current.width = canvasRef.current.parentElement.clientWidth;
      canvasRef.current.height = canvasRef.current.parentElement.clientHeight;
      render();
    }
  };

  // ── render ──────────────────────────────────────────────────────────────────
  const render = () => {
    if (!canvasRef.current) return;
    rendererRef.current.render(
      document, canvasRef.current, selectedNodeIds, viewport,
      activeLayoutId, activePageId, nodeLocks,
      peerNetworkManager.getLocalPeerId(), hoveredNodeId,
      (assetId) => uploadedAssets[assetId]?.dataUrl || null,
      () => requestAnimationFrame(render)
    );

    // Draw rubberband preview when using a drawing tool or marquee
    const ds = drawState;
    if (ds && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        const canvas = canvasRef.current;
        const toScreen = (wx: number, wy: number) => ({
          x: (wx - canvas.width / 2 + viewport.scrollX) * viewport.zoom + canvas.width / 2,
          y: (wy - canvas.height / 2 + viewport.scrollY) * viewport.zoom + canvas.height / 2,
        });
        const sx = Math.min(ds.startX, ds.endX), sy = Math.min(ds.startY, ds.endY);
        const ex = Math.max(ds.startX, ds.endX), ey = Math.max(ds.startY, ds.endY);
        const s = toScreen(sx, sy);
        const e = toScreen(ex, ey);
        ctx.save();
        ctx.fillStyle = isMarquee ? 'rgba(99,102,241,0.05)' : 'rgba(99,102,241,0.08)';
        ctx.fillRect(s.x, s.y, e.x - s.x, e.y - s.y);
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 1;
        if (!isMarquee) ctx.setLineDash([4, 3]);
        ctx.strokeRect(s.x, s.y, e.x - s.x, e.y - s.y);
        ctx.restore();
      }
    }
  };

  useEffect(() => {
    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);
    return () => window.removeEventListener('resize', updateCanvasSize);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const factor = Math.pow(1.1, -e.deltaY / 100);
        const newZoom = Math.min(Math.max(viewport.zoom * factor, 0.05), 20);
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const wx = (mx - canvas.width / 2) / viewport.zoom + canvas.width / 2 - viewport.scrollX;
        const wy = (my - canvas.height / 2) / viewport.zoom + canvas.height / 2 - viewport.scrollY;
        setViewport({ zoom: newZoom, scrollX: -(canvas.width / 2 - (mx - canvas.width / 2) / newZoom - wx), scrollY: -(canvas.height / 2 - (my - canvas.height / 2) / newZoom - wy) });
      } else {
        setViewport({ scrollX: viewport.scrollX - e.deltaX / viewport.zoom, scrollY: viewport.scrollY - e.deltaY / viewport.zoom });
      }
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [viewport, setViewport]);

  useEffect(() => { render(); }, [document, selectedNodeIds, hoveredNodeId, peerStates, viewport, nodeLocks, activeLayoutId, activePageId, drawState, isMarquee, uploadedAssets]);

  useEffect(() => {
    const localPeerId = peerNetworkManager.getLocalPeerId();
    findMissingAssetRefs(document).forEach(ref => {
      if (uploadedAssets[ref.assetId]) return;
      if (requestedAssetIds[ref.assetId] === 'requested') return;
      if (requestedAssetIds[ref.assetId] === 'denied') return;
      if (!ref.ownerPeerId || ref.ownerPeerId === localPeerId) return;
      EditorAPI.requestAssetAccess(ref.assetId, ref.ownerPeerId, ref.fileName);
    });
  }, [document, uploadedAssets, requestedAssetIds]);

  // ── coordinate helpers ──────────────────────────────────────────────────────
  const screenToWorld = (screenX: number, screenY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (screenX - rect.left - canvas.width / 2) / viewport.zoom + canvas.width / 2 - viewport.scrollX,
      y: (screenY - rect.top - canvas.height / 2) / viewport.zoom + canvas.height / 2 - viewport.scrollY,
    };
  };

  const getAbsoluteTransform = (node: DesignNode): Transform => {
    const parent = getParentNode(node.id);
    if (!parent) return { x: node.x, y: node.y, rotation: node.rotation || 0 };
    const pt = getAbsoluteTransform(parent);
    const rad = pt.rotation * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const relCX = node.x + node.width / 2 - parent.width / 2;
    const relCY = node.y + node.height / 2 - parent.height / 2;
    const absCX = pt.x + parent.width / 2 + (relCX * cos - relCY * sin);
    const absCY = pt.y + parent.height / 2 + (relCX * sin + relCY * cos);
    return { x: absCX - node.width / 2, y: absCY - node.height / 2, rotation: pt.rotation + (node.rotation || 0) };
  };

  const worldToLocal = (worldX: number, worldY: number, node: DesignNode) => {
    const abs = getAbsoluteTransform(node);
    const cx = abs.x + node.width / 2, cy = abs.y + node.height / 2;
    const angle = -abs.rotation * Math.PI / 180;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const dx = worldX - cx, dy = worldY - cy;
    return { x: dx * cos - dy * sin + node.width / 2, y: dx * sin + dy * cos + node.height / 2 };
  };

  // ── cursor ──────────────────────────────────────────────────────────────────
  const getCursor = () => {
    if (activeTool === 'pan') return isPanning ? 'grabbing' : 'grab';
    if (DRAWING_TOOLS.has(activeTool) && activeTool !== 'pan') return 'crosshair';
    if (isPanning) return 'grabbing';
    if (isRotating) return 'crosshair';
    if (activeResizeHandle) return 'crosshair';
    if (isDragging) return 'grabbing';
    if (hoveredNodeId) return 'pointer';
    return 'default';
  };


  // ── finish drawing ──────────────────────────────────────────────────────────

  // ── finish drawing ──────────────────────────────────────────────────────────
  const finishDraw = (ds: DrawState, tool: string) => {
    const x = Math.min(ds.startX, ds.endX);
    const y = Math.min(ds.startY, ds.endY);
    const w = Math.abs(ds.endX - ds.startX);
    const h = Math.abs(ds.endY - ds.startY);
    if (w < 4 || h < 4) return;

    if (isMarquee) {
      const activeNodes = document.layouts.find(l => l.id === activeLayoutId)?.pages.find(p => p.id === activePageId)?.nodes || [];
      const overlaps = findNodesInRect(activeNodes, x, y, w, h);
      EditorAPI.select(overlaps.map(n => n.id));
      setIsMarquee(false);
      return;
    }

    const id = NodeFactory.makeId();
    let node: DesignNode;
    if (tool === 'frame') node = NodeFactory.createFrame(id, 'Frame');
    else if (tool === 'rect') node = NodeFactory.createRect(id, 'Rectangle');
    else if (tool === 'text') node = NodeFactory.createText(id, 'Text', 'Type something');
    else if (tool === 'image') node = NodeFactory.createImage(id, 'Image', 'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?auto=format&fit=crop&w=400&q=80');
    else if (tool === 'video') node = NodeFactory.createVideo(id, 'Video', 'https://video.twimg.com/ext_tw_video/1450250644917522434/pu/vid/1280x720/6p9_x_f5G_w_fB_q.mp4');
    else node = NodeFactory.createVector(id, 'Vector');

    let parentId: string | undefined;
    let nextX = x;
    let nextY = y;
    if (selectedNodeIds.length === 1) {
      const selectedNode = findNode(selectedNodeIds[0]);
      if (selectedNode && (selectedNode.type === NodeType.FRAME || selectedNode.type === NodeType.GROUP)) {
        const localStart = worldToLocal(x, y, selectedNode);
        parentId = selectedNode.id;
        nextX = localStart.x;
        nextY = localStart.y;
      }
    }

    node.x = nextX; node.y = nextY; node.width = w; node.height = h;
    const ld = node.decorators.find(d => d.type === 'layout');
    if (ld) ld.config = { ...ld.config, x: nextX, y: nextY, width: w, height: h };

    EditorAPI.addNode(node, parentId);
    EditorAPI.select([id]);
    setActiveTool('select');
  };

  // ── mouse handlers ──────────────────────────────────────────────────────────
  const handleMouseDown = (e: React.MouseEvent) => {
    const pos = screenToWorld(e.clientX, e.clientY);

    if (activeTool === 'pan' || e.button === 1 || (e.button === 0 && e.shiftKey && activeTool === 'select')) {
      setIsPanning(true);
      dragStartPos.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (e.button === 0 && DRAWING_TOOLS.has(activeTool)) {
      setDrawState({ startX: pos.x, startY: pos.y, endX: pos.x, endY: pos.y });
      return;
    }

    if (e.button === 0) {
      if (selectedNodeIds.length === 1 && hasEditAccess) {
        const node = findNode(selectedNodeIds[0]);
        if (node) {
          const handle = getResizeHandleAt(node, pos.x, pos.y);
          if (handle === 'rot') { setIsRotating(true); dragStartPos.current = pos; return; }
          if (handle) {
            setActiveResizeHandle(handle);
            dragStartPos.current = pos;
            initialNodePos.current = [{ id: node.id, x: node.x, y: node.y, w: node.width, h: node.height, rot: node.rotation || 0 }];
            return;
          }
        }
      }

      const activeNodes = document.layouts.find(l => l.id === activeLayoutId)?.pages.find(p => p.id === activePageId)?.nodes || [];
      const node = findNodeAt(activeNodes, pos.x, pos.y);
      if (node) {
        const isLockedByOther = nodeLocks[node.id] && nodeLocks[node.id] !== peerNetworkManager.getLocalPeerId();
        if (isLockedByOther || !hasEditAccess) { EditorAPI.select(hasEditAccess ? [] : [node.id]); return; }
        if (!selectedNodeIds.includes(node.id)) EditorAPI.select([node.id], e.metaKey || e.ctrlKey);
        setIsDragging(true);
        dragStartPos.current = pos;
        initialNodePos.current = useUIBuilderStore.getState().selectedNodeIds.map(id => {
          const n = findNode(id);
          return { id, x: n?.x || 0, y: n?.y || 0, w: n?.width || 0, h: n?.height || 0, rot: n?.rotation || 0 };
        });
      } else {
        // Start Marquee Select
        setIsMarquee(true);
        setDrawState({ startX: pos.x, startY: pos.y, endX: pos.x, endY: pos.y });
        EditorAPI.select([]);
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const pos = screenToWorld(e.clientX, e.clientY);
    if (hasEditAccess) EditorAPI.moveCursor(pos.x, pos.y);

    if (isPanning) {
      const dx = e.clientX - dragStartPos.current.x, dy = e.clientY - dragStartPos.current.y;
      setViewport({ scrollX: viewport.scrollX + dx / viewport.zoom, scrollY: viewport.scrollY + dy / viewport.zoom });
      dragStartPos.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (drawState) {
      setDrawState(prev => prev ? { ...prev, endX: pos.x, endY: pos.y } : null);
      return;
    }

    if (isRotating && selectedNodeIds.length === 1 && hasEditAccess) {
      const node = findNode(selectedNodeIds[0]);
      if (node) {
        const abs = getAbsoluteTransform(node);
        const cx = abs.x + node.width / 2, cy = abs.y + node.height / 2;
        const p = getParentNode(node.id);
        const pAbs = p ? getAbsoluteTransform(p) : { rotation: 0 };
        EditorAPI.updateNode(node.id, { rotation: Math.atan2(pos.y - cy, pos.x - cx) * 180 / Math.PI + 90 - pAbs.rotation });
      }
      return;
    }

    if (activeResizeHandle && selectedNodeIds.length === 1 && hasEditAccess) {
      const init = initialNodePos.current[0];
      const node = findNode(init.id);
      if (!node) return;
      const abs = getAbsoluteTransform(node);
      const p = getParentNode(node.id);
      const pAbs = p ? getAbsoluteTransform(p) : { rotation: 0 };
      const toLocal = (vx: number, vy: number, rot: number) => { const r = -rot * Math.PI / 180; return { x: vx * Math.cos(r) - vy * Math.sin(r), y: vx * Math.sin(r) + vy * Math.cos(r) }; };
      const toWorld = (vx: number, vy: number, rot: number) => { const r = rot * Math.PI / 180; return { x: vx * Math.cos(r) - vy * Math.sin(r), y: vx * Math.sin(r) + vy * Math.cos(r) }; };
      const ld = toLocal(pos.x - dragStartPos.current.x, pos.y - dragStartPos.current.y, abs.rotation);
      let dw = 0, dh = 0;
      if (activeResizeHandle.includes('e')) dw = ld.x;
      if (activeResizeHandle.includes('w')) dw = -ld.x;
      if (activeResizeHandle.includes('s')) dh = ld.y;
      if (activeResizeHandle.includes('n')) dh = -ld.y;
      const nW = Math.max(10, init.w + dw), nH = Math.max(10, init.h + dh);
      const aW = nW - init.w, aH = nH - init.h;
      const lcm = { x: (activeResizeHandle.includes('e') ? aW : activeResizeHandle.includes('w') ? -aW : 0) / 2, y: (activeResizeHandle.includes('s') ? aH : activeResizeHandle.includes('n') ? -aH : 0) / 2 };
      const wcm = toWorld(lcm.x, lcm.y, abs.rotation);
      const plm = toLocal(wcm.x, wcm.y, pAbs.rotation);
      EditorAPI.updateNode(init.id, { x: init.x + plm.x - aW / 2, y: init.y + plm.y - aH / 2, width: nW, height: nH });
      return;
    }

    if (isDragging && selectedNodeIds.length > 0 && hasEditAccess) {
      const wdx = pos.x - dragStartPos.current.x, wdy = pos.y - dragStartPos.current.y;
      initialNodePos.current.forEach(init => {
        const p = getParentNode(init.id);
        const pAbs = p ? getAbsoluteTransform(p) : { rotation: 0 };
        const r = -pAbs.rotation * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
        EditorAPI.updateNode(init.id, { x: Math.round(init.x + wdx * c - wdy * s), y: Math.round(init.y + wdx * s + wdy * c) });
      });
      return;
    }

    const activeNodes = document.layouts.find(l => l.id === activeLayoutId)?.pages.find(p => p.id === activePageId)?.nodes || [];
    const node = findNodeAt(activeNodes, pos.x, pos.y);
    if (node?.id !== hoveredNodeId) EditorAPI.hover(node?.id || null);
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (drawState) { finishDraw(drawState, activeTool); setDrawState(null); }

    if (isDragging && selectedNodeIds.length > 0) {
      // Auto-reparenting logic
      const state = useUIBuilderStore.getState();
      const firstId = selectedNodeIds[0];
      const abs = state.getAbsoluteTransform(firstId);
      const node = state.findNode(firstId);
      if (node) {
        const cx = abs.x + node.width / 2;
        const cy = abs.y + node.height / 2;
        const newParent = state.findParentAt(cx, cy, selectedNodeIds);
        const oldParent = state.getParentNode(firstId);

        if (newParent?.id !== oldParent?.id) {
          selectedNodeIds.forEach(id => state.moveNodeToGroup(id, newParent?.id || null));
        }
      }
    }

    setIsDragging(false); setIsPanning(false); setIsRotating(false); setActiveResizeHandle(null); setIsMarquee(false); initialNodePos.current = [];
  };

  const getResizeHandleAt = (node: DesignNode, wx: number, wy: number): ResizeHandle | null => {
    const local = worldToLocal(wx, wy, node);
    const t = 10 / viewport.zoom, lw = node.width, lh = node.height, { x: lx, y: ly } = local;
    if (Math.abs(lx - lw / 2) < t && Math.abs(ly - (-20 / viewport.zoom)) < t) return 'rot';
    if (Math.abs(lx) < t && Math.abs(ly) < t) return 'nw';
    if (Math.abs(lx - lw) < t && Math.abs(ly) < t) return 'ne';
    if (Math.abs(lx) < t && Math.abs(ly - lh) < t) return 'sw';
    if (Math.abs(lx - lw) < t && Math.abs(ly - lh) < t) return 'se';
    if (Math.abs(lx - lw / 2) < t && Math.abs(ly) < t) return 'n';
    if (Math.abs(lx - lw / 2) < t && Math.abs(ly - lh) < t) return 's';
    if (Math.abs(lx) < t && Math.abs(ly - lh / 2) < t) return 'w';
    if (Math.abs(lx - lw) < t && Math.abs(ly - lh / 2) < t) return 'e';
    return null;
  };

  const findNodeAt = (nodes: DesignNode[], x: number, y: number): DesignNode | null => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      if (node.children?.length) { const f = findNodeAt(node.children, x, y); if (f) return f; }
      const local = worldToLocal(x, y, node);
      if (local.x >= 0 && local.x <= node.width && local.y >= 0 && local.y <= node.height) return node;
    }
    return null;
  };

  const findNodesInRect = (nodes: DesignNode[], rx: number, ry: number, rw: number, rh: number): DesignNode[] => {
    let results: DesignNode[] = [];
    nodes.forEach(node => {
      const abs = getAbsoluteTransform(node);
      if (abs.x >= rx && abs.y >= ry && abs.x + node.width <= rx + rw && abs.y + node.height <= ry + rh) results.push(node);
      if (node.children?.length) results = [...results, ...findNodesInRect(node.children, rx, ry, rw, rh)];
    });

    // Figma constraint: marquee selection should favor the same parent.
    // We'll pick the parent of the first result and filter others to match.
    if (results.length > 1) {
      const state = useUIBuilderStore.getState();
      const firstParent = state.getParentNode(results[0].id);
      return results.filter(n => state.getParentNode(n.id)?.id === firstParent?.id);
    }
    return results;
  };

  return (
    <div className="w-full h-full bg-[#1b1c2e] relative overflow-hidden">
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { EditorAPI.hover(null); handleMouseUp({} as React.MouseEvent); }}
        className="absolute top-0 left-0 w-full h-full outline-none"
        style={{ cursor: getCursor() }}
      />
    </div>
  );
};
