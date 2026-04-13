import React from 'react';
import { DesignNode, Color } from './DesignNode';

/**
 * Abstract Decorator Class
 * Encapsulates:
 * 1. Data Structure (Config)
 * 2. Canvas Rendering Logic (Strategy)
 * 3. Property Panel UI (Template)
 */
export abstract class BaseDecorator {
  abstract type: string;

  /**
   * Applies canvas styling for this decorator.
   */
  abstract apply(ctx: CanvasRenderingContext2D, node: DesignNode, config: any): void;

  /**
   * Renders the UI controls for this decorator in the property panel.
   */
  abstract renderControls(
    nodeId: string, 
    config: any, 
    update: (newConfig: any) => void
  ): React.ReactNode;
}

/**
 * Registry to map string types to Class instances.
 * This allows us to keep state serializable (JSON) while logic is Object-Oriented.
 */
class DecoratorRegistry {
  private decorators = new Map<string, BaseDecorator>();

  register(decorator: BaseDecorator) {
    this.decorators.set(decorator.type, decorator);
  }

  get(type: string): BaseDecorator | undefined {
    return this.decorators.get(type);
  }

  getAll() {
    return Array.from(this.decorators.values());
  }
}

export const decoratorRegistry = new DecoratorRegistry();
