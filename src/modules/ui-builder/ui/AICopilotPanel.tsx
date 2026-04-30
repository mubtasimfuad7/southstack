import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Plus, X as CloseIcon, Mic, MicOff } from 'lucide-react';
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

  // Voice input
  const [isListening, setIsListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef('');
  const baseInputRef = useRef('');

  const speechSupported =
    typeof window !== 'undefined' &&
    Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  const bottomRef = useRef<HTMLDivElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubMsg = agent.onMessage((msg) => setMessages((prev) => [...prev, msg]));
    const unsubStatus = agent.onStatusChange((s) => setStatus(s));
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
      pendingAttachments.forEach((a) => URL.revokeObjectURL(a.previewUrl));
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
      if (!attachMenuRef.current?.contains(event.target as Node)) setShowAttachMenu(false);
    };
    window.addEventListener('paste', handlePaste);
    window.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('paste', handlePaste);
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Stop recognition when panel is closed
  useEffect(() => {
    if (!isOpen && recognitionRef.current) {
      recognitionRef.current.onresult = null;
      recognitionRef.current.onend = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.stop();
      setIsListening(false);
    }
  }, [isOpen]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status]);

  // ── Voice helpers ───────────────────────────────────────

  function startListening() {
    if (!speechSupported || isListening) return;
    setVoiceError(null);

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;

    const existing = input.trim();
    baseInputRef.current = existing ? `${existing} ` : '';
    transcriptRef.current = '';
    setIsListening(true);

    recognition.onresult = (event: any) => {
      let finalTranscript = transcriptRef.current;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0]?.transcript ?? '';
        if (event.results[i].isFinal) finalTranscript += t;
        else interim += t;
      }
      transcriptRef.current = finalTranscript;
      setInput(`${baseInputRef.current}${finalTranscript}${interim}`.trim());
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'not-allowed') {
        setVoiceError('Mic blocked. Click the 🔒 icon in your browser address bar → Site Settings → Allow Microphone, then try again.')
      } else {
        setVoiceError(`Voice input failed (${event.error}). Please try again.`)
      }
      setIsListening(false)
      recognitionRef.current = null
    }

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
      transcriptRef.current = '';
      baseInputRef.current = '';
    };

    recognitionRef.current = recognition;
    recognition.start();
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setIsListening(false);
  }

  // ── Attachment helpers ──────────────────────────────────

  const addPendingAttachments = (files: File[]) => {
    const next = files
      .filter((f) => f.type.startsWith('image/'))
      .map((f) => ({
        id: `attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file: f,
        previewUrl: URL.createObjectURL(f),
      }));
    if (!next.length) return;
    setPendingAttachments((prev) => [...prev, ...next]);
  };

  const removePendingAttachment = (id: string) => {
    setPendingAttachments((prev) => {
      const t = prev.find((a) => a.id === id);
      if (t) URL.revokeObjectURL(t.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  };

  const clearPendingAttachments = () => {
    pendingAttachments.forEach((a) => URL.revokeObjectURL(a.previewUrl));
    setPendingAttachments([]);
  };

  // ── Submit ──────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || status === 'analyzing' || status === 'acting') return;
    if (isListening) stopListening();

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
          ? { attachments: attachmentsForMessage.map((a) => ({ name: a.file.name, previewUrl: a.previewUrl })) }
          : undefined,
      },
    ]);

    if (attachmentsForMessage.length > 0) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'tool',
          content: `Using ${attachmentsForMessage.length} attached image${attachmentsForMessage.length > 1 ? 's' : ''}: ${attachmentsForMessage.map((a) => a.file.name).join(', ')}`,
        },
      ]);
      try {
        await agent.submitPromptWithImageContext(prompt, attachmentsForMessage.map((a) => a.file));
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

  // ── Collapsed FAB ───────────────────────────────────────

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

  const isBusy = status === 'analyzing' || status === 'acting';

  // ── Full panel ──────────────────────────────────────────

  return (
    <div className="fixed bottom-6 right-6 w-96 h-[600px] max-h-[80vh] bg-white rounded-2xl shadow-[0_8px_40px_rgb(0,0,0,0.16)] flex flex-col overflow-hidden z-50 border border-slate-200 font-sans backdrop-blur-xl bg-opacity-95">

      {/* Header */}
      <div className="h-14 bg-slate-900 flex items-center px-4 justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xl">✨</span>
          <h3 className="text-white font-medium text-sm">Design Copilot</h3>
          {modelState.ready ? (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-medium">Ready</span>
          ) : modelState.progress > 0 && modelState.progress < 1 ? (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 font-medium animate-pulse">{Math.round(modelState.progress * 100)}% Loading</span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={handleClear} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-white rounded hover:bg-slate-800 text-xs transition-colors" title="Reset">↺</button>
          <button onClick={() => setIsOpen(false)} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors">✕</button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 p-6 text-center space-y-3">
            <div className="w-12 h-12 bg-indigo-50 rounded-full flex items-center justify-center text-2xl mb-2 shadow-inner">🤖</div>
            <p className="text-sm font-medium text-slate-600">I am your UI Builder Agent.</p>
            <p className="text-xs">Attach photos, paste images, or tap the <span className="font-semibold text-indigo-500">🎤 mic</span> to speak your design commands.</p>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex flex-col text-sm w-full ${m.content.startsWith('USER:') ? 'items-end' : 'items-start'}`}>
            <div className={`
              px-3 py-2 rounded-2xl max-w-[85%]
              ${m.content.startsWith('USER:') ? 'bg-indigo-600 text-white rounded-br-sm' : ''}
              ${m.role === 'tool' ? 'bg-slate-100 text-slate-600 border border-slate-200 font-mono text-[11px] rounded-tl-sm w-full' : ''}
              ${m.role === 'assistant' && !m.content.startsWith('USER:') ? 'bg-white text-slate-800 shadow-sm border border-slate-100 rounded-bl-sm' : ''}
            `}>
              {m.content.replace('USER: ', '')}
              {m.metadata && Array.isArray(m.metadata.attachments) && (
                <div className="mt-2 pt-2 border-t border-slate-200/50 space-y-2">
                  <div className="text-[10px] uppercase tracking-wider opacity-80">Attached photos</div>
                  <div className="grid grid-cols-2 gap-2">
                    {m.metadata.attachments.map((a: MessageAttachment, idx: number) => (
                      <div key={`${a.name}-${idx}`} className="rounded-xl overflow-hidden border border-slate-200/60 bg-white/70">
                        <img src={a.previewUrl} alt={a.name} className="w-full h-20 object-cover" />
                        <div className="px-2 py-1 text-[10px] text-slate-600 truncate">{a.name}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}

        {status === 'analyzing' && (
          <div className="flex items-center gap-2 text-xs text-indigo-600 py-1 pl-2 font-medium">
            <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            Analyzing layout...
          </div>
        )}
        {status === 'acting' && (
          <div className="flex items-center gap-2 text-xs text-amber-600 py-1 pl-2 font-medium">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce" />
              <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            Executing tool...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <form onSubmit={handleSubmit} className="p-3 bg-white border-t border-slate-100 flex-shrink-0">

        {/* Pending image previews */}
        {pendingAttachments.length > 0 && (
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
            {pendingAttachments.map((a) => (
              <div key={a.id} className="relative shrink-0 w-20">
                <div className="rounded-2xl overflow-hidden border border-slate-200 bg-slate-50">
                  <img src={a.previewUrl} alt={a.file.name} className="w-20 h-20 object-cover" />
                </div>
                <button
                  type="button"
                  onClick={() => removePendingAttachment(a.id)}
                  className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center shadow"
                >
                  <CloseIcon size={12} />
                </button>
                <div className="mt-1 text-[10px] text-slate-500 truncate">{a.file.name}</div>
              </div>
            ))}
          </div>
        )}

        {/* Vision model loading */}
        {!visionModelState.ready && visionModelState.progress > 0 && (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Loading image model: {Math.round(visionModelState.progress * 100)}% {visionModelState.text}
          </div>
        )}

        {/* Voice error */}
        {voiceError && (
          <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-600 flex items-center justify-between">
            <span>{voiceError}</span>
            <button type="button" onClick={() => setVoiceError(null)} className="ml-2 text-red-400 hover:text-red-600">✕</button>
          </div>
        )}

        {/* Listening waveform indicator */}
        {isListening && (
          <div className="mb-2 rounded-lg bg-indigo-50 border border-indigo-200 px-3 py-1.5 text-xs text-indigo-600 flex items-center gap-2">
            <div className="flex gap-0.5 items-end h-4">
              {[0, 60, 120, 180, 240].map((delay) => (
                <span
                  key={delay}
                  className="w-0.5 bg-indigo-500 rounded-full animate-bounce"
                  style={{ height: '60%', animationDelay: `${delay}ms` }}
                />
              ))}
            </div>
            <span className="font-medium">Listening… speak your design command</span>
            <button type="button" onClick={stopListening} className="ml-auto text-indigo-400 hover:text-indigo-700 font-bold">✕</button>
          </div>
        )}

        {/* Controls row */}
        <div className="flex items-center gap-1.5" ref={attachMenuRef}>
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => { handleFileAttach(e.target.files); e.target.value = ''; }}
            className="hidden"
          />

          {/* Attach button */}
          <button
            type="button"
            onClick={() => setShowAttachMenu((p) => !p)}
            className="w-8 h-8 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors flex items-center justify-center flex-shrink-0"
            title="Attach image"
          >
            <Plus size={18} />
          </button>

          {showAttachMenu && (
            <div className="absolute left-3 bottom-16 w-48 rounded-2xl border border-slate-200 bg-white shadow-xl p-1 z-20">
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

          {/* Text input */}
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isBusy}
            placeholder={isBusy ? 'Agent is thinking…' : isListening ? 'Listening…' : 'Ask or speak 🎤'}
            className={`flex-1 min-w-0 px-3 py-2.5 bg-slate-50 border text-slate-900 placeholder:text-slate-400 rounded-xl text-sm outline-none transition-all disabled:opacity-50 ${
              isListening
                ? 'border-indigo-400 ring-1 ring-indigo-300 bg-indigo-50/30'
                : 'border-slate-200 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400'
            }`}
          />

          {/* Mic button */}
          {speechSupported && (
            <button
              type="button"
              onClick={() => (isListening ? stopListening() : startListening())}
              disabled={isBusy}
              title={isListening ? 'Stop listening' : 'Voice input'}
              className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all ${
                isListening
                  ? 'bg-red-500 text-white shadow-lg shadow-red-200'
                  : 'text-slate-400 hover:text-indigo-600 hover:bg-indigo-50'
              } disabled:opacity-40`}
            >
              {isListening ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
          )}

          {/* Send button */}
          <button
            type="submit"
            disabled={!input.trim() || isBusy}
            className="w-8 h-8 rounded-lg text-slate-400 hover:text-indigo-600 disabled:opacity-30 flex items-center justify-center hover:bg-indigo-50 transition-colors flex-shrink-0"
            title="Send"
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
    const ext = file.type.split('/')[1] || 'png';
    files.push(new File([file], file.name || `pasted-image.${ext}`, { type: file.type }));
  }
  return files;
}
