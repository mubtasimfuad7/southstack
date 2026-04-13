import { create } from 'zustand';
import { DesignDocument } from './core/DesignDocument';
import { DesignNode, DecoratorState } from './core/DesignNode';
import { NodeType } from './core/NodeTypes';

interface UIBuilderState {
  document: DesignDocument;
  selectedNodeIds: string[];
  hoveredNodeId: string | null;
  viewport: { zoom: number, scrollX: number, scrollY: number };
  peerStates?: any;
  
  // Collaboration State
  hostPeerId: string | null;
  hasEditAccess: boolean;
  localBackupDocument: DesignDocument | null;
  nodeLocks: Record<string, string>; // nodeId -> lockedByPeerId
  allowedPeers: string[];
  pendingEditRequests: string[];

  setDocument: (doc: DesignDocument) => void;
  selectNodes: (ids: string[], multiple?: boolean) => void;
  setHoveredNode: (id: string | null) => void;
  setViewport: (patch: any) => void;
  
  // Collaboration Actions
  joinSession: (peerId: string | null, isHost: boolean) => void;
  setEditAccess: (hasAccess: boolean) => void;
  setNodeLock: (nodeId: string, lockedByPeerId: string | null) => void;
  addEditRequest: (peerId: string) => void;
  resolveEditRequest: (peerId: string, allowed: boolean) => void;
  
  // Pattern-based actions
  updateNode: (id: string, patch: Partial<DesignNode>) => void;
  addNode: (node: DesignNode, parentId?: string) => void;
  deleteNode: (nodeId: string) => void;
  addDecorator: (nodeId: string, decorator: DecoratorState) => void;
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
        rotation: 0,
        attributes: {},
        decorators: [
          { id: 'd1', type: 'background', config: { color: '#ffffff' }, enabled: true },
          { id: 'd2', type: 'layout', config: { x: 100, y: 100, width: 400, height: 300 }, enabled: true }
        ],
        children: [
          {
            id: 'text-container',
            name: 'Heading Wrap',
            type: NodeType.TEXT,
            x: 40, y: 40, width: 320, height: 50,
            rotation: 0,
            attributes: {},
            content: 'Hello Patterns',
            decorators: [
              { id: 'd3', type: 'text-align', config: { align: 'center' }, enabled: true },
              { id: 'd4', type: 'text-color', config: { color: '#3b82f6' }, enabled: true }
            ],
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
  
  // Collaboration Init
  hostPeerId: null,
  hasEditAccess: true, // true by default when working locally
  localBackupDocument: null,
  nodeLocks: {},
  allowedPeers: [],
  pendingEditRequests: [],

  setDocument: (document) => set({ document }),
  setViewport: (patch) => set((state) => ({ viewport: { ...state.viewport, ...patch } })),
  
  // Collaboration Implementations
  joinSession: (peerId, isHost) => set(state => {
    let nextDoc = state.document;
    let nextBackup = state.localBackupDocument;

    if (peerId !== null && state.hostPeerId === null) {
      // Joining a session: back up local doc
      nextBackup = state.document;
    } else if (peerId === null && state.hostPeerId !== null) {
      // Leaving a session: restore local doc
      if (state.localBackupDocument) {
        nextDoc = state.localBackupDocument;
      }
      nextBackup = null;
    }

    return { 
      hostPeerId: peerId, 
      hasEditAccess: isHost, 
      document: nextDoc,
      localBackupDocument: nextBackup,
      selectedNodeIds: [],
      nodeLocks: {},
      allowedPeers: [],
      pendingEditRequests: []
    };
  }),
  setEditAccess: (hasAccess) => set({ hasEditAccess: hasAccess }),
  setNodeLock: (nodeId, lockedByPeerId) => set(state => {
    const nextLocks = { ...state.nodeLocks };
    if (lockedByPeerId) nextLocks[nodeId] = lockedByPeerId;
    else delete nextLocks[nodeId];
    return { nodeLocks: nextLocks };
  }),
  addEditRequest: (peerId) => set(state => ({
    pendingEditRequests: state.pendingEditRequests.includes(peerId) 
      ? state.pendingEditRequests 
      : [...state.pendingEditRequests, peerId]
  })),
  resolveEditRequest: (peerId, allowed) => set(state => ({
    pendingEditRequests: state.pendingEditRequests.filter(id => id !== peerId),
    allowedPeers: allowed && !state.allowedPeers.includes(peerId) 
      ? [...state.allowedPeers, peerId] 
      : state.allowedPeers
  })),

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

  addNode: (node, parentId) => {
    // stub to fix TS error, full implementation out of scope for now
  },
  
  deleteNode: (nodeId) => {
    // stub to fix TS error, full implementation out of scope for now
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
