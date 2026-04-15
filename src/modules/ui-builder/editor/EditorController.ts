import { DesignDocument, Page } from '../core/DesignDocument';
import { SelectionManager } from './SelectionManager';
import { DesignNode } from '../core/DesignNode';

export class EditorController {
  private document: DesignDocument;
  private selectionManager: SelectionManager;

  constructor(document: DesignDocument) {
    this.document = document;
    this.selectionManager = new SelectionManager();
  }

  getDocument(): DesignDocument {
    return this.document;
  }

  getSelection(): SelectionManager {
    return this.selectionManager;
  }

  moveNode(id: string, dx: number, dy: number): void {
    const node = this.findNode(id);
    if (node) {
      node.x += dx;
      node.y += dy;
    }
  }

  resizeNode(id: string, width: number, height: number): void {
    const node = this.findNode(id);
    if (node) {
      node.width = width;
      node.height = height;
    }
  }

  deleteNode(id: string): void {
    const pages = this.document.layouts?.[0]?.pages ?? [];
    for (const page of pages) {
      const index = page.nodes.findIndex(n => n.id === id);
      if (index !== -1) {
        page.nodes.splice(index, 1);
        this.selectionManager.deselect(id);
        return;
      }
      if (this.deleteFromChildren(page.nodes, id)) {
        this.selectionManager.deselect(id);
        return;
      }
    }
  }

  private deleteFromChildren(nodes: DesignNode[], id: string): boolean {
    for (const node of nodes) {
      if (node.children) {
        const index = node.children.findIndex(n => n.id === id);
        if (index !== -1) {
          node.children.splice(index, 1);
          return true;
        }
        if (this.deleteFromChildren(node.children, id)) {
          return true;
        }
      }
    }
    return false;
  }

  private findNode(id: string): DesignNode | null {
    const pages = this.document.layouts?.[0]?.pages ?? [];
    for (const page of pages) {
      const found = this.findInNodes(page.nodes, id);
      if (found) return found;
    }
    return null;
  }

  private findInNodes(nodes: DesignNode[], id: string): DesignNode | null {
    for (const node of nodes) {
      if (node.id === id) return node;
      if (node.children) {
        const found = this.findInNodes(node.children, id);
        if (found) return found;
      }
    }
    return null;
  }
}
