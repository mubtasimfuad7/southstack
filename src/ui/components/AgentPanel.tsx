// ============================================================
// UI LAYER: AgentPanel — AI chat, plan, execution log
// ============================================================

import { useState, useRef, useEffect } from 'react'
import {
  Send, Bot, Loader2, CheckCircle2, XCircle,
  Clock, Zap, ChevronDown, ChevronUp,
  Square, Copy, Check, Mic, MicOff
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { useAgentStore } from '@/application/store'
import type { AgentStatus, AgentStep } from '@/core/interfaces/IAgentService'

function StatusBadge({ status }: { status: AgentStatus }) {
  const config: Record<AgentStatus, { label: string; color: string; icon: React.ReactNode }> = {
    idle: { label: 'Idle', color: 'text-text-dim', icon: <Clock size={10} /> },
    planning: { label: 'Planning', color: 'text-accent-400', icon: <Loader2 size={10} className="animate-spin" /> },
    executing: { label: 'Executing', color: 'text-warning', icon: <Zap size={10} /> },
    reflecting: { label: 'Reflecting', color: 'text-primary-300', icon: <Loader2 size={10} className="animate-spin" /> },
    done: { label: 'Done', color: 'text-success', icon: <CheckCircle2 size={10} /> },
    error: { label: 'Error', color: 'text-error', icon: <XCircle size={10} /> },
  }
  const cfg = config[status]
  return (
    <div className={`flex items-center gap-1 text-xs ${cfg.color}`}>
      {cfg.icon}
      <span>{cfg.label}</span>
    </div>
  )
}

function PlanStep({ step, index }: { step: AgentStep; index: number }) {
  const icons = {
    pending: <Clock size={11} className="text-text-dim" />,
    running: <Loader2 size={11} className="text-warning animate-spin" />,
    done: <CheckCircle2 size={11} className="text-success" />,
    error: <XCircle size={11} className="text-error" />,
  }
  return (
    <div className={`flex items-start gap-2 py-1.5 px-2 rounded text-xs transition-colors ${step.status === 'running' ? 'bg-warning/10 border border-warning/20' :
      step.status === 'done' ? 'bg-success/5' :
        step.status === 'error' ? 'bg-error/10 border border-error/20' : ''
      }`}>
      <div className="mt-0.5 flex-shrink-0">{icons[step.status]}</div>
      <div className="flex-1 min-w-0">
        <div className={`${step.status === 'done' ? 'text-text-dim line-through' : 'text-text-secondary'}`}>
          <span className="text-text-dim mr-1">{index + 1}.</span>
          {step.description}
        </div>
        {step.action && (
          <div className="mt-0.5 font-mono text-[10px] text-accent-400/80">
            → {step.action.tool}({JSON.stringify(step.action.input || {}).slice(0, 60)})
          </div>
        )}
        {step.error && (
          <div className="mt-0.5 text-error text-[10px]">✗ {step.error}</div>
        )}
      </div>
    </div>
  )
}

interface ChatMessageProps {
  role: 'user' | 'assistant'
  content: string
}

function CodeBlock({ language, value }: { language: string; value: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="group relative my-3 rounded-md overflow-hidden border border-border/40">
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface-300 border-b border-border/40">
        <span className="text-[10px] text-text-dim font-mono uppercase">{language || 'code'}</span>
        <button
          onClick={handleCopy}
          className="p-1 hover:bg-white/5 rounded transition-colors text-text-dim hover:text-text-primary"
          title="Copy code"
        >
          {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
        </button>
      </div>
      <SyntaxHighlighter
        language={language || 'text'}
        style={vscDarkPlus}
        customStyle={{
          margin: 0,
          padding: '12px',
          fontSize: '11px',
          lineHeight: '1.6',
          backgroundColor: 'transparent',
        }}
      >
        {value}
      </SyntaxHighlighter>
    </div>
  )
}

function ChatMessage({ role, content }: ChatMessageProps) {
  // Clean assistant response to hide technical JSON and show only the natural language part
  const displayContent = role === 'assistant'
    ? content.split(/```json|\{/)[0].trim()
    : content;

  if (!displayContent && role === 'assistant') return null;

  return (
    <div className={`flex gap-3 animate-fade-in ${role === 'user' ? 'justify-end' : 'justify-start'}`}>
      {role === 'assistant' && (
        <div className="w-6 h-6 rounded-full bg-primary-500/30 border border-primary-400/30 flex items-center justify-center flex-shrink-0 mt-0.5 shadow-lg shadow-primary-500/10">
          <Bot size={12} className="text-primary-300" />
        </div>
      )}
      <div className={`max-w-[90%] rounded-xl px-4 py-2.5 text-[11px] leading-relaxed shadow-sm ${role === 'user'
        ? 'bg-primary-500/20 border border-primary-400/20 text-text-primary'
        : 'bg-surface-200 border border-border text-text-secondary'
        }`}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ inline, className, children, ...props }: { inline?: boolean; className?: string; children: React.ReactNode }) {
              const match = /language-(\w+)/.exec(className || '')
              return !inline && match ? (
                <CodeBlock
                  language={match[1]}
                  value={String(children).replace(/\n$/, '')}
                />
              ) : (
                <code className="px-1.5 py-0.5 rounded bg-surface-300 text-primary-300 font-mono text-[10px]" {...props}>
                  {children}
                </code>
              )
            },
            p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
            ul: ({ children }) => <ul className="list-disc ml-4 mb-2 space-y-1">{children}</ul>,
            ol: ({ children }) => <ol className="list-decimal ml-4 mb-2 space-y-1">{children}</ol>,
            li: ({ children }) => <li>{children}</li>,
            strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
            h1: ({ children }) => <h1 className="text-sm font-bold mt-4 mb-2 text-text-primary border-b border-border pb-1">{children}</h1>,
            h2: ({ children }) => <h2 className="text-xs font-bold mt-4 mb-2 text-text-primary">{children}</h2>,
          }}
        >
          {displayContent}
        </ReactMarkdown>
      </div>
    </div>
  )
}

export function AgentPanel() {
  const {
    status, plan, messages, modelReady, modelProgress, modelProgressText,
  } = useAgentStore()

  const [input, setInput] = useState('')
  const [showPlan, setShowPlan] = useState(true)
  const [isListening, setIsListening] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [interimTranscript, setInterimTranscript] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Lazy-import agentService to avoid circular deps
  const [agentService, setAgentService] = useState<import('@/core/services/AgentService').AgentService | null>(null)

  useEffect(() => {
    async function bootstrap() {
      const { localModelProvider } = await import('@/execution/llm/LocalModelProvider')
      const { AgentService } = await import('@/core/services/AgentService')
      const { buildAgentTools } = await import('@/application/agentTools')
      const { useAgentStore: store } = await import('@/application/store')

      localModelProvider.onLoadProgress((p, text) => {
        store.getState().setModelProgress(p, text)
      })

      const svc = new AgentService(localModelProvider)
      buildAgentTools().forEach((t) => svc.registerTool(t))

      svc.onStatusChange((s) => store.getState().setStatus(s))
      svc.onPlanUpdate((steps) => store.getState().setPlan(steps))
      svc.onMessage((msg, role) => {
        if (role === 'assistant') {
          store.getState().appendToLastAssistantMessage(msg)
        } else {
          store.getState().addMessage(role, msg)
        }
      })

      setAgentService(svc)

      // Initialize model in background
      try {
        await localModelProvider.initialize()
        store.getState().setModelReady(true)
      } catch (err) {
        console.error('Model init failed:', err)
      }
    }
    bootstrap()
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Speech Recognition Setup
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition()
      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = 'en-US'

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognition.onresult = (event: any) => {
        setIsSpeaking(true)
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
        silenceTimerRef.current = setTimeout(() => setIsSpeaking(false), 1000)

        let interim = ''
        let final = ''

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            final += event.results[i][0].transcript
          } else {
            interim += event.results[i][0].transcript
          }
        }

        setInterimTranscript(interim)
        if (final) {
          setInput((prev) => (prev ? `${prev.trim()} ${final.trim()}` : final.trim()))
        }
      }

      recognition.onstart = () => setIsListening(true)
      recognition.onend = () => {
        setIsListening(false)
        setIsSpeaking(false)
        setInterimTranscript('')
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error)
        setIsListening(false)
        setIsSpeaking(false)
        setInterimTranscript('')
      }

      recognitionRef.current = recognition
    }
  }, [])

  function toggleListening() {
    if (!recognitionRef.current) return

    if (isListening) {
      recognitionRef.current.stop()
    } else {
      recognitionRef.current.start()
      setIsListening(true)
    }

    // Ensure focus returns to the textarea so 'Enter' key works
    setTimeout(() => {
      textareaRef.current?.focus()
    }, 10)
  }

  async function handleSend() {
    if (!input.trim() || !agentService) return

    // Auto-stop voice session on send
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop()
      setIsListening(false)
    }

    const prompt = input.trim()
    setInput('')
    // DO NOT addMessage here anymore! AgentService.start() will emit 'user' message, 
    // and the listener in useEffect will handle it correctly without duplication.
    await agentService.start(prompt)
  }

  return (
    <div className="flex flex-col h-full bg-panel border-l border-border">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${modelReady ? 'bg-success animate-pulse-slow' : 'bg-warning animate-pulse'}`} />
          <span className="text-xs font-semibold text-text-secondary uppercase tracking-widest">AI Agent</span>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* Model loading progress */}
      {!modelReady && (
        <div className="px-3 py-2 border-b border-border flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-text-dim truncate">{modelProgressText || 'Loading model…'}</span>
            <span className="text-[10px] text-primary-300 ml-2">{Math.round(modelProgress * 100)}%</span>
          </div>
          <div className="h-1 bg-surface-300 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-primary-500 to-accent-400 rounded-full transition-all duration-300"
              style={{ width: `${modelProgress * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Execution Plan */}
      {plan.length > 0 && (
        <div className="border-b border-border flex-shrink-0">
          <button
            onClick={() => setShowPlan((v) => !v)}
            className="flex items-center justify-between w-full px-3 py-2 text-xs text-text-secondary hover:text-text-primary hover:bg-white/3 transition-colors"
          >
            <span className="font-medium uppercase tracking-widest text-[10px]">Execution Plan</span>
            {showPlan ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
          {showPlan && (
            <div className="px-2 pb-2 space-y-0.5 max-h-48 overflow-y-auto">
              {plan.map((step, i) => (
                <PlanStep key={step.id} step={step} index={i} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <div className="w-10 h-10 rounded-full bg-primary-500/20 border border-primary-400/20 flex items-center justify-center">
              <Bot size={20} className="text-primary-300" />
            </div>
            <div>
              <p className="text-xs font-medium text-text-secondary">Southstack AI</p>
              <p className="text-[11px] text-text-dim mt-1">Describe what you want to build or fix</p>
            </div>
            <div className="flex flex-wrap justify-center gap-1.5 mt-2">
              {['Fix all TypeScript errors', 'Add authentication', 'Refactor this file', 'Write unit tests'].map((s) => (
                <button
                  key={s}
                  onClick={() => setInput(s)}
                  className="px-2 py-1 text-[10px] rounded-md bg-surface-200 border border-border text-text-secondary hover:text-text-primary hover:border-primary-400/40 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <ChatMessage key={msg.id} role={msg.role} content={msg.content} />
        ))}

        {/* Active Tool Badge (Cleaner "Thinking" UI) */}
        {(status === 'executing' || status === 'planning' || status === 'reflecting') && (
          <div className="flex items-start gap-3 animate-pulse-slow">
            <div className="w-6 h-6 rounded-full bg-accent-500/20 border border-accent-400/20 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Zap size={10} className="text-accent-300" />
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-surface-300 border border-border text-[10px] text-accent-300 font-medium flex items-center gap-2">
              <Loader2 size={10} className="animate-spin" />
              {status === 'planning' && 'Thinking...'}
              {status === 'reflecting' && 'Analyzing result...'}
              {status === 'executing' && (
                plan.find(s => s.status === 'running')?.description || 'Executing task...'
              )}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-4 border-t border-border flex-shrink-0 relative bg-surface-100">
        {/* Live Caption Overlay */}
        {isListening && (interimTranscript || isSpeaking) && (
          <div className="absolute -top-12 left-3 right-3 animate-fade-in z-20">
            <div className={`px-3 py-2 rounded-lg bg-primary-500/10 border border-primary-500/30 backdrop-blur-md text-[10px] text-primary-300 font-medium flex items-center gap-2 shadow-2xl ${isSpeaking ? 'animate-pulse-slow' : ''}`}>
              <Mic size={11} className={isSpeaking ? 'animate-pulse text-primary-400' : 'text-primary-300/50'} />
              <span className="truncate italic">
                {interimTranscript || (isSpeaking ? 'Listening...' : 'Thinking...')}
              </span>
            </div>
          </div>
        )}

        <div className="flex items-stretch gap-2 h-[88px]">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder={modelReady ? 'Talk to Southstack…' : 'Loading model…'}
              disabled={!modelReady || (status !== 'idle' && status !== 'error' && status !== 'done')}
              className={`w-full h-full bg-surface-200 border rounded-xl px-4 py-3 text-xs text-text-primary placeholder:text-text-dim focus:outline-none focus:border-primary-400/50 resize-none transition-all disabled:opacity-50 font-sans shadow-inner leading-relaxed ${isListening ? 'border-error/50 ring-1 ring-error/20' : 'border-border'
                }`}
            />
          </div>
          <div className="flex flex-col gap-1.5 justify-between">
            <button
              onClick={toggleListening}
              disabled={!modelReady}
              className={`p-2.5 cursor-pointer rounded-xl transition-all flex-shrink-0 border flex items-center justify-center ${isListening
                ? 'bg-error/20 border-error text-error shadow-lg shadow-error/10'
                : 'bg-surface-300 border-border text-text-dim hover:text-text-primary hover:border-primary-500/40'
                }`}
              style={{ height: 'calc(50% - 3px)' }}
              title={isListening ? 'Stop listening' : 'Voice input'}
            >
              {isListening ? (
                <div className={isSpeaking ? 'animate-pulse' : ''}>
                  <MicOff size={15} />
                </div>
              ) : (
                <Mic size={15} />
              )}
            </button>

            {status !== 'idle' && status !== 'done' && status !== 'error' ? (
              <button
                onClick={() => agentService?.stop()}
                className="p-2.5 bg-error/20 hover:bg-error/30 text-error rounded-xl transition-colors flex-shrink-0 border border-error/30 flex items-center justify-center"
                style={{ height: 'calc(50% - 3px)' }}
                title="Stop execution"
              >
                <Square size={15} fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!modelReady || !input.trim() || (status !== 'idle' && status !== 'error' && status !== 'done')}
                className="p-2.5 cursor-pointer bg-primary-500 hover:bg-primary-400 disabled:opacity-40 rounded-xl transition-colors flex-shrink-0 shadow-lg shadow-primary-500/20 flex items-center justify-center"
                style={{ height: 'calc(50% - 3px)' }}
                title="Send (Enter)"
              >
                <Send size={15} className="text-white" />
              </button>
            )}
          </div>
        </div>
        <p className="text-[10px] text-text-dim mt-1.5 text-center">
          Shift+Enter for newline • Enter to send • Qwen2.5-Coder (offline)
        </p>
      </div>
    </div>
  )
}
