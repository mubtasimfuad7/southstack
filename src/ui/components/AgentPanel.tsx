// ============================================================
// UI LAYER: AgentPanel — Unified AI Agent & P2P Network Sidebar
// ============================================================

import { useState, useRef, useEffect } from 'react'
import {
  Send, Bot, Loader2, CheckCircle2, XCircle,
  AlertCircle, Clock, Zap, ChevronDown, ChevronUp,
  Square, Copy, Check, Network, Activity, Wrench, Search, X, Mic, MicOff
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import {
  useAgentStore,
  usePeerStore,
  useP2PTaskStore,
  useToolLogStore
} from '@/application/store'
import type { AgentStatus, AgentStep } from '@/core/interfaces/IAgentService'
import type { PeerStatus, Subtask } from '@/core/tasks/taskTypes'

// ──────────────────────────────────────────────────────────
// Shared Components
// ──────────────────────────────────────────────────────────

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
    <div className={`flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider ${cfg.color}`}>
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
        <button onClick={handleCopy} className="p-1 hover:bg-white/5 rounded transition-colors text-text-dim hover:text-text-primary">
          {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
        </button>
      </div>
      <SyntaxHighlighter language={language || 'text'} style={vscDarkPlus} customStyle={{ margin: 0, padding: '12px', fontSize: '11px', lineHeight: '1.6', backgroundColor: 'transparent' }}>
        {value}
      </SyntaxHighlighter>
    </div>
  )
}

