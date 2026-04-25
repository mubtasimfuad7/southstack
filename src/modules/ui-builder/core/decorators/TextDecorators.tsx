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
            <Btn active={config.align === 'justify'} icon={<div className="flex flex-col gap-0.5"><div className="w-3.5 h-0.5 bg-current" /><div className="w-3.5 h-0.5 bg-current" /><div className="w-3.5 h-0.5 bg-current" /></div>} onClick={() => update({ align: 'justify' })} />
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
/**
 * Granular Decorator for Typography (Font, Size, Weight)
 */
export class TextStyleDecorator extends BaseDecorator {
  type = 'text-style';

  decorate(node: DesignNode, config: any, attributes: CSSAttributes, parent?: DesignNode): void {
    if (config.fontSize) attributes.fontSize = config.fontSize;
    if (config.fontWeight) attributes.fontWeight = config.fontWeight;
    if (config.fontFamily) attributes.fontFamily = config.fontFamily;
    if (config.autoHeight) attributes.autoHeight = true;
  }

  renderUI(node: DesignNode, config: any, update: (newConfig: any) => void): React.ReactNode {
    const families = ['Inter', 'Roboto', 'system-ui', 'monospace', 'serif', 'sans-serif', 'Outfit', 'Playfair Display'];
    const weights = [
      { label: 'Thin', value: '100' },
      { label: 'Light', value: '300' },
      { label: 'Normal', value: '400' },
      { label: 'Medium', value: '500' },
      { label: 'Semi Bold', value: '600' },
      { label: 'Bold', value: '700' },
      { label: 'Extrabold', value: '800' },
      { label: 'Black', value: '900' },
    ];

    return (
      <div className="space-y-4">
        {/* Font Family */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[9px] uppercase font-bold text-text-dim">Font Family</span>
          <select
            value={config.fontFamily || 'Inter'}
            onChange={(e) => update({ fontFamily: e.target.value })}
            className="bg-black/20 border border-white/10 rounded px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-violet-500"
          >
            {families.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>

        {/* Font Weight & Size Row */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1.5">
            <span className="text-[9px] uppercase font-bold text-text-dim">Weight</span>
            <select
              value={config.fontWeight || '400'}
              onChange={(e) => update({ fontWeight: e.target.value })}
              className="bg-black/20 border border-white/10 rounded px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-violet-500"
            >
              {weights.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[9px] uppercase font-bold text-text-dim">Size</span>
            <input
              type="number"
              value={config.fontSize || 16}
              onChange={(e) => update({ fontSize: parseInt(e.target.value) || 12 })}
              className="bg-black/20 border border-white/10 rounded px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-violet-500"
            />
          </div>
        </div>

        {/* Auto Height Toggle */}
        <div className="flex items-center justify-between">
          <span className="text-[9px] uppercase font-bold text-text-dim">Auto Height</span>
          <input
            type="checkbox"
            checked={!!config.autoHeight}
            onChange={(e) => update({ autoHeight: e.target.checked })}
            className="w-3 h-3 accent-violet-500"
          />
        </div>
      </div>
    );
  }
}
