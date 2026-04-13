import { DesignDocument } from '../core/DesignDocument';

export interface Renderer {
  render(document: DesignDocument, container: any): void;
}
