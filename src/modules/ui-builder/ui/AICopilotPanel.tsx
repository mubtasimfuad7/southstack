import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Plus, X as CloseIcon } from 'lucide-react';
import { AIAgentOrchestrator, AIResponse, AgentStatus } from '../ai/AIAgentOrchestrator';
import { localModelProvider } from '@/execution/llm/LocalModelProvider';
import { localVisionModelProvider } from '@/execution/vision/LocalVisionModelProvider';

const agent = new AIAgentOrchestrator();

type PendingAttachment = {
  id: string;
  file: File;
  previewUrl: string;
};

type MessageAttachment = {
  name: string;
  previewUrl: string;
};

export const AICopilotPanel: React.FC = () => {
  const [messages, setMessages] = useState<AIResponse[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [isOpen, setIsOpen] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [modelState, setModelState] = useState({ ready: localModelProvider.isReady(), progress: 0, text: '' });
  const [visionModelState, setVisionModelState] = useState({ ready: localVisionModelProvider.isReady(), progress: 0, text: '' });
  const bottomRef = useRef<HTMLDivElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubMsg = agent.onMessage((msg) => {
      setMessages((prev) => [...prev, msg]);
    });
    const unsubStatus = agent.onStatusChange((newStatus) => {
      setStatus(newStatus);
    });

    const unsubProgress = localModelProvider.onLoadProgress((progress, text) => {
      setModelState({ ready: progress >= 1, progress, text });
    });
    const unsubVisionProgress = localVisionModelProvider.onLoadProgress((progress, text) => {
      setVisionModelState({ ready: progress >= 1, progress, text });
    });

    return () => {
      unsubMsg();
      unsubStatus();
      unsubProgress();
      unsubVisionProgress();
      pendingAttachments.forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl));
    };
  }, [pendingAttachments]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePaste = (event: ClipboardEvent) => {
      const files = extractImageFiles(event.clipboardData);
      if (!files.length) return;

      event.preventDefault();
      addPendingAttachments(files);
      setShowAttachMenu(false);
    };

    const handleClickOutside = (event: MouseEvent) => {
      if (!attachMenuRef.current) return;
      if (attachMenuRef.current.contains(event.target as Node)) return;
      setShowAttachMenu(false);
    };

    window.addEventListener('paste', handlePaste);
    window.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('paste', handlePaste);
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status]);

  const addPendingAttachments = (files: File[]) => {
    const nextAttachments = files
      .filter((file) => file.type.startsWith('image/'))
      .map((file) => ({
        id: `attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        previewUrl: URL.createObjectURL(file),
      }));

    if (nextAttachments.length === 0) return;
    setPendingAttachments((prev) => [...prev, ...nextAttachments]);
  };

  const removePendingAttachment = (id: string) => {
    setPendingAttachments((prev) => {
      const target = prev.find((attachment) => attachment.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((attachment) => attachment.id !== id);
    });
  };

  const clearPendingAttachments = () => {
    pendingAttachments.forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl));
    setPendingAttachments([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || status === 'analyzing' || status === 'acting') return;

    const prompt = input.trim();
    const attachmentsForMessage = [...pendingAttachments];

    setInput('');
    setPendingAttachments([]);
    setShowAttachMenu(false);
    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content: `USER: ${prompt}`,
        metadata: attachmentsForMessage.length
          ? {
              attachments: attachmentsForMessage.map((attachment) => ({
                name: attachment.file.name,
                previewUrl: attachment.previewUrl,
              })),
            }
          : undefined,
      },
    ]);

    if (attachmentsForMessage.length > 0) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'tool',
          content: `Using ${attachmentsForMessage.length} attached image${attachmentsForMessage.length > 1 ? 's' : ''}: ${attachmentsForMessage.map((attachment) => attachment.file.name).join(', ')}`,
        },
      ]);
      try {
        await agent.submitPromptWithImageContext(prompt, attachmentsForMessage.map((attachment) => attachment.file));
      } catch (err) {
        setMessages((prev) => [...prev, { role: 'assistant', content: `Vision Error: ${(err as Error).message}` }]);
        setStatus('error');
      }
      return;
    }

    await agent.submitPrompt(prompt);
  };

  const handleClear = () => {
    agent.clearHistory();
    setMessages([]);
    clearPendingAttachments();
  };

  const handleFileAttach = (files: FileList | null) => {
    if (!files?.length) return;
    addPendingAttachments(Array.from(files));
    setShowAttachMenu(false);
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-indigo-600 rounded-full flex items-center justify-center text-white shadow-[0_8px_30px_rgb(0,0,0,0.12)] hover:bg-indigo-700 transition-colors z-50 group hover:scale-105 duration-200"
        title="Open AI Design Assistant"
      >
        <span className="text-2xl group-hover:rotate-12 transition-transform duration-200">✨</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 w-96 h-[600px] max-h-[80vh] bg-white rounded-2xl shadow-[0_8px_40px_rgb(0,0,0,0.16)] flex flex-col overflow-hidden z-50 border border-slate-200 font-sans backdrop-blur-xl bg-opacity-95">
      <div className="h-14 bg-slate-900 flex items-center px-4 justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xl">✨</span>
          <h3 className="text-white font-medium text-sm">Design Copilot</h3>
          {modelState.ready ? (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-medium">Model Loaded</span>
          ) : modelState.progress > 0 && modelState.progress < 1 ? (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 font-medium animate-pulse">{Math.round(modelState.progress * 100)}% Loading</span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={handleClear} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-white rounded hover:bg-slate-800 text-xs transition-colors" title="Reset Conversation">↺</button>
          <button onClick={() => setIsOpen(false)} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors">✕</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 p-6 text-center space-y-3">
            <div className="w-12 h-12 bg-indigo-50 rounded-full flex items-center justify-center text-2xl mb-2 shadow-inner">🤖</div>
            <p className="text-sm font-medium text-slate-600">I am your UI Builder Agent.</p>
            <p className="text-xs">Attach photos with the plus button or paste them directly, then ask me to edit the canvas.</p>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex flex-col text-sm w-full ${m.content.startsWith('USER:') ? 'items-end' : 'items-start'}`}>
            <div
              className={`
                px-3 py-2 rounded-2xl max-w-[85%]
                ${m.content.startsWith('USER:') ? 'bg-indigo-600 text-white rounded-br-sm' : ''}
                ${m.role === 'tool' ? 'bg-slate-100 text-slate-600 border border-slate-200 font-mono text-[11px] rounded-tl-sm w-full' : ''}
                ${m.role === 'assistant' && !m.content.startsWith('USER:') ? 'bg-white text-slate-800 shadow-sm border border-slate-100 rounded-bl-sm' : ''}
              `}
            >
              {m.content.replace('USER: ', '')}
              {m.metadata && (
                <div className="mt-2 pt-2 border-t border-slate-200/50 opacity-90 break-words whitespace-pre-wrap">
                  {Array.isArray(m.metadata.attachments) ? (
                    <div className="space-y-2">
                      <div className="text-[10px] uppercase tracking-wider opacity-80">Attached photos</div>
                      <div className="grid grid-cols-2 gap-2">
                        {m.metadata.attachments.map((attachment: MessageAttachment, index: number) => (
                          <div key={`${attachment.name}-${index}`} className="rounded-xl overflow-hidden border border-slate-200/60 bg-white/70">
                            <img src={attachment.previewUrl} alt={attachment.name} className="w-full h-20 object-cover" />
                            <div className="px-2 py-1 text-[10px] text-slate-600 truncate">{attachment.name}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    JSON.stringify(m.metadata, null, 2)
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {status === 'analyzing' && (
          <div className="flex items-center gap-2 text-xs text-indigo-600 py-1 pl-2 font-medium">
            <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
            Analyzing layout...
          </div>
        )}
        {status === 'acting' && (
          <div className="flex items-center gap-2 text-xs text-amber-600 py-1 pl-2 font-medium">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce"></span>
              <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
              <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
            </div>
            Executing tool...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSubmit} className="p-3 bg-white border-t border-slate-100 flex-shrink-0">
        {pendingAttachments.length > 0 && (
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
            {pendingAttachments.map((attachment) => (
              <div key={attachment.id} className="relative shrink-0 w-20">
                <div className="rounded-2xl overflow-hidden border border-slate-200 bg-slate-50">
                  <img src={attachment.previewUrl} alt={attachment.file.name} className="w-20 h-20 object-cover" />
                </div>
                <button
                  type="button"
                  onClick={() => removePendingAttachment(attachment.id)}
                  className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center shadow"
                >
                  <CloseIcon size={12} />
                </button>
                <div className="mt-1 text-[10px] text-slate-500 truncate">{attachment.file.name}</div>
              </div>
            ))}
          </div>
        )}

        {!visionModelState.ready && visionModelState.progress > 0 ? (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Loading image model: {Math.round(visionModelState.progress * 100)}% {visionModelState.text}
          </div>
        ) : null}

        <div className="relative flex items-center" ref={attachMenuRef}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => {
              handleFileAttach(e.target.files);
              e.target.value = '';
            }}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => setShowAttachMenu((prev) => !prev)}
            className="absolute left-1 w-8 h-8 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors flex items-center justify-center"
            title="Add attachment"
          >
            <Plus size={18} />
          </button>
          {showAttachMenu && (
            <div className="absolute left-0 bottom-12 w-48 rounded-2xl border border-slate-200 bg-white shadow-xl p-1 z-20">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full px-3 py-2 rounded-xl text-left text-sm text-slate-700 hover:bg-slate-100 transition-colors flex items-center gap-2"
              >
                <ImagePlus size={15} />
                Add photos
              </button>
            </div>
          )}
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={status === 'analyzing' || status === 'acting'}
            placeholder={status === 'idle' ? 'Ask anything' : 'Agent is thinking...'}
            className="w-full pl-11 pr-10 py-2.5 bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 rounded-xl text-sm outline-none transition-all disabled:opacity-50 disabled:text-slate-400"
          />
          <button
            type="submit"
            disabled={!input.trim() || status === 'analyzing' || status === 'acting'}
            className="absolute right-1 text-slate-400 hover:text-indigo-600 disabled:opacity-50 flex items-center justify-center w-8 h-8 rounded-lg hover:bg-slate-100 transition-colors"
          >
            ➤
          </button>
        </div>
      </form>
    </div>
  );
};

function extractImageFiles(clipboardData: DataTransfer | null): File[] {
  if (!clipboardData) return [];

  const files: File[] = [];
  for (const item of Array.from(clipboardData.items)) {
    if (!item.type.startsWith('image/')) continue;

    const file = item.getAsFile();
    if (!file) continue;

    const extension = file.type.split('/')[1] || 'png';
    files.push(new File([file], file.name || `pasted-image.${extension}`, { type: file.type }));
  }

  return files;
}
