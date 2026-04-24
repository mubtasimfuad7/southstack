import React from 'react';
import { BaseDecorator, CSSAttributes, DesignNode } from '../DesignNode';
import { FRAME_PRESETS, type FramePresetKey } from '../FramePresets';
import { Maximize, Move, Percent } from 'lucide-react';
import { NodeType } from '../NodeTypes';

const LayoutPropInput: React.FC<{
  label: string;
  value: number;
  onChange: (value: number) => void;
  icon?: React.ComponentType<{ size?: number }>;
  step?: number;
}> = ({ label, value, onChange, icon: Icon, step = 1 }) => (
  <div className="flex flex-col gap-1 flex-1">
    <span className="text-[8px] text-text-dim uppercase font-bold flex items-center gap-1">
      {Icon && <Icon size={8} />}
      {label}
    </span>
    <input
      type="number"
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      className="bg-surface-300 border border-border/50 rounded px-1.5 py-1 text-[10px] w-full outline-none focus:border-violet-500"
    />
  </div>
);

/**
 * Decorator for Node Layout (x, y, width, height)
 */
export class LayoutDecorator extends BaseDecorator {
  type = 'layout';

  decorate(node: DesignNode, config: any, attributes: CSSAttributes, parent?: DesignNode): void {
    if (config.x !== undefined) node.x = config.x;
    if (config.y !== undefined) node.y = config.y;

    // Percentage width logic
    if (config.isPercentWidth && parent) {
      const percentage = config.widthPercent || 100;
      node.width = (parent.width * percentage) / 100;
    } else {
      if (config.width !== undefined) node.width = config.width;
    }

    if (config.height !== undefined) node.height = config.height;
  }

  renderUI(node: DesignNode, config: any, update: (newConfig: any) => void): React.ReactNode {
    const handleFramePresetChange = (preset: FramePresetKey) => {
      if (preset === 'custom') {
        update({ framePreset: 'custom' });
        return;
      }
      const next = FRAME_PRESETS[preset];
      update({
        framePreset: preset,
        isPercentWidth: false,
        width: next.width,
        height: next.height
      });
    };

    return (
      <div className="space-y-4">
        {node.type === NodeType.FRAME && (
          <div className="space-y-1">
            <span className="text-[9px] uppercase font-bold text-text-dim">Frame Type</span>
            <select
              value={(config.framePreset as FramePresetKey) || 'custom'}
              onChange={(e) => handleFramePresetChange(e.target.value as FramePresetKey)}
              className="w-full bg-surface-300 border border-border/50 rounded px-2 py-1.5 text-[10px] outline-none focus:border-violet-500"
            >
              {Object.entries(FRAME_PRESETS).map(([key, preset]) => (
                <option key={key} value={key}>
                  {preset.label}
                  {key !== 'custom' ? ` (${preset.width} x ${preset.height})` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex gap-2">
          <LayoutPropInput label="X" value={config.x || 0} icon={Move} onChange={(v: number) => update({ x: v })} />
          <LayoutPropInput label="Y" value={config.y || 0} icon={Move} onChange={(v: number) => update({ y: v })} />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[9px] uppercase font-bold text-text-dim">Width Mode</span>
            <div className="flex bg-surface-400 p-0.5 rounded border border-white/5">
              <button
                onClick={() => update({ isPercentWidth: false })}
                className={`px-2 py-0.5 text-[8px] rounded transition-colors ${!config.isPercentWidth ? 'bg-violet-600 text-white' : 'text-slate-400'}`}
              >Fixed</button>
              <button
                onClick={() => update({ isPercentWidth: true })}
                className={`px-2 py-0.5 text-[8px] rounded transition-colors ${config.isPercentWidth ? 'bg-violet-600 text-white' : 'text-slate-400'}`}
              >Fill %</button>
            </div>
          </div>

          <div className="flex gap-2">
            {config.isPercentWidth ? (
              <LayoutPropInput label="Width %" value={config.widthPercent || 100} icon={Percent} onChange={(v: number) => update({ widthPercent: v })} />
            ) : (
              <LayoutPropInput label="Width" value={config.width || 100} icon={Maximize} onChange={(v: number) => update({ width: v, framePreset: node.type === NodeType.FRAME ? 'custom' : config.framePreset })} />
            )}
            <LayoutPropInput label="Height" value={config.height || 100} icon={Maximize} onChange={(v: number) => update({ height: v, framePreset: node.type === NodeType.FRAME ? 'custom' : config.framePreset })} />
          </div>
        </div>
      </div>
    );
  }
}
