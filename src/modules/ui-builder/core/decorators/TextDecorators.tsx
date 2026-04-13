import React from 'react';
import { BaseDecorator, CSSAttributes, DesignNode } from '../DesignNode';
import { AlignLeft, AlignCenter, AlignRight } from 'lucide-react';

/**
 * Granular Decorator for Text Color
 */
export class TextColorDecorator extends BaseDecorator {
  id = 'text-color-dec';
  type = 'text-color';
  color: string = '#000000';

  constructor(initialColor?: string) {
    super();
    if (initialColor) this.color = initialColor;
  }

  decorate(node: DesignNode, attributes: CSSAttributes): void {
    attributes.color = this.color;
  }

  renderUI(node: DesignNode, update: (config: any) => void): React.ReactNode {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-[9px] uppercase font-bold text-text-dim">Text Color</span>
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

/**
 * Granular Decorator for Text Alignment
 */
export class TextAlignDecorator extends BaseDecorator {
  id = 'text-align-dec';
  type = 'text-align';
  align: 'left' | 'center' | 'right' = 'left';

  constructor(initialAlign?: 'left' | 'center' | 'right') {
    super();
    if (initialAlign) this.align = initialAlign;
  }

  decorate(node: DesignNode, attributes: CSSAttributes): void {
    attributes.textAlign = this.align;
  }

  renderUI(node: DesignNode, update: (config: any) => void): React.ReactNode {
    const Btn = ({ type, icon }: any) => (
      <button 
        onClick={() => { this.align = type; update({ align: type }); }}
        className={`flex-1 h-7 flex items-center justify-center rounded ${this.align === type ? 'bg-surface-400 text-primary-400' : 'text-text-dim hover:text-text-primary'}`}
      >
        {icon}
      </button>
    );

    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-[9px] uppercase font-bold text-text-dim">Alignment</span>
        <div className="flex items-center gap-1 bg-surface-200 p-1 rounded-lg border border-border">
          <Btn type="left" icon={<AlignLeft size={14}/>} />
          <Btn type="center" icon={<AlignCenter size={14}/>} />
          <Btn type="right" icon={<AlignRight size={14}/>} />
        </div>
      </div>
    );
  }
}
