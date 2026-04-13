import React from 'react';
import { BaseDecorator, CSSAttributes, DesignNode } from '../DesignNode';

export class BackgroundDecorator extends BaseDecorator {
  id = 'bg-dec';
  type = 'background';
  color: string = '#ffffff';

  constructor(initialColor?: string) {
    super();
    if (initialColor) this.color = initialColor;
  }

  decorate(node: DesignNode, attributes: CSSAttributes): void {
    attributes.backgroundColor = this.color;
  }

  renderUI(node: DesignNode, update: (config: any) => void): React.ReactNode {
    const rgbToHex = (c: any) => c; // Simplified for this example, usually would handle rgba objects
    
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-[9px] uppercase font-bold text-text-dim">Background</span>
        <div className="flex items-center gap-2">
          <input 
            type="color" 
            value={this.color} 
            onChange={(e) => {
              this.color = e.target.value;
              update({ color: e.target.value });
            }}
            className="w-6 h-6 rounded cursor-pointer bg-transparent"
          />
          <span className="text-[10px] font-mono uppercase">{this.color}</span>
        </div>
      </div>
    );
  }
}
