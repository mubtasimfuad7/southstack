import { NodeType } from './NodeTypes';
import { DesignNode } from './DesignNode';
import { BackgroundDecorator } from './decorators/BackgroundDecorator';
import { TextColorDecorator, TextAlignDecorator } from './decorators/TextDecorators';

export class NodeFactory {
  static createFrame(id: string, name: string): DesignNode {
    return {
      id,
      name,
      type: NodeType.FRAME,
      x: 0, y: 0, width: 100, height: 100,
      decorators: [
        new BackgroundDecorator('#ffffff')
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
      decorators: [
        new TextColorDecorator('#000000'),
        new TextAlignDecorator('left')
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
    node.decorators.forEach(dec => dec.decorate(node, node.attributes));
    
    // Recursively compute for children
    node.children.forEach(child => this.computeStyles(child));
  }
}
