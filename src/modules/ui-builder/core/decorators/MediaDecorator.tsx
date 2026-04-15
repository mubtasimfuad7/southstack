import React from 'react';
import { BaseDecorator, CSSAttributes, DesignNode } from '../DesignNode';
import { PlayCircle, Image as ImageIcon, Repeat } from 'lucide-react';
import { NodeType } from '../NodeTypes';

export class MediaDecorator extends BaseDecorator {
    type = 'source';

    decorate(node: DesignNode, config: any, attributes: CSSAttributes, parent?: DesignNode): void {
        // Media source attributes are handled by the renderer via the decState directly
    }

    renderUI(node: DesignNode, config: any, update: (newConfig: any) => void): React.ReactNode {
        return (
            <div className="space-y-4">
                <div className="space-y-1">
                    <label className="text-[10px] text-text-dim uppercase font-bold flex items-center gap-1">
                        <ImageIcon size={10} /> URL / Source
                    </label>
                    <input
                        type="text" value={config.url || ''}
                        onChange={(e) => update({ url: e.target.value })}
                        placeholder="https://..."
                        className="w-full bg-surface-300 border border-border/50 rounded px-2 py-1 text-[11px] outline-none focus:border-violet-500"
                    />
                </div>

                {node.type === NodeType.VIDEO && (
                    <div className="flex items-center justify-between">
                        <label className="text-[10px] text-text-dim uppercase font-bold flex items-center gap-1">
                            <Repeat size={10} /> Loop Video
                        </label>
                        <input
                            type="checkbox" checked={!!config.loop}
                            onChange={(e) => update({ loop: e.target.checked })}
                            className="w-3 h-3 accent-violet-500"
                        />
                    </div>
                )}
            </div>
        );
    }
}
