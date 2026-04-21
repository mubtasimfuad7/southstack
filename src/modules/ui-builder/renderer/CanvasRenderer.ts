import { Renderer } from './Renderer';
import { DesignDocument } from '../core/DesignDocument';
import { DesignNode } from '../core/DesignNode';
import { NodeType } from '../core/NodeTypes';
import { NodeFactory } from '../core/NodeFactory';

export class CanvasRenderer implements Renderer {
  private ctx: CanvasRenderingContext2D | null = null;
  private zoom: number = 1;
  private scrollX: number = 0;
  private scrollY: number = 0;
  private mediaCache: Map<string, HTMLImageElement | HTMLVideoElement> = new Map();

  render(document: DesignDocument, canvas: HTMLCanvasElement, selectedIds: string[], viewport: any, activeLayoutId: string, activePageId: string, nodeLocks: Record<string, string> = {}, localPeerId: string = '', hoveredNodeId: string | null = null, onMediaLoad?: () => void): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    this.ctx = ctx;
    this.zoom = viewport.zoom;
    this.scrollX = viewport.scrollX;
    this.scrollY = viewport.scrollY;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-canvas.width / 2 + this.scrollX, -canvas.height / 2 + this.scrollY);

    const layout = document.layouts.find(l => l.id === activeLayoutId);
    const page = layout?.pages.find(p => p.id === activePageId);

    if (page) {
      page.nodes.forEach(node => {
        NodeFactory.computeStyles(node);
        this.renderNode(node, selectedIds, nodeLocks, localPeerId, hoveredNodeId, onMediaLoad);
      });

      const labelSize = Math.max(9, 12 / this.zoom);
      ctx.font = `500 ${labelSize}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(148, 163, 184, 0.7)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      page.nodes.filter(n => n.type === NodeType.FRAME || n.type === NodeType.GROUP).forEach(node => {
        ctx.fillText(node.name, node.x, node.y - 8 / this.zoom);
      });
    }

    ctx.restore();
  }

  private renderNode(node: DesignNode, selectedIds: string[], nodeLocks: Record<string, string>, localPeerId: string, hoveredNodeId: string | null, onMediaLoad?: () => void): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    ctx.save();
    
    // ── Transformation ──
    ctx.translate(node.x + node.width / 2, node.y + node.height / 2);
    if (node.rotation) ctx.rotate((node.rotation * Math.PI) / 180);
    ctx.translate(-node.width / 2, -node.height / 2);

    const attr = node.attributes || {};
    
    // ── Global Effects ──
    if (attr.opacity !== undefined) ctx.globalAlpha = attr.opacity;
    if (attr.filter) ctx.filter = attr.filter;
    if (attr.boxShadow) {
      const [ox, oy, blur, color] = attr.boxShadow.split(' ');
      ctx.shadowOffsetX = parseFloat(ox);
      ctx.shadowOffsetY = parseFloat(oy);
      ctx.shadowBlur = parseFloat(blur);
      ctx.shadowColor = color;
    }

    // ── Shape Rendering ──
    if (attr.backgroundColor) {
      ctx.fillStyle = attr.backgroundColor;
      ctx.fillRect(0, 0, node.width, node.height);
    }

    // ── Media Rendering (Image/Video) ──
    if (node.type === NodeType.IMAGE || node.type === NodeType.VIDEO) {
      const srcDec = node.decorators.find(d => d.type === 'source');
      const url = srcDec?.config.url;
      if (url) {
        let media = this.mediaCache.get(url);
        if (!media) {
          if (node.type === NodeType.IMAGE) {
            media = new Image();
            media.src = url;
            media.onload = () => onMediaLoad?.();
          } else {
            media = document.createElement('video');
            media.src = url;
            media.loop = srcDec.config.loop || false;
            media.muted = true;
            media.play().catch(() => {});
          }
          this.mediaCache.set(url, media);
        }
        if (media instanceof HTMLImageElement && media.complete) {
          ctx.drawImage(media, 0, 0, node.width, node.height);
        } else if (media instanceof HTMLVideoElement && media.readyState >= 2) {
          ctx.drawImage(media, 0, 0, node.width, node.height);
        }
      }
    }

    // ── Text Rendering ──
    if (node.type === NodeType.TEXT && node.content) {
      ctx.fillStyle = attr.color || '#000000';
      ctx.font = `${attr.fontWeight || 'normal'} ${attr.fontSize || 16}px Inter, Arial`;
      
      // Horizontal align
      let tx = 0;
      if (attr.textAlign === 'center') { ctx.textAlign = 'center'; tx = node.width / 2; }
      else if (attr.textAlign === 'right') { ctx.textAlign = 'right'; tx = node.width; }
      else ctx.textAlign = 'left';

      // Vertical align
      let ty = 0;
      if (attr.verticalAlign === 'middle') { ctx.textBaseline = 'middle'; ty = node.height / 2; }
      else if (attr.verticalAlign === 'bottom') { ctx.textBaseline = 'bottom'; ty = node.height; }
      else { ctx.textBaseline = 'top'; ty = 0; }

      ctx.fillText(node.content, tx, ty);
    }

    // ── Children ──
    if (node.children) {
      node.children.forEach(child => this.renderNode(child, selectedIds, nodeLocks, localPeerId, hoveredNodeId, onMediaLoad));
    }

    // ── Selection/Hover/Locks Overlays ──
    ctx.shadowColor = 'transparent'; // Reset shadow for overlays
    ctx.filter = 'none';
    ctx.globalAlpha = 1.0;

    const holder = nodeLocks[node.id];
    const isLockedByOther = holder && holder !== localPeerId;
    const isSelected = selectedIds.includes(node.id);
    const isHovered = hoveredNodeId === node.id;

    if (isLockedByOther) {
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2 / this.zoom;
      ctx.strokeRect(0, 0, node.width, node.height);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(0, -14 / this.zoom, Math.min(node.width, 100), 14 / this.zoom);
      ctx.fillStyle = '#ffffff';
      ctx.font = `${8 / this.zoom}px monospace`;
      ctx.fillText(`🔒 ${holder.substring(0, 6)}`, 2 / this.zoom, -4 / this.zoom);
    } else if (isSelected) {
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 2 / this.zoom;
      ctx.strokeRect(0, 0, node.width, node.height);
      this.drawHandles(node.width, node.height);
    } else if (isHovered) {
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 1 / this.zoom;
      ctx.setLineDash([4 / this.zoom, 4 / this.zoom]);
      ctx.strokeRect(0, 0, node.width, node.height);
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  private drawHandles(w: number, h: number): void {
    if (!this.ctx) return;
    const size = 6 / this.zoom;
    this.ctx.fillStyle = '#ffffff';
    this.ctx.strokeStyle = '#6366f1';
    this.ctx.lineWidth = 1 / this.zoom;

    const handles = [
      [0, 0], [w, 0], [0, h], [w, h],
      [w / 2, 0], [w / 2, h], [0, h / 2], [w, h / 2]
    ];

    handles.forEach(([hx, hy]) => {
      this.ctx?.fillRect(hx - size / 2, hy - size / 2, size, size);
      this.ctx?.strokeRect(hx - size / 2, hy - size / 2, size, size);
    });

    const rotY = -20 / this.zoom;
    this.ctx.beginPath();
    this.ctx.moveTo(w / 2, 0);
    this.ctx.lineTo(w / 2, rotY);
    this.ctx.stroke();
    this.ctx.beginPath();
    this.ctx.arc(w / 2, rotY, size / 2, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.stroke();
  }
}
