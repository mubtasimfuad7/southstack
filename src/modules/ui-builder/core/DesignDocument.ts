import { DesignNode } from './DesignNode';

export interface Page {
  id: string;
  name: string;
  nodes: DesignNode[];
}

export interface DesignDocument {
  id: string;
  name: string;
  pages: Page[];
}
