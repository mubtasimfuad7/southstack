import { EditorAPI } from '../core/EditorAPI';
import { useUIBuilderStore } from '../store';
import { NodeFactory } from '../core/NodeFactory';
import { NodeType } from '../core/NodeTypes';

// Define the schema for the tools the LLM can use
export interface AITool {
  name: string;
  description: string;
  parameters: any;
  execute: (args: any) => Promise<any> | any;
}

export const uiBuilderTools: AITool[] = [
  {
    name: 'create_element',
    description: 'Creates a new element and adds it to the canvas. Always provide reasonable initial x, y, width, and height. For nested creation in one batch, assign a tempId to newly created parents and use parentRef from later actions.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: Object.values(NodeType), description: 'The type of node, like FRAME, TEXT, RECTANGLE, IMAGE' },
        name: { type: 'string', description: 'A semantic name for the element, e.g. "Submit Button"' },
        tempId: { type: 'string', description: 'Optional temporary reference label for this new node so later actions in the same batch can refer to it.' },
        parentId: { type: 'string', description: 'Optional: ID of the parent element to add this to.' },
        parentRef: { type: 'string', description: 'Optional temporary reference label that points to a node created earlier in the same batch.' },
        content: { type: 'string', description: 'Optional: text content if type is TEXT' },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        bgColor: { type: 'string', description: 'Optional: Background color in hex, e.g. #FF0000' },
        textColor: { type: 'string', description: 'Optional: Text color if type is TEXT' },
        src: { type: 'string', description: 'Optional: url for IMAGE or VIDEO type' }
      },
      required: ['type', 'name', 'x', 'y', 'width', 'height']
    },
    execute: (args) => {
      let node: any;
      const id = NodeFactory.makeId();
      
      switch(args.type) {
        case NodeType.TEXT: node = NodeFactory.createText(id, args.name, args.content || 'Text'); break;
        case NodeType.RECTANGLE: node = NodeFactory.createRect(id, args.name); break;
        case NodeType.IMAGE: node = NodeFactory.createImage(id, args.name, args.src || 'https://via.placeholder.com/200'); break;
        case NodeType.VIDEO: node = NodeFactory.createVideo(id, args.name, args.src || ''); break;
        case NodeType.GROUP: node = NodeFactory.createGroup(id, args.name); break;
        case NodeType.VECTOR: node = NodeFactory.createVector(id, args.name); break;
        case NodeType.FRAME:
        default: node = NodeFactory.createFrame(id, args.name); break;
      }

      const layout = node.decorators.find((d: any) => d.type === 'layout');
      if (layout) {
        node.x = args.x; layout.config.x = args.x;
        node.y = args.y; layout.config.y = args.y;
        node.width = args.width; layout.config.width = args.width;
        node.height = args.height; layout.config.height = args.height;
      }

      if (args.bgColor) {
        let bg = node.decorators.find((d: any) => d.type === 'background');
        if (!bg && typeof args.bgColor === 'string') {
           bg = { id: `dec-${Date.now()}-bg`, type: 'background', config: { color: args.bgColor }, enabled: true };
           node.decorators.push(bg);
        } else if (bg) {
           bg.config.color = args.bgColor;
        }
      }

      if (args.textColor && args.type === NodeType.TEXT) {
        const tc = node.decorators.find((d: any) => d.type === 'text-color');
        if (tc) tc.config.color = args.textColor;
      }

      if (args.parentId && !useUIBuilderStore.getState().findNode(args.parentId)) {
        throw new Error(`Parent node ${args.parentId} not found. Cannot create element inside it.`);
      }

      EditorAPI.addNode(node, args.parentId);
      
      return { 
        success: true, 
        message: `Created ${args.type} element '${args.name}' with id ${id}`,
        id: id
      };
    }
  },
  {
    name: 'update_style',
    description: 'Modifies the styling of a specific element decorator (background, text-color, etc).',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'The exact ID of the node to update.' },
        nodeRef: { type: 'string', description: 'Optional temporary reference label that points to a node created earlier in the same batch.' },
        decoratorType: { type: 'string', enum: ['background', 'text-color', 'style', 'text-align', 'source', 'text'], description: 'The type of styling or text update to apply' },
        configValues: { type: 'object', description: 'A JSON object containing the values to update.' }
      },
      required: ['decoratorType', 'configValues']
    },
    execute: ({ nodeId, decoratorType, configValues }) => {
      const state = useUIBuilderStore.getState();
      const node = state.findNode(nodeId);
      if (!node) throw new Error(`Node ${nodeId} not found.`);

      // Text content is stored directly on the node, not as a decorator.
      if (
        node.type === NodeType.TEXT &&
        (decoratorType === 'text' || typeof configValues?.content === 'string')
      ) {
        EditorAPI.updateNode(nodeId, {
          content: configValues.content ?? node.content
        });
        return { success: true, message: `Updated text content on node ${nodeId}` };
      }

      const decorator = node.decorators.find((d: any) => d.type === decoratorType);
      
      if (!decorator) {
         const newId = `dec-${Date.now()}-${decoratorType}`;
         EditorAPI.addDecorator(nodeId, {
           id: newId,
           type: decoratorType,
           config: configValues,
           enabled: true
         });
         return { success: true, message: `Added new ${decoratorType} decorator to node ${nodeId}` };
      }

      EditorAPI.updateDecorator(nodeId, decorator.id, configValues);
      return { success: true, message: `Updated ${decoratorType} decorator on node ${nodeId}` };
    }
  },
  {
    name: 'update_layout',
    description: 'Modifies the position or size of an element.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'The ID of the node to update' },
        nodeRef: { type: 'string', description: 'Optional temporary reference label that points to a node created earlier in the same batch.' },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' }
      },
      required: []
    },
    execute: (args) => {
      const state = useUIBuilderStore.getState();
      const node = state.findNode(args.nodeId);
      if (!node) throw new Error(`Node ${args.nodeId} not found.`);

      const patch: any = {};
      if (args.x !== undefined) patch.x = args.x;
      if (args.y !== undefined) patch.y = args.y;
      if (args.width !== undefined) patch.width = args.width;
      if (args.height !== undefined) patch.height = args.height;

      EditorAPI.updateNode(args.nodeId, patch);
      return { success: true, message: `Updated layout for node ${args.nodeId}` };
    }
  },
  {
    name: 'delete_element',
    description: 'Deletes an element from the canvas.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'The ID of the node to delete' },
        nodeRef: { type: 'string', description: 'Optional temporary reference label that points to a node created earlier in the same batch.' },
      },
      required: []
    },
    execute: ({ nodeId }) => {
      const state = useUIBuilderStore.getState();
      const node = state.findNode(nodeId);
      if (!node) throw new Error(`Node ${nodeId} not found.`);

      EditorAPI.deleteNode(nodeId);
      return { success: true, message: `Deleted node ${nodeId}` };
    }
  }
];
