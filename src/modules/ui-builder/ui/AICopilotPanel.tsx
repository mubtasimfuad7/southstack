import React, { useState, useEffect, useRef } from 'react';
import { AIAgentOrchestrator, AIResponse, AgentStatus } from '../ai/AIAgentOrchestrator';
import { localModelProvider } from '@/execution/llm/LocalModelProvider';

const agent = new AIAgentOrchestrator();

export const AICopilotPanel: React.FC = () => {
  const [messages, setMessages] = useState<AIResponse[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [isOpen, setIsOpen] = useState(false);
  const [modelState, setModelState] = useState({ ready: localModelProvider.isReady(), progress: 0, text: '' });
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubMsg = agent.onMessage((msg) => {
      setMessages(prev => [...prev, msg]);
    });
    const unsubStatus = agent.onStatusChange((newStatus) => {
      setStatus(newStatus);
    });
    
    const unsubProgress = localModelProvider.onLoadProgress((progress, text) => {
      setModelState({ ready: progress >= 1, progress, text });
    });

    return () => {
      unsubMsg();
      unsubStatus();
      unsubProgress();
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || status === 'analyzing' || status === 'acting') return;
    
    const prompt = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'assistant', content: `USER: ${prompt}` }]);
    
    await agent.submitPrompt(prompt);
  };

  const handleClear = () => {
    agent.clearHistory();
    setMessages([]);
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
      {/* Header */}
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

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 p-6 text-center space-y-3">
             <div className="w-12 h-12 bg-indigo-50 rounded-full flex items-center justify-center text-2xl mb-2 shadow-inner">🤖</div>
             <p className="text-sm font-medium text-slate-600">I am your UI Builder Agent.</p>
             <p className="text-xs">Ask me to generate a complete screen, add elements, or change styles like "make the primary button blue".</p>
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
              {m.metadata && (
                <div className="mt-1 pt-1 border-t border-slate-200/50 opacity-70 break-words whitespace-pre-wrap">
                  {JSON.stringify(m.metadata, null, 2)}
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
               <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce" style={{animationDelay: '150ms'}}></span>
               <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce" style={{animationDelay: '300ms'}}></span>
            </div>
            Executing tool...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-3 bg-white border-t border-slate-100 flex-shrink-0">
        <div className="relative flex items-center">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={status === 'analyzing' || status === 'acting'}
            placeholder={status === 'idle' ? "Describe what to build..." : "Agent is thinking..."}
            className="w-full pl-4 pr-10 py-2.5 bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 rounded-xl text-sm outline-none transition-all disabled:opacity-50"
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
