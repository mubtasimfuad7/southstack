import React from 'react';
import { BaseDecorator, CSSAttributes, DesignNode } from '../DesignNode';
import { AlignLeft, AlignCenter, AlignRight } from 'lucide-react';

/**
 * Granular Decorator for Text Color
 */
export class TextColorDecorator extends BaseDecorator {
  type = 'text-color';

  decorate(node: DesignNode, config: any, attributes: CSSAttributes, parent?: DesignNode): void {
    attributes.color = config.color || '#000000';
  }

  renderUI(node: DesignNode, config: any, update: (newConfig: any) => void): React.ReactNode {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-[9px] uppercase font-bold text-text-dim">Text Color</span>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={config.color || '#000000'}
            onChange={(e) => update({ color: e.target.value })}
            className="w-6 h-6 rounded cursor-pointer bg-transparent"
          />
          <span className="text-[10px] font-mono uppercase">{config.color || '#000000'}</span>
        </div>
      </div>
    );
  }
}

/**
 * Granular Decorator for Text Alignment
 */
export class TextAlignDecorator extends BaseDecorator {
  type = 'text-align';

  decorate(node: DesignNode, config: any, attributes: CSSAttributes, parent?: DesignNode): void {
    attributes.textAlign = config.align || 'left';
    attributes.verticalAlign = config.verticalAlign || 'top';
  }

  renderUI(node: DesignNode, config: any, update: (newConfig: any) => void): React.ReactNode {
    const Btn = ({ type, active, icon, onClick }: any) => (
      <button
        onClick={onClick}
        className={`flex-1 h-7 flex items-center justify-center rounded transition-colors ${active ? 'bg-violet-600/20 text-violet-400' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}`}
      >
        {icon}
      </button>
    );

    return (
      <div className="space-y-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-[9px] uppercase font-bold text-text-dim">Horizontal</span>
          <div className="flex items-center gap-1 bg-black/20 p-1 rounded-lg border border-white/5">
            <Btn active={config.align === 'left'} icon={<AlignLeft size={14} />} onClick={() => update({ align: 'left' })} />
            <Btn active={config.align === 'center'} icon={<AlignCenter size={14} />} onClick={() => update({ align: 'center' })} />
            <Btn active={config.align === 'right'} icon={<AlignRight size={14} />} onClick={() => update({ align: 'right' })} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[9px] uppercase font-bold text-text-dim">Vertical</span>
          <div className="flex items-center gap-1 bg-black/20 p-1 rounded-lg border border-white/5">
            <Btn active={config.verticalAlign === 'top'} icon={<div className="w-3.5 h-0.5 bg-current -translate-y-1" />} onClick={() => update({ verticalAlign: 'top' })} />
            <Btn active={config.verticalAlign === 'middle'} icon={<div className="w-3.5 h-0.5 bg-current" />} onClick={() => update({ verticalAlign: 'middle' })} />
            <Btn active={config.verticalAlign === 'bottom'} icon={<div className="w-3.5 h-0.5 bg-current translate-y-1" />} onClick={() => update({ verticalAlign: 'bottom' })} />
          </div>
        </div>
      </div>
    );
  }
}
