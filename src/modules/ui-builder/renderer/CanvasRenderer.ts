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

  render(document: DesignDocument, canvas: HTMLCanvasElement, selectedIds: string[], viewport: any): void {
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

    document.pages[0].nodes.forEach(node => {
      // 1. Run the Decorator Pipeline before rendering
      NodeFactory.computeStyles(node);
      
      // 2. Render the computed node
      this.renderNode(node, selectedIds);
    });
    
    ctx.restore();
  }

  private renderNode(node: DesignNode, selectedIds: string[]): void {
    if (!this.ctx) return;
    this.ctx.save();
    this.ctx.translate(node.x, node.y);

    const attr = node.attributes;

    // Apply "CSS" Background
    if (attr.backgroundColor) {
      this.ctx.fillStyle = attr.backgroundColor;
      this.ctx.fillRect(0, 0, node.width, node.height);
    }

    // Render Text Content with "CSS" Styles
    if (node.type === NodeType.TEXT && node.content) {
      this.ctx.fillStyle = attr.color || '#000000';
      this.ctx.font = `${attr.fontWeight || 'normal'} ${attr.fontSize || 16}px Arial`;
      this.ctx.textBaseline = 'top';
      
      let x = 0;
      if (attr.textAlign === 'center') {
        this.ctx.textAlign = 'center';
        x = node.width / 2;
      } else if (attr.textAlign === 'right') {
        this.ctx.textAlign = 'right';
        x = node.width;
      } else {
        this.ctx.textAlign = 'left';
      }

      this.ctx.fillText(node.content, x, 0);
    }

    // Composite Pattern: Render children
    if (node.children) {
      node.children.forEach(child => this.renderNode(child, selectedIds));
    }

    // Highlight
    if (selectedIds.includes(node.id)) {
      this.ctx.strokeStyle = '#3b82f6';
      this.ctx.lineWidth = 2 / this.zoom;
      this.ctx.strokeRect(0, 0, node.width, node.height);
    }

    this.ctx.restore();
  }
}
