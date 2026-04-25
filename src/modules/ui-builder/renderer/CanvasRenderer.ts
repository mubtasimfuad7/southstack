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

  render(document: DesignDocument, canvas: HTMLCanvasElement, selectedIds: string[], viewport: any, activeLayoutId: string, activePageId: string, nodeLocks: Record<string, string> = {}, localPeerId: string = '', hoveredNodeId: string | null = null, resolveAsset?: (assetId: string) => string | null, onMediaLoad?: () => void): void {
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
        this.renderNode(node, selectedIds, nodeLocks, localPeerId, hoveredNodeId, resolveAsset, onMediaLoad);
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

  private renderNode(node: DesignNode, selectedIds: string[], nodeLocks: Record<string, string>, localPeerId: string, hoveredNodeId: string | null, resolveAsset?: (assetId: string) => string | null, onMediaLoad?: () => void): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    ctx.save();
    
    // ── Transformation ──
    ctx.translate(node.x + node.width / 2, node.y + node.height / 2);
    if (node.rotation) ctx.rotate((node.rotation * Math.PI) / 180);
    ctx.translate(-node.width / 2, -node.height / 2);

    const attr = node.attributes || {};
    const radius = parseFloat(attr.borderRadius || '0');
    
    const tracePath = () => {
      ctx.beginPath();
      if (radius > 0) {
        ctx.roundRect(0, 0, node.width, node.height, radius);
      } else {
        ctx.rect(0, 0, node.width, node.height);
      }
    };

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
      tracePath();
      ctx.fill();
    }

    // ── Media Rendering (Image/Video) ──
    if (node.type === NodeType.IMAGE || node.type === NodeType.VIDEO) {
      const srcDec = node.decorators.find(d => d.type === 'source');
      const assetId = srcDec?.config.assetId;
      const assetUrl = assetId ? resolveAsset?.(assetId) : null;
      const url = assetUrl || srcDec?.config.url;
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

        ctx.save();
        tracePath();
        ctx.clip();
        
        if (media instanceof HTMLImageElement && media.complete) {
          ctx.drawImage(media, 0, 0, node.width, node.height);
        } else if (media instanceof HTMLVideoElement && media.readyState >= 2) {
          ctx.drawImage(media, 0, 0, node.width, node.height);
        }
        ctx.restore();
      } else if (assetId) {
        this.drawMissingAssetPlaceholder(node.width, node.height, srcDec?.config.fileName || 'Private photo');
      }
    }

    // ── Text Rendering ──
    if (node.type === NodeType.TEXT && node.content) {
      ctx.fillStyle = attr.color || '#000000';
      const family = attr.fontFamily || 'Inter, Arial';
      const fontSize = attr.fontSize || 16;
      ctx.font = `${attr.fontWeight || 'normal'} ${fontSize}px ${family}`;
      
      const textAlign = attr.textAlign || (node.attributes.inheritedTextAlign);
      const verticalAlign = attr.verticalAlign || (node.attributes.inheritedVerticalAlign);
      
      const maxWidth = node.width;
      const lineHeight = fontSize * 1.2;
      const words = node.content.split(' ');
      const lines: string[] = [];
      let currentLine = '';

      for (let n = 0; n < words.length; n++) {
        const testLine = currentLine + words[n] + ' ';
        const metrics = ctx.measureText(testLine);
        const testWidth = metrics.width;
        if (testWidth > maxWidth && n > 0) {
          lines.push(currentLine.trim());
          currentLine = words[n] + ' ';
        } else {
          currentLine = testLine;
        }
      }
      lines.push(currentLine.trim());

      const totalHeight = lines.length * lineHeight;
      (node as any).measuredHeight = totalHeight;
      
      // Horizontal align
      let tx = 0;
      if (textAlign === 'center') { ctx.textAlign = 'center'; tx = node.width / 2; }
      else if (textAlign === 'right') { ctx.textAlign = 'right'; tx = node.width; }
      else if (textAlign === 'justify') { ctx.textAlign = 'center'; tx = node.width / 2; }
      else ctx.textAlign = 'left';

      // Vertical align start point
      let ty = 0;
      if (verticalAlign === 'middle') { 
        ctx.textBaseline = 'middle'; 
        ty = (node.height - totalHeight) / 2 + (lineHeight / 2); 
      }
      else if (verticalAlign === 'bottom') { 
        ctx.textBaseline = 'bottom'; 
        ty = node.height - totalHeight + lineHeight; 
      }
      else { 
        ctx.textBaseline = 'top'; 
        ty = 0; 
      }

      lines.forEach((line, i) => {
        ctx.fillText(line, tx, ty + (i * lineHeight));
      });
    }

    // ── Children ──
    if (node.children && node.children.length > 0) {
      const needsClip = radius > 0 || attr.overflow === 'hidden';
      if (needsClip) {
        ctx.save();
        tracePath();
        ctx.clip();
      }

      // Propagate alignment to children if set on parent
      node.children.forEach(child => {
        if (attr.textAlign) child.attributes.inheritedTextAlign = attr.textAlign;
        if (attr.verticalAlign) child.attributes.inheritedVerticalAlign = attr.verticalAlign;
        this.renderNode(child, selectedIds, nodeLocks, localPeerId, hoveredNodeId, resolveAsset, onMediaLoad);
      });
      
      if (needsClip) ctx.restore();
    }

    // ── Selection/Hover/Locks Overlays ──
    ctx.shadowColor = 'transparent'; // Reset shadow for overlays
    ctx.filter = 'none';
    ctx.globalAlpha = 1.0;

    const holder = nodeLocks[node.id];
    const isLockedByOther = holder && holder !== localPeerId;
    const isSelected = selectedIds.includes(node.id);
    const isHovered = hoveredNodeId === node.id;
    
    // For auto-height text, use totalHeight for overlays
    const displayHeight = (attr.autoHeight && (node as any).measuredHeight) ? (node as any).measuredHeight : node.height;

    if (isLockedByOther) {
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2 / this.zoom;
      ctx.strokeRect(0, 0, node.width, displayHeight);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(0, -14 / this.zoom, Math.min(node.width, 100), 14 / this.zoom);
      ctx.fillStyle = '#ffffff';
      ctx.font = `${8 / this.zoom}px monospace`;
      ctx.fillText(`🔒 ${holder.substring(0, 6)}`, 2 / this.zoom, -4 / this.zoom);
    } else if (isSelected) {
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 2 / this.zoom;
      ctx.strokeRect(0, 0, node.width, displayHeight);
      this.drawHandles(node.width, displayHeight);
    } else if (isHovered) {
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 1 / this.zoom;
      ctx.setLineDash([4 / this.zoom, 4 / this.zoom]);
      ctx.strokeRect(0, 0, node.width, displayHeight);
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  private drawMissingAssetPlaceholder(width: number, height: number, fileName: string): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(99, 102, 241, 0.12)';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(139, 92, 246, 0.55)';
    ctx.lineWidth = 1 / this.zoom;
    ctx.setLineDash([5 / this.zoom, 4 / this.zoom]);
    ctx.strokeRect(0, 0, width, height);
    ctx.setLineDash([]);
    ctx.fillStyle = '#c4b5fd';
    ctx.font = `600 ${Math.max(10, 12 / this.zoom)}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Photo access required', width / 2, height / 2 - 7 / this.zoom);
    ctx.font = `500 ${Math.max(8, 10 / this.zoom)}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(fileName.slice(0, 32), width / 2, height / 2 + 11 / this.zoom);
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
