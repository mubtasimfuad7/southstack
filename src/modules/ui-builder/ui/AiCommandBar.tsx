import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Command, Loader2, X, CornerDownLeft } from 'lucide-react';
import { uiAiManager } from '../ai/UiAiManager';

export const AiCommandBar: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [prompt, setPrompt] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                setIsOpen(true);
            }
            if (e.key === 'Escape') {
                setIsOpen(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    useEffect(() => {
        if (isOpen) {
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen]);

    const handleSubmit = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!prompt.trim() || isProcessing) return;

        setIsProcessing(true);
        try {
            await uiAiManager.executeCommand(prompt);
            setPrompt('');
            setIsOpen(false);
        } catch (err: any) {
            alert(err.message);
        } finally {
            setIsProcessing(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[1000] flex items-start justify-center pt-32 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="w-full max-w-2xl bg-[#1e1e2e] border border-[#313244] rounded-xl shadow-2xl overflow-hidden animate-in slide-in-from-top-4 duration-300">
                <form onSubmit={handleSubmit} className="relative flex items-center p-4">
                    <Sparkles className={`w-5 h-5 mr-3 ${isProcessing ? 'text-blue-400 animate-pulse' : 'text-purple-400'}`} />

                    <input
                        ref={inputRef}
                        type="text"
                        className="flex-1 bg-transparent border-none outline-none text-[#cdd6f4] placeholder-[#7f849c] text-lg font-medium"
                        placeholder={isProcessing ? "AI is thinking..." : "Describe changes to selected elements..."}
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        disabled={isProcessing}
                    />

                    <div className="flex items-center gap-2">
                        {!isProcessing && (
                            <div className="flex items-center gap-1 px-2 py-1 bg-[#313244] rounded text-[10px] text-[#a6adc8] font-bold">
                                <CornerDownLeft className="w-3 h-3" />
                                <span>ENTER</span>
                            </div>
                        )}
                        {isProcessing ? (
                            <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />
                        ) : (
                            <button
                                type="button"
                                onClick={() => setIsOpen(false)}
                                className="p-1 hover:bg-[#313244] rounded-full transition-colors"
                            >
                                <X className="w-5 h-5 text-[#7f849c]" />
                            </button>
                        )}
                    </div>
                </form>

                <div className="px-4 py-2 bg-[#11111b] text-[11px] text-[#585b70] flex justify-between items-center border-t border-[#313244]">
                    <span>Tip: Press <kbd className="font-mono text-[#89b4fa]">Cmd+K</kbd> to open anytime</span>
                    <div className="flex gap-4">
                        <span>Selected: {prompt.length} chars</span>
                        <span className="text-purple-500/80 font-bold">Powered by WebLLM</span>
                    </div>
                </div>
            </div>
        </div>
    );
};
