import React, { useRef, useEffect, useState } from 'react';
import { useUIBuilderStore } from '../store';
import { CanvasRenderer } from '../renderer/CanvasRenderer';
import { DesignNode } from '../core/DesignNode';
import { EditorAPI } from '../core/EditorAPI';
import { peerNetworkManager } from '@/core/network/PeerNetworkManager';

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const CanvasViewport: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasRenderer>(new CanvasRenderer());

  const {
    document,
    selectedNodeIds,
    hoveredNodeId,
    peerStates,
    viewport,
    nodeLocks,
    hasEditAccess,
    setViewport
  } = useUIBuilderStore();

  const isDragging = useRef(false);
  const isPanning = useRef(false);
  const activeResizeHandle = useRef<ResizeHandle | null>(null);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const initialNodePos = useRef<{ id: string, x: number, y: number, w: number, h: number }[]>([]);

  const updateCanvasSize = () => {
    if (canvasRef.current && canvasRef.current.parentElement) {
      const canvas = canvasRef.current;
      const parent = canvas.parentElement;
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
      render();
    }
  };

  const render = () => {
    if (canvasRef.current) {
      rendererRef.current.render(
        document,
        canvasRef.current,
        selectedNodeIds,
        viewport,
        nodeLocks,
        peerNetworkManager.getLocalPeerId()
      );
    }
  };

  useEffect(() => {
    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);
    return () => window.removeEventListener('resize', updateCanvasSize);
  }, []);

  useEffect(() => {
    render();
  }, [document, selectedNodeIds, hoveredNodeId, peerStates, viewport, nodeLocks]);

  const screenToWorld = (screenX: number, screenY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    return {
      x: (screenX - canvas.width / 2) / viewport.zoom + canvas.width / 2 - viewport.scrollX,
      y: (screenY - canvas.height / 2) / viewport.zoom + canvas.height / 2 - viewport.scrollY
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const pos = screenToWorld(e.clientX, e.clientY);

    if (hasEditAccess) {
      EditorAPI.moveCursor(pos.x, pos.y);
    }

    if (isPanning.current) {
      const dx = e.clientX - dragStartPos.current.x;
      const dy = e.clientY - dragStartPos.current.y;
      setViewport({
        scrollX: viewport.scrollX + dx / viewport.zoom,
        scrollY: viewport.scrollY + dy / viewport.zoom
      });
      dragStartPos.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (activeResizeHandle.current && selectedNodeIds.length === 1 && hasEditAccess) {
      const nodeInit = initialNodePos.current[0];
      const dx = pos.x - dragStartPos.current.x;
      const dy = pos.y - dragStartPos.current.y;
      const handle = activeResizeHandle.current;

      let newX = nodeInit.x, newY = nodeInit.y, newW = nodeInit.w, newH = nodeInit.h;

      if (handle.includes('e')) newW = Math.max(10, nodeInit.w + dx);
      if (handle.includes('s')) newH = Math.max(10, nodeInit.h + dy);
      if (handle.includes('w')) {
        const delta = Math.min(nodeInit.w - 10, dx);
        newX = nodeInit.x + delta;
        newW = nodeInit.w - delta;
      }
      if (handle.includes('n')) {
        const delta = Math.min(nodeInit.h - 10, dy);
        newY = nodeInit.y + delta;
        newH = nodeInit.h - delta;
      }

      EditorAPI.updateNode(selectedNodeIds[0], { x: newX, y: newY, width: newW, height: newH });
      return;
    }

    if (isDragging.current && selectedNodeIds.length > 0 && hasEditAccess) {
      const dx = pos.x - dragStartPos.current.x;
      const dy = pos.y - dragStartPos.current.y;
      initialNodePos.current.forEach(nodeInit => {
        EditorAPI.updateNode(nodeInit.id, {
          x: Math.round(nodeInit.x + dx),
          y: Math.round(nodeInit.y + dy)
        });
      });
      return;
    }

    const node = findNodeAt(document.pages[0].nodes, pos.x, pos.y);
    if (node?.id !== hoveredNodeId) {
      EditorAPI.hover(node?.id || null);
    }
  };

  const isLockedForLocal = (node: DesignNode): boolean => {
    const holder = nodeLocks[node.id];
    return holder && holder !== peerNetworkManager.getLocalPeerId() ? true : false;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      isPanning.current = true;
      dragStartPos.current = { x: e.clientX, y: e.clientY };
      return;
    }

    const pos = screenToWorld(e.clientX, e.clientY);

    // Check for resize handles
    if (selectedNodeIds.length === 1 && hasEditAccess) {
      const node = findNodeById(document.pages[0].nodes, selectedNodeIds[0]);
      if (node && !isLockedForLocal(node)) {
        const handle = getResizeHandleAt(node, pos.x, pos.y);
        if (handle) {
          activeResizeHandle.current = handle;
          dragStartPos.current = pos;
          initialNodePos.current = [{ id: node.id, x: node.x, y: node.y, w: node.width, h: node.height }];
          return;
        }
      }
    }

    const node = findNodeAt(document.pages[0].nodes, pos.x, pos.y);
    if (node) {
      if (isLockedForLocal(node) || !hasEditAccess) {
        EditorAPI.select(hasEditAccess ? [] : [node.id]); // Just read-only select if no access
        return;
      }

      if (!selectedNodeIds.includes(node.id)) {
        EditorAPI.select([node.id], e.metaKey || e.ctrlKey);
      }
      isDragging.current = true;
      dragStartPos.current = pos;
      const state = useUIBuilderStore.getState();
      initialNodePos.current = state.selectedNodeIds.map(id => {
        const found = findNodeById(state.document.pages[0].nodes, id);
        return { id, x: found?.x || 0, y: found?.y || 0, w: found?.width || 0, h: found?.height || 0 };
      });
    } else {
      EditorAPI.select([]);
    }
  };

  const handleMouseUp = () => {
    isDragging.current = false;
    isPanning.current = false;
    activeResizeHandle.current = null;
    initialNodePos.current = [];
  };

  const getResizeHandleAt = (node: DesignNode, worldX: number, worldY: number): ResizeHandle | null => {
    const threshold = 10 / viewport.zoom;
    const nx = node.x, ny = node.y, nw = node.width, nh = node.height;

    if (Math.abs(worldX - nx) < threshold && Math.abs(worldY - ny) < threshold) return 'nw';
    if (Math.abs(worldX - (nx + nw)) < threshold && Math.abs(worldY - ny) < threshold) return 'ne';
    if (Math.abs(worldX - nx) < threshold && Math.abs(worldY - (ny + nh)) < threshold) return 'sw';
    if (Math.abs(worldX - (nx + nw)) < threshold && Math.abs(worldY - (ny + nh)) < threshold) return 'se';
    if (Math.abs(worldX - (nx + nw / 2)) < threshold && Math.abs(worldY - ny) < threshold) return 'n';
    if (Math.abs(worldX - (nx + nw / 2)) < threshold && Math.abs(worldY - (ny + nh)) < threshold) return 's';
    if (Math.abs(worldX - nx) < threshold && Math.abs(worldY - (ny + nh / 2)) < threshold) return 'w';
    if (Math.abs(worldX - (nx + nw)) < threshold && Math.abs(worldY - (ny + nh / 2)) < threshold) return 'e';

    return null;
  };

  const findNodeAt = (nodes: DesignNode[], x: number, y: number): DesignNode | null => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      if (node.children) {
        const found = findNodeAt(node.children, x - node.x, y - node.y);
        if (found) return found;
      }
      if (x >= node.x && x <= node.x + node.width && y >= node.y && y <= node.y + node.height) return node;
    }
    return null;
  };

  const findNodeById = (nodes: DesignNode[], id: string): DesignNode | null => {
    for (const node of nodes) {
      if (node.id === id) return node;
      if (node.children) {
        const found = findNodeById(node.children, id);
        if (found) return found;
      }
    }
    return null;
  };

  return (
    <div className="w-full h-full bg-surface-300 relative overflow-hidden">
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { EditorAPI.hover(null); handleMouseUp(); }}
        className="absolute top-0 left-0 w-full h-full outline-none"
        style={{ cursor: isPanning.current ? 'grabbing' : activeResizeHandle.current ? 'crosshair' : isDragging.current ? 'grabbing' : hoveredNodeId ? 'pointer' : 'default' }}
      />
      <div className="absolute bottom-4 right-4 bg-surface-100 border border-border px-2 py-1 rounded text-[10px] font-mono text-text-dim">
        {Math.round(viewport.zoom * 100)}%
      </div>
    </div>
  );
};
