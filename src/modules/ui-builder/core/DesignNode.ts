import React from 'react';
import { NodeType } from './NodeTypes';

export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

export type CSSAttributes = Record<string, any>;

/**
 * Serializable state for a decorator
 */
export interface DecoratorState {
  id: string;
  type: string;
  config: any;
  enabled: boolean;
}

/**
 * Logic Class for a Decorator
 */
export abstract class BaseDecorator {
  abstract type: string;

  /**
   * Logic: Modifies the attribute bag based on state.
   */
  abstract decorate(node: DesignNode, config: any, attributes: CSSAttributes): void;

  /**
   * UI: Renders controls for this decorator.
   */
  abstract renderUI(node: DesignNode, config: any, update: (newConfig: any) => void): React.ReactNode;
}

export interface DesignNode {
  id: string;
  name: string;
  type: NodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  
  // Serializable State
  decorators: DecoratorState[]; 
  children: DesignNode[];
  
  // Computed State (populated by decorators)
  attributes: CSSAttributes; 
  content?: any;
}
