import { NodeType } from './NodeTypes';
import { DesignNode } from './DesignNode';
import { DecoratorRegistry } from './DecoratorRegistry';

export class NodeFactory {
  static createFrame(id: string, name: string): DesignNode {
    return {
      id,
      name,
      type: NodeType.FRAME,
      x: 0, y: 0, width: 100, height: 100,
      rotation: 0,
      decorators: [
        { id: `dec-${Date.now()}-1`, type: 'background', config: { color: '#ffffff' }, enabled: true },
        { id: `dec-${Date.now()}-2`, type: 'layout', config: { x: 0, y: 0, width: 100, height: 100 }, enabled: true }
      ],
      children: [],
      attributes: {}
    };
  }

  static createText(id: string, name: string, content: string): DesignNode {
    return {
      id,
      name,
      type: NodeType.TEXT,
      x: 0, y: 0, width: 200, height: 50,
      rotation: 0,
      decorators: [
        { id: `dec-${Date.now()}-3`, type: 'text-color', config: { color: '#000000' }, enabled: true },
        { id: `dec-${Date.now()}-4`, type: 'text-align', config: { align: 'left' }, enabled: true },
        { id: `dec-${Date.now()}-5`, type: 'layout', config: { x: 0, y: 0, width: 200, height: 50 }, enabled: true }
      ],
      content,
      children: [],
      attributes: {}
    };
  }

  /**
   * Pipeline logic: Runs all decorators to populate the final attribute bag.
   */
  static computeStyles(node: DesignNode): void {
    node.attributes = {}; // Clear
    
    node.decorators.forEach(decState => {
      if (!decState.enabled) return;
      const decorator = DecoratorRegistry.get(decState.type);
      if (decorator) {
        decorator.decorate(node, decState.config, node.attributes);
      }
    });
    
    // Recursively compute for children
    node.children.forEach(child => NodeFactory.computeStyles(child));
  }
}
