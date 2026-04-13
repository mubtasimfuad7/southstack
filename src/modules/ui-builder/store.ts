import { create } from 'zustand';
import { DesignDocument } from './core/DesignDocument';
import { DesignNode, Decorator, DecoratorTypes } from './core/DesignNode';
import { NodeType } from './core/NodeTypes';

interface UIBuilderState {
  document: DesignDocument;
  selectedNodeIds: string[];
  hoveredNodeId: string | null;
  viewport: { zoom: number, scrollX: number, scrollY: number };
  
  setDocument: (doc: DesignDocument) => void;
  selectNodes: (ids: string[], multiple?: boolean) => void;
  setHoveredNode: (id: string | null) => void;
  setViewport: (patch: any) => void;
  
  // Pattern-based actions
  updateNode: (id: string, patch: Partial<DesignNode>) => void;
  addDecorator: (nodeId: string, decorator: Decorator) => void;
  updateDecorator: (nodeId: string, decoratorId: string, config: any) => void;
}

const initialDoc: DesignDocument = {
  id: 'composite-doc',
  name: 'Pattern-based Design',
  pages: [{
    id: 'p1', name: 'Page 1',
    nodes: [
      {
        id: 'box-1',
        name: 'Main Container',
        type: NodeType.FRAME,
        x: 100, y: 100, width: 400, height: 300,
        decorators: [
          { id: 'd1', type: 'background', config: { color: {r:255,g:255,b:255,a:1} }, enabled: true },
          { id: 'd2', type: 'border', config: { radius: 20, color: {r:0,g:0,b:0,a:0.1}, weight: 1 }, enabled: true }
        ],
        children: [
          {
            id: 'text-container',
            name: 'Heading Wrap',
            type: NodeType.TEXT,
            x: 40, y: 40, width: 320, height: 50,
            decorators: [
              { id: 'd3', type: 'text-style', config: { fontSize: 24, fontWeight: 'bold', color: {r:59,g:130,b:246,a:1}, align: 'CENTER' }, enabled: true }
            ],
            content: 'Hello Patterns',
            children: []
          }
        ]
      }
    ]
  }]
};

export const useUIBuilderStore = create<UIBuilderState>((set, get) => ({
  document: initialDoc,
  selectedNodeIds: [],
  hoveredNodeId: null,
  viewport: { zoom: 1, scrollX: 0, scrollY: 0 },

  setDocument: (document) => set({ document }),
  setViewport: (patch) => set((state) => ({ viewport: { ...state.viewport, ...patch } })),
  selectNodes: (ids, multiple = false) => {
    if (multiple) {
      const next = new Set(get().selectedNodeIds);
      ids.forEach(id => next.has(id) ? next.delete(id) : next.add(id));
      set({ selectedNodeIds: Array.from(next) });
    } else set({ selectedNodeIds: ids });
  },
  setHoveredNode: (id) => set({ hoveredNodeId: id }),

  updateNode: (id, patch) => {
    const doc = JSON.parse(JSON.stringify(get().document));
    const findAndUpdate = (nodes: DesignNode[]): boolean => {
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].id === id) {
          nodes[i] = { ...nodes[i], ...patch };
          return true;
        }
        if (nodes[i].children && findAndUpdate(nodes[i].children)) return true;
      }
      return false;
    };
    findAndUpdate(doc.pages[0].nodes);
    set({ document: doc });
  },

  addDecorator: (nodeId, decorator) => {
    const doc = JSON.parse(JSON.stringify(get().document));
    const findAndAdd = (nodes: DesignNode[]): boolean => {
      for (const node of nodes) {
        if (node.id === nodeId) {
          node.decorators.push(decorator);
          return true;
        }
        if (node.children && findAndAdd(node.children)) return true;
      }
      return false;
    };
    findAndAdd(doc.pages[0].nodes);
    set({ document: doc });
  },

  updateDecorator: (nodeId, decoratorId, config) => {
    const doc = JSON.parse(JSON.stringify(get().document));
    const findAndUpdateDec = (nodes: DesignNode[]): boolean => {
      for (const node of nodes) {
        if (node.id === nodeId) {
          const dec = node.decorators.find(d => d.id === decoratorId);
          if (dec) {
            dec.config = { ...dec.config, ...config };
            return true;
          }
        }
        if (node.children && findAndUpdateDec(node.children)) return true;
      }
      return false;
    };
    findAndUpdateDec(doc.pages[0].nodes);
    set({ document: doc });
  }
}));
