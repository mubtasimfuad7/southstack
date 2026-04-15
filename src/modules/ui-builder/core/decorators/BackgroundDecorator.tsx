import React from 'react';
import { BaseDecorator, CSSAttributes, DesignNode } from '../DesignNode';

export class BackgroundDecorator extends BaseDecorator {
  type = 'background';

  decorate(node: DesignNode, config: any, attributes: CSSAttributes, parent?: DesignNode): void {
    attributes.backgroundColor = config.color || '#ffffff';
  }

  renderUI(node: DesignNode, config: any, update: (newConfig: any) => void): React.ReactNode {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-[9px] uppercase font-bold text-text-dim">Background</span>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={config.color || '#ffffff'}
            onChange={(e) => update({ color: e.target.value })}
            className="w-6 h-6 rounded cursor-pointer bg-transparent"
          />
          <span className="text-[10px] font-mono uppercase">{config.color || '#ffffff'}</span>
        </div>
      </div>
    );
  }
}
