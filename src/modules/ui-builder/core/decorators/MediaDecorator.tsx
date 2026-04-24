import React from 'react';
import { BaseDecorator, CSSAttributes, DesignNode } from '../DesignNode';
import { Image as ImageIcon, Link2, Repeat, Upload } from 'lucide-react';
import { NodeType } from '../NodeTypes';

export class MediaDecorator extends BaseDecorator {
    type = 'source';

    decorate(node: DesignNode, config: any, attributes: CSSAttributes, parent?: DesignNode): void {
        // Media source attributes are handled by the renderer via the decState directly
    }

    renderUI(node: DesignNode, config: any, update: (newConfig: any) => void): React.ReactNode {
        const sourceMode = config.sourceMode || (config.assetId ? 'upload' : 'url');
        const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            if (!file) return;

            const dataUrl = await readFileAsDataUrl(file);
            const [{ useUIBuilderStore }, { peerNetworkManager }] = await Promise.all([
                import('../../store'),
                import('@/core/network/PeerNetworkManager')
            ]);
            const ownerPeerId = peerNetworkManager.getLocalPeerId();
            const assetId = `asset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

            useUIBuilderStore.getState().addUploadedAsset({
                id: assetId,
                fileName: file.name,
                mimeType: file.type || 'image/*',
                size: file.size,
                dataUrl,
                ownerPeerId
            });

            update({
                url: '',
                assetId,
                fileName: file.name,
                mimeType: file.type || 'image/*',
                size: file.size,
                ownerPeerId,
                sourceMode: 'upload'
            });
            event.target.value = '';
        };

        return (
            <div className="space-y-4">
                {node.type === NodeType.IMAGE && (
                    <div className="grid grid-cols-2 gap-1 rounded bg-black/20 p-1">
                        <button
                            type="button"
                            onClick={() => update({ sourceMode: 'url' })}
                            className={`h-7 rounded text-[10px] font-bold uppercase tracking-wide flex items-center justify-center gap-1 transition-colors ${sourceMode === 'url' ? 'bg-violet-500 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                        >
                            <Link2 size={11} /> URL
                        </button>
                        <button
                            type="button"
                            onClick={() => update({ sourceMode: 'upload' })}
                            className={`h-7 rounded text-[10px] font-bold uppercase tracking-wide flex items-center justify-center gap-1 transition-colors ${sourceMode === 'upload' ? 'bg-violet-500 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                        >
                            <Upload size={11} /> Upload
                        </button>
                    </div>
                )}

                <div className="space-y-1">
                    <label className="text-[10px] text-text-dim uppercase font-bold flex items-center gap-1">
                        <ImageIcon size={10} /> URL / Source
                    </label>
                    {sourceMode === 'upload' && node.type === NodeType.IMAGE ? (
                        <div className="space-y-2">
                            <label className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded border border-dashed border-violet-500/40 bg-violet-500/10 text-[11px] font-semibold text-violet-200 transition-colors hover:border-violet-400 hover:bg-violet-500/15">
                                <Upload size={13} />
                                Choose image file
                                <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                            </label>
                            {config.fileName && (
                                <div className="truncate rounded bg-black/20 px-2 py-1 text-[10px] text-slate-400">
                                    {config.fileName}
                                </div>
                            )}
                        </div>
                    ) : (
                        <input
                            type="text" value={config.url || ''}
                            onChange={(e) => update({ url: e.target.value, sourceMode: 'url', assetId: undefined })}
                            placeholder="https://..."
                            className="w-full bg-surface-300 border border-border/50 rounded px-2 py-1 text-[11px] outline-none focus:border-violet-500"
                        />
                    )}
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

function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') resolve(reader.result);
            else reject(new Error('Failed to read image file'));
        };
        reader.onerror = () => reject(reader.error ?? new Error('Failed to read image file'));
        reader.readAsDataURL(file);
    });
}