function ChatMessage({ role, content }: { role: 'user' | 'assistant', content: string }) {
  const displayContent = role === 'assistant' ? content.split(/```json|\{/)[0].trim() : content;
  if (!displayContent && role === 'assistant') return null;

  return (
    <div className={`flex gap-3 animate-fade-in ${role === 'user' ? 'justify-end' : 'justify-start'}`}>
      {role === 'assistant' && (
        <div className="w-6 h-6 rounded-full bg-primary-500/30 border border-primary-400/30 flex items-center justify-center flex-shrink-0 mt-0.5 shadow-lg shadow-primary-500/10">
          <Bot size={12} className="text-primary-300" />
        </div>
      )}
      <div className={`max-w-[90%] rounded-xl px-4 py-2.5 text-[11px] leading-relaxed shadow-sm ${role === 'user' ? 'bg-primary-500/20 border border-primary-400/20 text-text-primary' : 'bg-surface-200 border border-border text-text-secondary'}`}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ node, inline, className, children, ...props }: any) {
              const match = /language-(\w+)/.exec(className || '')
              return !inline && match ? (
                <CodeBlock language={match[1]} value={String(children).replace(/\n$/, '')} />
              ) : (
                <code className="px-1.5 py-0.5 rounded bg-surface-300 text-primary-300 font-mono text-[10px]" {...props}>{children}</code>
              )
            },
            p: ({ children }: any) => <p className="mb-2 last:mb-0">{children}</p>,
            ul: ({ children }: any) => <ul className="list-disc ml-4 mb-2 space-y-1">{children}</ul>,
            li: ({ children }: any) => <li>{children}</li>,
          }}
        >
          {displayContent}
        </ReactMarkdown>
      </div>
    </div>
  )
}

function SubtaskRow({ subtask }: { subtask: Subtask }) {
  const stateIcons: Record<string, React.ReactNode> = {
    queued: <Clock size={10} className="text-text-dim" />,
    in_progress: <Zap size={10} className="text-warning animate-pulse" />,
    completed: <CheckCircle2 size={10} className="text-success" />,
    failed: <XCircle size={10} className="text-error" />,
    requeued: <Search size={10} className="text-primary-400" />
  }
  const [showWorkerThinking, setShowWorkerThinking] = useState(false)

  return (
    <div className="text-[11px] bg-surface-200 p-2 rounded border border-border mb-1">
      <div className="flex items-start gap-2">
        <div className="mt-0.5">{stateIcons[subtask.status] || <Clock size={10} />}</div>
        <div className="flex-1 min-w-0">
          <div className="text-text-primary font-medium">{subtask.title}</div>
          {subtask.assignedPeerId && (
            <div className="text-[9px] text-text-dim font-mono mt-0.5 flex items-center gap-1.5">
              <span className="px-1 py-0.5 bg-surface-300 rounded text-primary-300">@{subtask.assignedPeerId.split('-')[1]}</span>
              {subtask.progress !== undefined && <span>• {subtask.progress}%</span>}
              {subtask.statusText && <span className="truncate">• {subtask.statusText}</span>}
            </div>
          )}
          {(subtask.workerThinkingHistory?.length ? subtask.workerThinkingHistory.length > 0 : subtask.workerThinking) && (
            <div className="mt-2">
              <button
                onClick={() => setShowWorkerThinking(!showWorkerThinking)}
                className="text-[9px] text-primary-300 hover:text-primary-400 font-mono hover:underline"
              >
                {showWorkerThinking ? '▼' : '▶'} Model Thinking History ({subtask.workerThinkingHistory?.length || 1} iterations)
              </button>
              {showWorkerThinking && (
                <div className="mt-1 space-y-2 text-[8px]">
                  {(subtask.workerThinkingHistory || [subtask.workerThinking]).map((think, idx) => think && (
                    <div key={think.iteration} className="border-l border-primary-500/20 pl-2">
                      <div className="text-primary-400 font-bold mb-1">Iteration {think.iteration}</div>
                      {think.modelResponse && (
                        <div className="bg-surface-300/50 p-1.5 rounded font-mono text-text-secondary break-words max-h-[100px] overflow-y-auto mb-1">
                          {think.modelResponse}
                        </div>
                      )}
                      {think.toolCall && (
                        <div className="bg-warning/10 border border-warning/30 p-1 rounded">
                          <div className="text-warning font-bold">Tool: {think.toolCall.tool}</div>
                          <div className="text-text-dim font-mono mt-0.5">
                            {JSON.stringify(think.toolCall.input).slice(0, 150)}...
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function AgentPanel() {
  const {
    status, plan, messages, modelReady, modelProgress, modelProgressText,
    isDistributed, setDistributed, addMessage, setStatus, setAgentPanelOpen
  } = useAgentStore()

  const { localPeerId, localState, acceptsRemoteTasks, setAcceptsRemoteTasks, networkConnected, peers } = usePeerStore()
  const { rootTask, subtasks, remoteSubtask } = useP2PTaskStore()
  const { entries: toolEntries } = useToolLogStore()

  const [input, setInput] = useState('')
  const [showPlan, setShowPlan] = useState(true)
  const [activeTab, setActiveTab] = useState<'chat' | 'network'>('chat')
  const [isListening, setIsListening] = useState(false)
  const [speechError, setSpeechError] = useState<string | null>(null)
  const [ragStatus, setRagStatus] = useState<string>('idle')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [agentService, setAgentService] = useState<any>(null)
  const recognitionRef = useRef<any>(null)
  const transcriptRef = useRef('')
  const baseInputRef = useRef('')
  const stopRequestedRef = useRef(false)
  const pendingSendAfterStopRef = useRef<string | null>(null)
  const activeOrchestratorRef = useRef<any>(null)

  const speechSupported =
    typeof window !== 'undefined' &&
    Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)

  useEffect(() => {
    async function bootstrap() {
      const [{ localModelProvider }, { AgentService }, { buildAgentTools }, { peerStateStore }] = await Promise.all([
        import('@/execution/llm/LocalModelProvider'),
        import('@/core/services/AgentService'),
        import('@/application/agentTools'),
        import('@/core/peers/PeerStateStore')
      ])

      localModelProvider.onLoadProgress((p, text) => useAgentStore.getState().setModelProgress(p, text))
      const svc = new AgentService(localModelProvider)
      buildAgentTools().forEach((t) => svc.registerTool(t))
      svc.onStatusChange((s) => useAgentStore.getState().setStatus(s))
      svc.onPlanUpdate((steps) => useAgentStore.getState().setPlan(steps))
      svc.onMessage((msg, role) => {
        if (role === 'assistant') useAgentStore.getState().appendToLastAssistantMessage(msg)
        else useAgentStore.getState().addMessage(role, msg)
      })
      setAgentService(svc)

      try {
        await localModelProvider.initialize()
        useAgentStore.getState().setModelReady(true)
        peerStateStore.setLocalState('idle')
      } catch (err) { console.error('Model init failed:', err) }

      // Initialize RAG in background after LLM is ready
      try {
        const { ragService } = await import('@/core/services/RAGService')
        ragService.onStatusChange((s, detail) => setRagStatus(detail ?? s))
        ragService.initialize().catch(console.warn)
      } catch (err) { console.warn('RAG init failed:', err) }
    }
    bootstrap()
  }, [])

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.onresult = null
        recognitionRef.current.onend = null
        recognitionRef.current.onerror = null
        recognitionRef.current.stop()
      }
    }
  }, [])

  async function handleSendPrompt(rawPrompt: string) {
    if (!agentService) return
    const prompt = rawPrompt.trim()
    if (!prompt) return

    setInput('')

    if (isDistributed) {
      const [{ TaskOrchestrator }, { useP2PTaskStore: pStore }, { localModelProvider }, { peerNetworkManager }] = await Promise.all([
        import('@/core/tasks/TaskOrchestrator'),
        import('@/application/store'),
        import('@/execution/llm/LocalModelProvider'),
        import('@/core/network/PeerNetworkManager')
      ])

      const rt = {
        id: `rt-${Math.random().toString(36).slice(2, 8)}`,
        ownerPeerId: peerNetworkManager.getLocalPeerId(),
        prompt,
        status: 'planning' as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        subtaskIds: [],
      }

      const orchestrator = new TaskOrchestrator(rt, localModelProvider)
      activeOrchestratorRef.current = orchestrator
      orchestrator.onChange((updatedRt, updatedSt) => {
        pStore.getState().setRootTask(updatedRt)
        pStore.getState().setSubtasks(updatedSt)
        if (['completed', 'failed', 'cancelled'].includes(updatedRt.status)) {
          setStatus('idle')
          activeOrchestratorRef.current = null
        }
        else if (updatedRt.status === 'planning') setStatus('planning')
        else setStatus('executing')
      })

      pStore.getState().setRootTask(rt)
      setStatus('planning')
      addMessage('assistant', `Decomposing task for peer distribution... Switched to **P2P Network** tab.`)
      await orchestrator.start()
    } else {
      await agentService.start(prompt)
    }
  }

  function handleCancel() {
    if (activeOrchestratorRef.current) {
      activeOrchestratorRef.current.cancel()
      activeOrchestratorRef.current = null
      setStatus('idle')
      addMessage('assistant', 'Task execution cancelled by user.')
    } else if (status !== 'idle') {
      agentService?.stop()
      setStatus('idle')
      addMessage('assistant', 'Local agent execution stopped.')
    }
  }

  async function handleSend() {
    if (isListening) {
      pendingSendAfterStopRef.current = input
      stopSpeechRecognition()
      return
    }

    await handleSendPrompt(input)
  }

  function startSpeechRecognition() {
    if (!speechSupported) {
      setSpeechError('Voice input is not supported in this browser.')
      return
    }

    if (isListening) {
      return
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    const recognition = new SpeechRecognition()
    recognition.lang = 'en-US'
    recognition.continuous = true
    recognition.interimResults = true

    const existingInput = input.trim()
    baseInputRef.current = existingInput ? `${existingInput} ` : ''
    transcriptRef.current = ''
    stopRequestedRef.current = false
    setSpeechError(null)
    setIsListening(true)

    recognition.onresult = (event: any) => {
      let finalTranscript = transcriptRef.current
      let interimTranscript = ''

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const transcript = event.results[i][0]?.transcript ?? ''
        if (event.results[i].isFinal) finalTranscript += transcript
        else interimTranscript += transcript
      }

      transcriptRef.current = finalTranscript
      setInput(`${baseInputRef.current}${finalTranscript}${interimTranscript}`.trim())
    }

    recognition.onerror = (event: any) => {
      setSpeechError(event.error === 'not-allowed'
        ? 'Microphone access was blocked.'
        : 'Voice input failed. Please try again.')
      stopRequestedRef.current = false
      setIsListening(false)
      recognitionRef.current = null
      pendingSendAfterStopRef.current = null
    }

    recognition.onend = () => {
      setIsListening(false)
      recognitionRef.current = null
      stopRequestedRef.current = false
      transcriptRef.current = ''
      baseInputRef.current = ''

      const pendingPrompt = pendingSendAfterStopRef.current
      pendingSendAfterStopRef.current = null
      if (pendingPrompt?.trim()) {
        void handleSendPrompt(pendingPrompt)
      }
    }

    recognitionRef.current = recognition
    recognition.start()
  }

  function stopSpeechRecognition() {
    if (!isListening) return
    stopRequestedRef.current = true
    recognitionRef.current?.stop()

    // Fallback in case the browser delays the native onend callback.
    window.setTimeout(() => {
      if (!stopRequestedRef.current) return
      setIsListening(false)
      recognitionRef.current = null
      stopRequestedRef.current = false
      const pendingPrompt = pendingSendAfterStopRef.current
      pendingSendAfterStopRef.current = null
      if (pendingPrompt?.trim()) {
        void handleSendPrompt(pendingPrompt)
      }
    }, 400)
  }

  function handleMicToggle() {
    if (isListening) stopSpeechRecognition()
    else startSpeechRecognition()
  }

  const canInteract = modelReady && (status === 'idle' || status === 'error' || status === 'done')

  return (
    <div className="flex flex-col h-full bg-surface-100 w-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 border-b border-border bg-surface-200/50 flex-shrink-0 h-14">
        <div className="flex items-center gap-4 h-full">
          <button 
            onClick={() => setActiveTab('chat')} 
            className={`h-full flex items-center gap-2 border-b-2 font-bold uppercase tracking-widest text-[10px] transition-colors ${activeTab === 'chat' ? 'border-primary-400 text-primary-400' : 'border-transparent text-text-dim hover:text-text-primary'}`}
          >
            <Bot size={16} /> Local Chat
          </button>
          <button 
            onClick={() => setActiveTab('network')} 
            className={`h-full flex items-center gap-2 border-b-2 font-bold uppercase tracking-widest text-[10px] transition-colors ${activeTab === 'network' ? 'border-secondary-400 text-secondary-400' : 'border-transparent text-text-dim hover:text-text-primary'}`}
          >
            <Network size={16} /> Distributed Activity
          </button>
        </div>
        <button onClick={() => setAgentPanelOpen(false)} className="px-2 text-text-dim hover:text-error transition-colors">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 custom-scrollbar flex flex-col">
        {activeTab === 'chat' && (
          <>
        {/* Top: Model Status & Chat */}
        <div className="flex flex-col flex-shrink-0">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-surface-100">
            <div className="flex items-center gap-2">
              <div className={`w-1.5 h-1.5 rounded-full ${modelReady ? 'bg-success animate-pulse-slow' : 'bg-warning animate-pulse'}`} />
              <span className="text-[10px] font-bold text-text-dim uppercase tracking-widest">Model</span>
            </div>
            <div className="flex items-center gap-2">
              {status !== 'idle' && (
                <button
                  onClick={handleCancel}
                  className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-error/10 text-error border border-error/20 hover:bg-error hover:text-white transition-all text-[9px] font-bold uppercase tracking-wider"
                >
                  <X size={10} /> Stop Task
                </button>
              )}
              {ragStatus && ragStatus !== 'idle' && (
                <div className={`flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full border font-mono ${
                  ragStatus.includes('ready') || ragStatus.includes('Indexed')
                    ? 'text-success border-success/30 bg-success/10'
                    : ragStatus.includes('error')
                    ? 'text-error border-error/30 bg-error/10'
                    : 'text-accent-400 border-accent-400/30 bg-accent-400/10'
                }`}>
                  <span className={`w-1 h-1 rounded-full ${ragStatus.includes('ready') || ragStatus.includes('Indexed') ? 'bg-success' : 'bg-accent-400 animate-pulse'}`} />
                  RAG: {ragStatus.slice(0, 24)}
                </div>
              )}
              <StatusBadge status={status} />
            </div>
          </div>

          {!modelReady && (
            <div className="px-3 py-2 border-b border-border bg-black/10">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] text-text-dim uppercase">{modelProgressText || 'Loading…'}</span>
                <span className="text-[9px] text-primary-300 font-mono">{Math.round(modelProgress * 100)}%</span>
              </div>
              <div className="h-1 bg-surface-300 rounded-full overflow-hidden">
                <div className="h-full bg-primary-500 transition-all duration-300" style={{ width: `${modelProgress * 100}%` }} />
              </div>
            </div>
          )}

          {plan.length > 0 && (
            <div className="border-b border-border bg-surface-50">
              <button onClick={() => setShowPlan(!showPlan)} className="flex items-center justify-between w-full px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest text-text-dim hover:bg-white/3">
                <span className="flex items-center gap-2"><CheckCircle2 size={12} /> Execution Plan</span>
                {showPlan ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              </button>
              {showPlan && <div className="px-2 pb-2 space-y-0.5">{plan.map((step, i) => <PlanStep key={step.id} step={step} index={i} />)}</div>}
            </div>
          )}
        </div>

        <div className="px-3 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center min-h-[150px] text-center opacity-40">
              <Bot size={32} className="text-text-dim mb-4" />
              <p className="text-[10px] font-bold uppercase tracking-widest">Agent Ready</p>
            </div>
          )}
          {messages.map((msg) => <ChatMessage key={msg.id} role={msg.role} content={msg.content} />)}
          {(status === 'executing' || status === 'planning') && (
            <div className="space-y-2">
              <div className="flex items-center gap-3 text-[11px] text-accent-300 animate-pulse-slow">
                <Loader2 size={12} className="animate-spin" />
                <span>{status === 'planning' ? 'Planning...' : 'Executing...'}</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
        </>
        )}

        {/* Distributed Activity Section */}
        {activeTab === 'network' && (
          <div className="p-4 space-y-6 bg-surface-100 animate-fade-in divide-y divide-border/30 overflow-y-auto custom-scrollbar flex-1">
                {/* Peer Mesh Summary */}
                <div className="pb-4">
                  <div className="text-[9px] uppercase font-black text-text-dim mb-2 flex items-center justify-between">
                    Mesh Status
                    <span className="text-success text-[8px] flex items-center gap-1"><div className="w-1 h-1 rounded-full bg-success"></div> Connected</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from(peers.values()).map(peer => (
                      <div key={peer.peerId} className="flex items-center gap-1.5 px-2 py-1 bg-surface-200 border border-border rounded text-[9px] font-mono">
                        <div className={`w-1 h-1 rounded-full ${(Date.now() - peer.lastHeartbeat) > 8000 ? 'bg-error' : 'bg-success'}`} />
                        <span className="text-text-secondary">{peer.peerId.split('-')[1]}</span>
                      </div>
                    ))}
                    {peers.size === 0 && <span className="text-text-dim italic text-[9px]">Isolated Node</span>}
                  </div>
                </div>

                {/* Orchestrator */}
                {(rootTask || remoteSubtask) && (
                  <div className="py-4">
                    <div className="text-[9px] uppercase font-black text-text-dim mb-2">Live Orchestration</div>
                    {rootTask && (
                      <div className="space-y-1">{Array.from(subtasks.values()).map(s => <SubtaskRow key={s.id} subtask={s} />)}</div>
                    )}
                    {remoteSubtask && (
                      <div className="mt-2 text-secondary-300 font-bold text-[9px]">Assigned to you: <SubtaskRow subtask={remoteSubtask} /></div>
                    )}
                  </div>
                )}

                {/* Recent Tool Activity */}
                {toolEntries.length > 0 && (
                  <div className="py-4">
                    <div className="text-[9px] uppercase font-black text-text-dim mb-2">Tool Bridge Activity</div>
                    <div className="space-y-0.5">
                      {toolEntries.slice(0, 5).map(e => (
                        <div key={e.id} className="text-[8px] flex items-center justify-between text-text-dim border-b border-border/10 py-0.5">
                          <span className="text-primary-300 font-bold">{e.tool}</span>
                          <span className="opacity-50">@{e.workerPeerId.split('-')[1] || 'local'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
          </div>
        )}
      </div>

      {/* Footer Input */}
      <div className="px-4 py-4 border-t border-border bg-surface-100 flex-shrink-0 shadow-lg" style={{ display: activeTab === 'chat' ? 'block' : 'none' }}>
        {speechError && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-[10px] text-error">
            <AlertCircle size={12} />
            <span>{speechError}</span>
          </div>
        )}

        {/* Modern Unified Input Card */}
        <div className="relative flex flex-col bg-surface-200 border border-border rounded-2xl focus-within:border-primary-500/40 focus-within:ring-2 focus-within:ring-primary-500/10 transition-all shadow-inner group">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder={modelReady ? 'Type your command…' : 'Initializing model…'}
            disabled={!canInteract}
            rows={3}
            className="w-full bg-transparent border-none outline-none px-4 py-4 text-[13px] leading-relaxed text-text-primary placeholder:text-text-dim/60 focus:ring-0 resize-none min-h-[100px] disabled:opacity-50"
          />

          <div className="flex items-center justify-between px-3 py-2 border-t border-border/10 bg-surface-200/40 rounded-b-2xl">
            <div className="flex items-center gap-1.5 min-w-0">
              <button
                onClick={handleMicToggle}
                disabled={!canInteract || !speechSupported}
                title={isListening ? 'Stop voice input' : 'Start voice input'}
                className={`flex items-center justify-center p-2 rounded-lg transition-all border ${isListening
                    ? 'bg-error text-white border-error shadow-lg shadow-error/20'
                    : 'bg-surface-300/40 border-transparent text-text-dim hover:text-text-primary hover:bg-surface-300'
                  } disabled:opacity-30`}
              >
                {isListening ? <MicOff size={16} /> : <Mic size={16} />}
              </button>

              <div className="h-4 w-[1px] bg-border mx-1" />

              <div className="flex items-center gap-1.5 px-2 py-1 bg-surface-300/30 rounded-md border border-border/50 text-[9px] font-black tracking-tight text-primary-400 select-none whitespace-nowrap overflow-hidden">
                <CheckCircle2 size={10} className="text-primary-400" /> Distributed
              </div>

              <span className={`text-[9px] uppercase font-bold truncate ${isListening ? 'text-error animate-pulse' : 'text-text-dim'} hidden sm:inline-block`}>
                {isListening ? 'Listening…' : speechSupported ? 'Voice ready' : 'Voice unavailable'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[8px] text-text-dim font-mono uppercase tracking-tighter opacity-50 mr-1 hidden lg:inline-block">Qwen2.5-Coder</span>
              <button
                onClick={handleSend}
                disabled={!input.trim() || !canInteract}
                title="Send Command"
                className="h-10 px-4 flex items-center justify-center gap-2 rounded-xl bg-primary-600 hover:bg-primary-500 disabled:opacity-30 transition-all shadow-lg shadow-primary-500/20 text-white font-bold text-[11px]"
              >
                <span>Send</span>
                <Send size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
