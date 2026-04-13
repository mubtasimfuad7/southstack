import React from 'react';
import { BaseDecorator, CSSAttributes, DesignNode } from '../DesignNode';
import { Maximize, Move } from 'lucide-react';

/**
 * Decorator for Node Layout (x, y, width, height)
 */
export class LayoutDecorator extends BaseDecorator {
  type = 'layout';

  decorate(node: DesignNode, config: any, attributes: CSSAttributes): void {
    // Modify node transformation properties directly (Pattern A)
    if (config.x !== undefined) node.x = config.x;
    if (config.y !== undefined) node.y = config.y;
    if (config.width !== undefined) node.width = config.width;
    if (config.height !== undefined) node.height = config.height;
  }

  renderUI(node: DesignNode, config: any, update: (newConfig: any) => void): React.ReactNode {
    const PropInput = ({ label, value, onChange, icon: Icon }: any) => (
      <div className="flex flex-col gap-1 flex-1">
        <span className="text-[8px] text-text-dim uppercase font-bold flex items-center gap-1">
          {Icon && <Icon size={8} />}
          {label}
        </span>
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value) || 0)}
          className="bg-surface-300 border border-border/50 rounded px-1.5 py-1 text-[10px] w-full outline-none focus:border-primary-500"
        />
      </div>
    );

    return (
      <div className="space-y-3">
        <div className="flex gap-2">
          <PropInput label="X" value={config.x || 0} icon={Move} onChange={(v: number) => update({ x: v })} />
          <PropInput label="Y" value={config.y || 0} icon={Move} onChange={(v: number) => update({ y: v })} />
        </div>
        <div className="flex gap-2">
          <PropInput label="W" value={config.width || 100} icon={Maximize} onChange={(v: number) => update({ width: v })} />
          <PropInput label="H" value={config.height || 100} icon={Maximize} onChange={(v: number) => update({ height: v })} />
        </div>
      </div>
    );
  }
}
