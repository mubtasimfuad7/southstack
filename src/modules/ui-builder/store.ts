import { create } from 'zustand';
import { DesignDocument } from './core/DesignDocument';
import { NodeFactory } from './core/NodeFactory';
import { NodeType } from './core/NodeTypes';

interface UIBuilderState {
  document: DesignDocument;
  selectedNodeIds: string[];
  hoveredNodeId: string | null;
  viewport: { x: number; y: number; zoom: number; scrollX: number; scrollY: number };
  activeLayoutId: string;
  activePageId: string;
  activeTool: string;
  hostPeerId: string | null;
  hasEditAccess: boolean;
  pendingEditRequests: string[];
  peerStates: Record<string, any>;
  nodeLocks: Record<string, string>;

  setDocument: (doc: DesignDocument) => void;
  selectNodes: (ids: string[], multiple?: boolean) => void;
  setHoveredNode: (id: string | null) => void;
  setViewport: (patch: any) => void;
  setActiveNavigation: (layoutId: string, pageId: string) => void;
  setActiveTool: (tool: string) => void;
  addNode: (node: any, parentId?: string | null) => void;
  updateNode: (id: string, patch: any) => void;
  updateDecorator: (nodeId: string, decoratorId: string, patch: any) => void;
  deleteNode: (id: string) => void;
  findNode: (id: string) => any | null;
  addPage: (name: string) => void;
  groupNodes: (ids: string[]) => void;
  ungroupNode: (id: string) => void;
  reorderNode: (id: string, dir: 'up' | 'down') => void;
  moveNodeToGroup: (nodeId: string, targetId: string | null) => void;
  setNodeLock: (nodeId: string, peerId: string | null) => void;
  setEditAccess: (access: boolean) => void;
  addEditRequest: (peerId: string) => void;
  
  // Helpers
  getAbsoluteTransform: (id: string) => { x: number; y: number; rotation: number };
  getParentNode: (id: string) => any | null;
  findParentAt: (x: number, y: number, excludedIds: string[]) => any | null;
}

// Helper to correctly initialize node and its layout decorator
const setupNode = (node: any, props: { x?: number, y?: number, w?: number, h?: number, bg?: string, color?: string }) => {
  const layout = node.decorators.find((d: any) => d.type === 'layout');
  if (layout) {
    if (props.x !== undefined) { node.x = props.x; layout.config.x = props.x; }
    if (props.y !== undefined) { node.y = props.y; layout.config.y = props.y; }
    if (props.w !== undefined) { node.width = props.w; layout.config.width = props.w; }
    if (props.h !== undefined) { node.height = props.h; layout.config.height = props.h; }
  }
  if (props.bg) {
    const bg = node.decorators.find((d: any) => d.type === 'background');
    if (bg) bg.config.color = props.bg;
  }
  if (props.color) {
    const tc = node.decorators.find((d: any) => d.type === 'text-color');
    if (tc) tc.config.color = props.color;
  }
  return node;
};

