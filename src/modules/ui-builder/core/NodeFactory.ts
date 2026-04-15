import { NodeType } from './NodeTypes';
import { DesignNode } from './DesignNode';
import { DecoratorRegistry } from './DecoratorRegistry';

export class NodeFactory {
  static makeId() { return `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }

  static createFrame(id: string, name: string): DesignNode {
    return {
      id,
      name,
      type: NodeType.FRAME,
      x: 0, y: 0, width: 100, height: 100,
      rotation: 0,
      decorators: [
        { id: `dec-${Date.now()}-1`, type: 'background', config: { color: '#ffffff' }, enabled: true },
        { id: `dec-${Date.now()}-2`, type: 'layout', config: { x: 0, y: 0, width: 100, height: 100 }, enabled: true },
        { id: `dec-${Date.now()}-3`, type: 'style', config: { opacity: 100 }, enabled: true }
      ],
      children: [],
      attributes: {}
    };
  }

  static createText(id: string, name: string, content: string): DesignNode {
    return {
      id, name,
      type: NodeType.TEXT,
      x: 0, y: 0, width: 200, height: 50,
      rotation: 0,
      decorators: [
        { id: `dec-${Date.now()}-3`, type: 'text-color', config: { color: '#000000' }, enabled: true },
        { id: `dec-${Date.now()}-4`, type: 'text-align', config: { align: 'left', verticalAlign: 'top' }, enabled: true },
        { id: `dec-${Date.now()}-5`, type: 'layout', config: { x: 0, y: 0, width: 200, height: 50 }, enabled: true },
        { id: `dec-${Date.now()}-6`, type: 'style', config: { opacity: 100 }, enabled: true }
      ],
      content,
      children: [],
      attributes: {}
    };
  }

  static createRect(id: string, name: string): DesignNode {
    return {
      id, name,
      type: NodeType.RECTANGLE,
      x: 0, y: 0, width: 120, height: 80,
      rotation: 0,
      decorators: [
        { id: `dec-${Date.now()}-r1`, type: 'background', config: { color: '#6366f1' }, enabled: true },
        { id: `dec-${Date.now()}-r2`, type: 'layout', config: { x: 0, y: 0, width: 120, height: 80 }, enabled: true },
        { id: `dec-${Date.now()}-r3`, type: 'style', config: { opacity: 100 }, enabled: true }
      ],
      children: [],
      attributes: {}
    };
  }

  static createGroup(id: string, name: string): DesignNode {
    return {
      id, name,
      type: NodeType.GROUP,
      x: 0, y: 0, width: 200, height: 200,
      rotation: 0,
      decorators: [],
      children: [],
      attributes: {}
    };
  }

  static createVector(id: string, name: string): DesignNode {
    return {
      id, name,
      type: NodeType.VECTOR,
      x: 0, y: 0, width: 100, height: 100,
      rotation: 0,
      decorators: [
        { id: `dec-${Date.now()}-v1`, type: 'background', config: { color: '#8b5cf6' }, enabled: true },
        { id: `dec-${Date.now()}-v2`, type: 'layout', config: { x: 0, y: 0, width: 100, height: 100 }, enabled: true },
        { id: `dec-${Date.now()}-v3`, type: 'style', config: { opacity: 100 }, enabled: true }
      ],
      children: [],
      attributes: {}
    };
  }

  static createImage(id: string, name: string, src: string): DesignNode {
    return {
      id, name, type: NodeType.IMAGE, x: 0, y: 0, width: 200, height: 150, rotation: 0,
      decorators: [
        { id: `${id}-ly`, type: 'layout', config: { x: 0, y: 0, width: 200, height: 150 }, enabled: true },
        { id: `${id}-src`, type: 'source', config: { url: src }, enabled: true },
        { id: `${id}-st`, type: 'style', config: { opacity: 100 }, enabled: true }
      ],
      children: [], attributes: { opacity: 1 }
    };
  }

  static createVideo(id: string, name: string, src: string): DesignNode {
    return {
      id, name, type: NodeType.VIDEO, x: 0, y: 0, width: 320, height: 180, rotation: 0,
      decorators: [
        { id: `${id}-ly`, type: 'layout', config: { x: 0, y: 0, width: 320, height: 180 }, enabled: true },
        { id: `${id}-src`, type: 'source', config: { url: src, loop: true }, enabled: true },
        { id: `${id}-st`, type: 'style', config: { opacity: 100 }, enabled: true }
      ],
      children: [], attributes: { opacity: 1 }
    };
  }

  /**
   * Pipeline logic: Runs all decorators to populate the final attribute bag.
   */
  static computeStyles(node: DesignNode, parent?: DesignNode): void {
    node.attributes = {}; // Clear
    
    node.decorators.forEach(decState => {
      if (!decState.enabled) return;
      const decorator = DecoratorRegistry.get(decState.type);
      if (decorator) {
        decorator.decorate(node, decState.config, node.attributes, parent);
      }
    });
    
    // Recursively compute for children
    node.children.forEach(child => NodeFactory.computeStyles(child, node));
  }
}
