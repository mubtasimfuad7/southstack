import React from 'react';
import { BaseDecorator, CSSAttributes, DesignNode } from '../DesignNode';
import { Sun, Ghost, BoxSelect } from 'lucide-react';

export class StyleDecorator extends BaseDecorator {
    type = 'style';

    decorate(node: DesignNode, config: any, attributes: CSSAttributes, parent?: DesignNode): void {
        if (config.opacity !== undefined) attributes.opacity = config.opacity / 100;
        if (config.blur !== undefined && config.blur > 0) attributes.filter = `blur(${config.blur}px)`;
        if (config.shadowEnabled) {
            const { x = 0, y = 4, blur = 10, color = 'rgba(0,0,0,0.5)' } = config.shadow || {};
            attributes.boxShadow = `${x}px ${y}px ${blur}px ${color}`;
        }
    }

    renderUI(node: DesignNode, config: any, update: (newConfig: any) => void): React.ReactNode {
        return (
            <div className="space-y-4">
                {/* Opacity */}
                <div className="space-y-1">
                    <div className="flex justify-between items-center text-[10px] text-text-dim uppercase font-bold">
                        <div className="flex items-center gap-1"><Ghost size={10} /> Opacity</div>
                        <span>{config.opacity || 100}%</span>
                    </div>
                    <input
                        type="range" min="0" max="100" value={config.opacity ?? 100}
                        onChange={(e) => update({ opacity: parseInt(e.target.value) })}
                        className="w-full accent-violet-500 h-1 bg-surface-300 rounded-lg appearance-none cursor-pointer"
                    />
                </div>

                {/* Blur */}
                <div className="space-y-1">
                    <div className="flex justify-between items-center text-[10px] text-text-dim uppercase font-bold">
                        <div className="flex items-center gap-1"><Sun size={10} /> Blur</div>
                        <span>{config.blur || 0}px</span>
                    </div>
                    <input
                        type="range" min="0" max="50" value={config.blur ?? 0}
                        onChange={(e) => update({ blur: parseInt(e.target.value) })}
                        className="w-full accent-violet-500 h-1 bg-surface-300 rounded-lg appearance-none cursor-pointer"
                    />
                </div>

                {/* Shadow */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <div className="text-[10px] text-text-dim uppercase font-bold flex items-center gap-1">
                            <BoxSelect size={10} /> Shadow
                        </div>
                        <input
                            type="checkbox" checked={!!config.shadowEnabled}
                            onChange={(e) => update({ shadowEnabled: e.target.checked })}
                            className="w-3 h-3 accent-violet-500"
                        />
                    </div>
                    {config.shadowEnabled && (
                        <div className="grid grid-cols-2 gap-2 bg-black/20 p-2 rounded border border-white/5">
                            <PropInput label="X" value={config.shadow?.x ?? 0} onChange={(v: any) => update({ shadow: { ...config.shadow, x: v } })} />
                            <PropInput label="Y" value={config.shadow?.y ?? 4} onChange={(v: any) => update({ shadow: { ...config.shadow, y: v } })} />
                            <PropInput label="Blur" value={config.shadow?.blur ?? 10} onChange={(v: any) => update({ shadow: { ...config.shadow, blur: v } })} />
                            <div className="flex flex-col gap-1">
                                <span className="text-[8px] text-text-dim uppercase font-bold">Color</span>
                                <input type="color" value={config.shadow?.color || '#000000'} onChange={(e) => update({ shadow: { ...config.shadow, color: e.target.value } })} className="w-full h-5 bg-transparent border-none cursor-pointer p-0" />
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }
}

const PropInput = ({ label, value, onChange }: any) => (
    <div className="flex flex-col gap-1">
        <span className="text-[8px] text-text-dim uppercase font-bold">{label}</span>
        <input
            type="number" value={value}
            onChange={(e) => onChange(parseInt(e.target.value) || 0)}
            className="bg-surface-400 border border-white/5 rounded px-1.5 py-0.5 text-[10px] w-full outline-none focus:border-violet-500"
        />
    </div>
);