// ─── Preset: Professional Food Delivery App ───────────────────────────────────
const createFoodDeliveryPreset = (): DesignDocument => {
  const doc: DesignDocument = {
    id: 'food-app-1',
    name: 'Foodie Pro',
    layouts: [{
      id: 'l1',
      name: 'Mobile App',
      pages: [
        { id: 'p1', name: 'Home Screen', nodes: [] },
        { id: 'p2', name: 'Discovery', nodes: [] },
        { id: 'p3', name: 'Checkout', nodes: [] }
      ]
    }]
  };

  const page1 = doc.layouts[0].pages[0];
  
  // 1. App Shell (iPhone 14)
  const appShell = setupNode(NodeFactory.createFrame('shell-1', 'Home Screen'), {
    x: 400, y: 50, w: 390, h: 844, bg: '#F8FAFC'
  });

  // 2. Header Section
  const header = setupNode(NodeFactory.createFrame('h-1', 'Header Container'), {
    x: 20, y: 20, w: 350, h: 60, bg: 'transparent'
  });
  
  header.children.push(setupNode(NodeFactory.createText('lt-1', 'Deliver To', 'Deliver to'), {
    x: 0, y: 5, w: 100, color: '#94A3B8'
  }));

  header.children.push(setupNode(NodeFactory.createText('lv-1', 'Address', 'Current Location ↓'), {
    x: 0, y: 25, w: 250, color: '#1E293B'
  }));

  const profile = setupNode(NodeFactory.createImage('pr-1', 'Profile Avatar', 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=40&q=80'), {
    x: 310, y: 5, w: 40, h: 40
  });
  profile.decorators.push({ id: 'pr-style', type: 'style', config: { shadowEnabled: true, shadow: { x: 0, y: 4, blur: 10, color: 'rgba(0,0,0,0.1)' } }, enabled: true });
  header.children.push(profile);
  appShell.children.push(header);

  // 3. Search Bar
  const searchBar = setupNode(NodeFactory.createFrame('sb-1', 'Search Box'), {
    x: 20, y: 100, w: 350, h: 50, bg: '#FFFFFF'
  });
  searchBar.decorators.push({ id: 'sb-style', type: 'style', config: { shadowEnabled: true, shadow: { x: 0, y: 4, blur: 16, color: 'rgba(0,0,0,0.04)' } }, enabled: true });
  
  searchBar.children.push(setupNode(NodeFactory.createText('sh-1', 'Search Hint', 'Search for burgers, pizza...'), {
    x: 45, y: 15, w: 280, color: '#94A3B8'
  }));
  appShell.children.push(searchBar);

  // 4. Promo Banner
  const banner = setupNode(NodeFactory.createFrame('bn-1', 'Promo Section'), {
    x: 20, y: 170, w: 350, h: 160
  });
  banner.decorators.push({ id: 'bn-style', type: 'style', config: { shadowEnabled: true, shadow: { x: 0, y: 12, blur: 24, color: 'rgba(234, 88, 12, 0.15)' } }, enabled: true });
  
  banner.children.push(setupNode(NodeFactory.createImage('bn-img', 'Hero', 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=350&q=80'), {
    x: 0, y: 0, w: 350, h: 160
  }));
  appShell.children.push(banner);

  // 5. Categories Grid
  appShell.children.push(setupNode(NodeFactory.createText('cl-1', 'Label', 'Categories'), {
    x: 20, y: 355, w: 200, color: '#1E293B'
  }));

  const cats = [
    { name: 'Pizza', img: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=70&q=80' },
    { name: 'Burger', img: 'https://images.unsplash.com/photo-1571091718767-18b5b1457add?auto=format&fit=crop&w=70&q=80' },
    { name: 'Sushi', img: 'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?auto=format&fit=crop&w=70&q=80' },
    { name: 'Pasta', img: 'https://images.unsplash.com/photo-1551183053-bf91a1d81141?auto=format&fit=crop&w=70&q=80' }
  ];

  cats.forEach((cat, i) => {
    const card = setupNode(NodeFactory.createFrame(`cat-${i}`, cat.name), {
      x: 20 + i * 88, y: 385, w: 78, h: 100, bg: '#FFFFFF'
    });
    card.decorators.push({ id: `c-sh-${i}`, type: 'style', config: { shadowEnabled: true, shadow: { x: 0, y: 4, blur: 8, color: 'rgba(0,0,0,0.03)' } }, enabled: true });
    
    card.children.push(setupNode(NodeFactory.createImage(`ci-${i}`, 'Img', cat.img), {
      x: 9, y: 10, w: 60, h: 60
    }));
    card.children.push(setupNode(NodeFactory.createText(`ct-${i}`, 'Name', cat.name), {
      x: 0, y: 75, w: 78, color: '#475569'
    }));
    appShell.children.push(card);
  });

  // 6. Popular Restaurants
  appShell.children.push(setupNode(NodeFactory.createText('pl-1', 'Label', 'Popular Nearby'), {
    x: 20, y: 510, w: 200, color: '#1E293B'
  }));

  const restaurants = [
    { name: 'The Steakhouse', img: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=400&q=80', info: '4.8 ★  •  Steakhouse  •  25 min' },
    { name: 'Healthy Garden', img: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=400&q=80', info: '4.5 ★  •  Fast Food  •  15 min' }
  ];

  restaurants.forEach((r, i) => {
    const card = setupNode(NodeFactory.createFrame(`rst-${i}`, r.name), {
      x: 20, y: 545 + i * 130, w: 350, h: 110, bg: '#FFFFFF'
    });
    card.decorators.push({ id: `rs-sh-${i}`, type: 'style', config: { shadowEnabled: true, shadow: { x: 0, y: 8, blur: 20, color: 'rgba(0,0,0,0.05)' } }, enabled: true });
    
    card.children.push(setupNode(NodeFactory.createImage(`ri-${i}`, 'Img', r.img), {
      x: 10, y: 10, w: 90, h: 90
    }));
    card.children.push(setupNode(NodeFactory.createText(`rn-${i}`, 'Name', r.name), {
      x: 110, y: 20, w: 200, color: '#1E293B'
    }));
    card.children.push(setupNode(NodeFactory.createText(`rf-${i}`, 'Info', r.info), {
      x: 110, y: 45, w: 200, color: '#64748B'
    }));
    appShell.children.push(card);
  });

  // 7. Navigation
  const nav = setupNode(NodeFactory.createFrame('nav-1', 'Tab Bar'), {
    x: 0, y: 774, w: 390, h: 70, bg: '#FFFFFF'
  });
  nav.decorators.push({ id: 'nav-sh', type: 'style', config: { shadowEnabled: true, shadow: { x: 0, y: -4, blur: 12, color: 'rgba(0,0,0,0.05)' } }, enabled: true });
  ['🏠', '🔍', '🛒', '👤'].forEach((icon, i) => {
    nav.children.push(setupNode(NodeFactory.createText(`nb-${i}`, icon, icon), {
      x: i * 97.5, y: 25, w: 97.5
    }));
  });
  appShell.children.push(nav);

  page1.nodes.push(appShell);

  return doc;
};

export const useUIBuilderStore = create<UIBuilderState>((set, get) => ({
  document: createFoodDeliveryPreset(),
  selectedNodeIds: [],
  hoveredNodeId: null,
  viewport: { x: 0, y: 0, zoom: 0.8, scrollX: 0, scrollY: 0 },
  activeLayoutId: 'l1',
  activePageId: 'p1',
  activeTool: 'select',
  hostPeerId: null,
  hasEditAccess: true,
  pendingEditRequests: [],
  peerStates: {},
  nodeLocks: {},

  setDocument: (document) => {
    // Recompute styles whenever a new document is set
    document.layouts.forEach(l => l.pages.forEach(p => p.nodes.forEach(n => NodeFactory.computeStyles(n))));
    set({ document });
  },

  setViewport: (patch) => set((state) => ({ viewport: { ...state.viewport, ...patch } })),
  setActiveNavigation: (activeLayoutId, activePageId) => set({ activeLayoutId, activePageId, selectedNodeIds: [] }),
  setActiveTool: (activeTool) => set({ activeTool }),
  setHoveredNode: (hoveredNodeId) => set({ hoveredNodeId }),
  
  setNodeLock: (nodeId, peerId) => set((state) => {
    const locks = { ...state.nodeLocks };
    if (peerId) locks[nodeId] = peerId;
    else delete locks[nodeId];
    return { nodeLocks: locks };
  }),
  setEditAccess: (hasEditAccess) => set({ hasEditAccess }),
  addEditRequest: (peerId) => set((state) => ({ 
    pendingEditRequests: state.pendingEditRequests.includes(peerId) ? state.pendingEditRequests : [...state.pendingEditRequests, peerId] 
  })),

  addNode: (node, parentId) => set((state) => {
    const doc = { ...state.document };
    const layout = doc.layouts.find(l => l.id === state.activeLayoutId);
    const page = layout?.pages.find(p => p.id === state.activePageId);
    if (!page) return state;

    if (parentId) {
      const parent = state.findNode(parentId);
      if (parent) {
        if (!parent.children) parent.children = [];
        parent.children.push(node);
      }
    } else {
      page.nodes.push(node);
    }
    const parent = parentId ? state.findNode(parentId) : undefined;
    NodeFactory.computeStyles(node, parent);
    return { document: doc };
  }),

  updateNode: (id, patch) => set((state) => {
    const doc = { ...state.document };
    const node = state.findNode(id);
    if (node) {
      Object.assign(node, patch);
      
      // CRITICAL: Sync properties back to decorator configs to prevent overwrite in renderer
      const ld = node.decorators.find(d => d.type === 'layout');
      if (ld) {
        if (patch.x !== undefined) ld.config.x = patch.x;
        if (patch.y !== undefined) ld.config.y = patch.y;
        if (patch.width !== undefined) ld.config.width = patch.width;
        if (patch.height !== undefined) ld.config.height = patch.height;
      }

      const parent = state.getParentNode(id);
      NodeFactory.computeStyles(node, parent || undefined);
    }
    return { document: doc };
  }),

  updateDecorator: (nodeId, decoratorId, patch) => set((state) => {
    const doc = { ...state.document };
    const node = state.findNode(nodeId);
    if (node) {
      const dec = node.decorators.find(d => d.id === decoratorId);
      if (dec) {
        dec.config = { ...dec.config, ...patch };
        const parent = state.getParentNode(nodeId);
        NodeFactory.computeStyles(node, parent || undefined);
      }
    }
    return { document: doc };
  }),

  deleteNode: (id) => set((state) => {
    const doc = { ...state.document };
    const layout = doc.layouts.find(l => l.id === state.activeLayoutId);
    const page = layout?.pages.find(p => p.id === state.activePageId);
    if (!page) return state;

    const removeFrom = (arr: any[]) => {
      const idx = arr.findIndex(n => n.id === id);
      if (idx !== -1) { arr.splice(idx, 1); return true; }
      for (const n of arr) if (n.children && removeFrom(n.children)) return true;
      return false;
    };
    removeFrom(page.nodes);
    return { document: doc, selectedNodeIds: state.selectedNodeIds.filter(sid => sid !== id) };
  }),

  selectNodes: (ids, multiple) => set((state) => {
    if (!multiple) return { selectedNodeIds: ids };
    if (ids.length === 0) return { selectedNodeIds: [] };
    const firstId = ids[0];
    const parent = state.getParentNode(firstId);
    const validIds = ids.filter(id => {
      const p = state.getParentNode(id);
      return (p?.id === parent?.id);
    });
    return { selectedNodeIds: validIds };
  }),

  groupNodes: (ids) => set((state) => {
    if (ids.length < 2) return state;
    const doc = { ...state.document };
    const toG = ids.map(id => state.findNode(id)).filter(Boolean);
    const parent = state.getParentNode(ids[0]);
    const siblingArr = parent ? parent.children : doc.layouts.find(l => l.id === state.activeLayoutId)?.pages.find(p => p.id === state.activePageId)?.nodes;
    if (!siblingArr) return state;

    const minX = Math.min(...toG.map(n => n.x));
    const minY = Math.min(...toG.map(n => n.y));
    const maxX = Math.max(...toG.map(n => n.x + n.width));
    const maxY = Math.max(...toG.map(n => n.y + n.height));

    const gId = NodeFactory.makeId();
    const g: any = NodeFactory.createGroup(gId, 'Group');
    g.x = minX; g.y = minY; g.width = maxX - minX; g.height = maxY - minY;
    g.children = toG.map(n => ({ ...n, x: n.x - minX, y: n.y - minY }));

    ids.forEach(id => {
      const idx = siblingArr.findIndex((n: any) => n.id === id);
      if (idx !== -1) siblingArr.splice(idx, 1);
    });
    siblingArr.push(g);
    NodeFactory.computeStyles(g, parent || undefined);
    return { document: doc, selectedNodeIds: [gId] };
  }),

  ungroupNode: (id) => set((state) => {
    const doc = { ...state.document };
    const node = state.findNode(id);
    if (!node || node.type !== NodeType.GROUP) return state;
    
    const parent = state.getParentNode(id);
    const siblingArr = parent ? parent.children : doc.layouts.find(l => l.id === state.activeLayoutId)?.pages.find(p => p.id === state.activePageId)?.nodes;
    if (!siblingArr) return state;

    const children = node.children.map((c: any) => ({ ...c, x: c.x + node.x, y: c.y + node.y }));
    const idx = siblingArr.findIndex((n: any) => n.id === id);
    siblingArr.splice(idx, 1, ...children);
    children.forEach(c => NodeFactory.computeStyles(c, parent || undefined));
    return { document: doc, selectedNodeIds: children.map(c => c.id) };
  }),

  reorderNode: (id, dir) => set((state) => {
    const doc = { ...state.document };
    const parent = state.getParentNode(id);
    const arr = parent ? parent.children : doc.layouts.find(l => l.id === state.activeLayoutId)?.pages.find(p => p.id === state.activePageId)?.nodes;
    if (!arr) return state;
    const idx = arr.findIndex((n: any) => n.id === id);
    if (idx === -1) return state;
    if (dir === 'up' && idx < arr.length - 1) [arr[idx], arr[idx+1]] = [arr[idx+1], arr[idx]];
    if (dir === 'down' && idx > 0) [arr[idx], arr[idx-1]] = [arr[idx-1], arr[idx]];
    return { document: doc };
  }),

  moveNodeToGroup: (nodeId, targetId) => set((state) => {
    const doc = { ...state.document };
    const node = state.findNode(nodeId);
    if (!node) return state;

    const oldAbs = state.getAbsoluteTransform(nodeId);
    const oldParent = state.getParentNode(nodeId);
    const oldArr = oldParent ? oldParent.children : doc.layouts[0].pages.find(p => p.id === state.activePageId)?.nodes;
    
    const target = targetId ? state.findNode(targetId) : null;
    if (target === node) return state;
    const targetArr = target ? target.children : doc.layouts[0].pages.find(p => p.id === state.activePageId)?.nodes;

    if (oldArr && targetArr) {
      const idx = oldArr.findIndex((n: any) => n.id === nodeId);
      if (idx !== -1) oldArr.splice(idx, 1);
      
      const targetAbs = targetId ? state.getAbsoluteTransform(targetId) : { x: 0, y: 0, rotation: 0 };
      node.x = oldAbs.x - targetAbs.x;
      node.y = oldAbs.y - targetAbs.y;
      
      targetArr.push(node);
      NodeFactory.computeStyles(node, target || undefined);
    }
    return { document: doc };
  }),

  findNode: (id) => {
    const search = (arr: any[]): any | null => {
      for (const n of arr) {
        if (n.id === id) return n;
        if (n.children) { const f = search(n.children); if (f) return f; }
      }
      return null;
    };
    const state = get();
    const page = state.document.layouts.find(l => l.id === state.activeLayoutId)?.pages.find(p => p.id === state.activePageId);
    return page ? search(page.nodes) : null;
  },

  addPage: (name) => set((state) => {
    const doc = { ...state.document };
    const layout = doc.layouts.find(l => l.id === state.activeLayoutId);
    if (layout) {
      const newPage = { id: `p-${Date.now()}`, name, nodes: [] };
      layout.pages.push(newPage);
      return { document: doc, activePageId: newPage.id };
    }
    return state;
  }),

  getAbsoluteTransform: (id) => {
    const state = get();
    const path: any[] = [];
    const findPath = (arr: any[], targetId: string, currentPath: any[]): boolean => {
      for (const n of arr) {
        if (n.id === targetId) { path.push(...currentPath, n); return true; }
        if (n.children && findPath(n.children, targetId, [...currentPath, n])) return true;
      }
      return false;
    };
    const page = state.document.layouts.find(l => l.id === state.activeLayoutId)?.pages.find(p => p.id === state.activePageId);
    if (page) findPath(page.nodes, id, []);
    
    let absX = 0, absY = 0, absRot = 0;
    path.forEach(n => {
      absX += n.x; absY += n.y; absRot += n.rotation || 0;
    });
    return { x: absX, y: absY, rotation: absRot };
  },

  getParentNode: (id) => {
    const state = get();
    const search = (arr: any[], parent: any | null): any | null => {
      for (const n of arr) {
        if (n.id === id) return parent;
        if (n.children) { const f = search(n.children, n); if (f) return f; }
      }
      return null;
    };
    const page = state.document.layouts.find(l => l.id === state.activeLayoutId)?.pages.find(p => p.id === state.activePageId);
    return page ? search(page.nodes, null) : null;
  },

  findParentAt: (x, y, excludedIds) => {
    const state = get();
    const page = state.document.layouts.find(l => l.id === state.activeLayoutId)?.pages.find(p => p.id === state.activePageId);
    if (!page) return null;
    
    const search = (nodes: any[]): any | null => {
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if (excludedIds.includes(n.id)) continue;
        if (n.type !== NodeType.FRAME && n.type !== NodeType.GROUP) continue;
        
        const abs = state.getAbsoluteTransform(n.id);
        if (x >= abs.x && x <= abs.x + n.width && y >= abs.y && y <= abs.y + n.height) {
            const inner = search(n.children);
            return inner || n;
        }
      }
      return null;
    };
    return search(page.nodes);
  }
}));
