// ============================================================
// UI LAYER: AgentPanel — Unified AI Agent & P2P Network Sidebar
// ============================================================

import { useState, useRef, useEffect } from 'react'
import {
  Send, Bot, Loader2, CheckCircle2, XCircle,
  AlertCircle, Clock, Zap, ChevronDown, ChevronUp,
  Square, Copy, Check, Network, Activity, Wrench, Search, X
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

  const [activeTab, setActiveTab] = useState<'ai' | 'p2p'>('ai')
  const [input, setInput] = useState('')
  const [showPlan, setShowPlan] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [agentService, setAgentService] = useState<any>(null)

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
    }
    bootstrap()
  }, [])

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function handleSend() {
    if (!input.trim() || !agentService) return
    const prompt = input.trim()
    setInput('')

    if (isDistributed) {
      setActiveTab('p2p')
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
      orchestrator.onChange((updatedRt, updatedSt) => {
        pStore.getState().setRootTask(updatedRt)
        pStore.getState().setSubtasks(updatedSt)
        if (['completed', 'failed', 'cancelled'].includes(updatedRt.status)) setStatus('idle')
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

  return (
    <div className="flex flex-col h-full bg-surface-100 w-full">
      {/* Header Tabs with larger padding */}
      <div className="flex items-center px-4 border-b border-border bg-surface-200/50 flex-shrink-0 h-14">
        <button onClick={() => setActiveTab('ai')} className={`flex-1 flex items-center justify-center gap-2 h-full text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === 'ai' ? 'text-primary-300 border-b-2 border-primary-500 bg-surface-200' : 'text-text-dim hover:text-text-secondary'}`}>
          <Bot size={14} /> AI Agent
        </button>
        <button onClick={() => setActiveTab('p2p')} className={`flex-1 flex items-center justify-center gap-2 h-full text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === 'p2p' ? 'text-secondary-400 border-b-2 border-secondary-500 bg-surface-200' : 'text-text-dim hover:text-text-secondary'}`}>
          <Network size={14} /> P2P Network
        </button>
        <button onClick={() => setAgentPanelOpen(false)} className="px-2 text-text-dim hover:text-error transition-colors">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 custom-scrollbar">
        {activeTab === 'ai' ? (
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-surface-100">
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full ${modelReady ? 'bg-success animate-pulse-slow' : 'bg-warning animate-pulse'}`} />
                <span className="text-[10px] font-bold text-text-dim uppercase tracking-widest">Model</span>
              </div>
              <StatusBadge status={status} />
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
                  <span>Execution Plan</span>
                  {showPlan ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                </button>
                {showPlan && <div className="px-2 pb-2 space-y-0.5">{plan.map((step, i) => <PlanStep key={step.id} step={step} index={i} />)}</div>}
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center min-h-[200px] text-center opacity-40">
                  <Bot size={32} className="text-text-dim mb-4" />
                  <p className="text-[10px] font-bold uppercase tracking-widest">Agent Ready</p>
                </div>
              )}
              {messages.map((msg) => <ChatMessage key={msg.id} role={msg.role} content={msg.content} />)}
              {(status === 'executing' || status === 'planning') && (
                <div className="flex items-center gap-3 text-[11px] text-accent-300 animate-pulse-slow">
                  <Loader2 size={12} className="animate-spin" />
                  <span>{status === 'planning' ? 'Planning...' : 'Executing...'}</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>
        ) : (
          <div className="p-3 space-y-4 divide-y divide-border/50">
            {/* Local Node */}
            <div className="pb-4">
              <div className="text-[10px] uppercase font-black text-text-dim mb-2">Local Node</div>
              <div className="flex items-center justify-between bg-surface-200 p-2 rounded border border-border">
                <span className="text-[11px] font-mono text-text-primary truncate mr-2">{localPeerId || '...'}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-success/10 text-success uppercase font-black">{localState}</span>
              </div>
              <label className="flex items-center gap-2 mt-3 cursor-pointer group">
                <input type="checkbox" checked={acceptsRemoteTasks} onChange={(e) => setAcceptsRemoteTasks(e.target.checked)} className="accent-secondary-500 rounded" />
                <span className="text-[10px] font-medium text-text-secondary group-hover:text-text-primary transition-colors">Accept Remote Work</span>
              </label>
            </div>

            {/* Distributed Tasks */}
            {(rootTask || remoteSubtask) && (
              <div className="py-4">
                <div className="text-[10px] uppercase font-black text-text-dim mb-2 flex items-center gap-2">
                  <Activity size={10} className="text-primary-400" />
                  Orchestrator
                </div>
                {rootTask && (
                  <div className="mb-3">
                    <div className="text-[9px] text-primary-300 font-bold mb-1.5 px-2">LOCAL COORDINATOR</div>
                    <div className="space-y-1">{Array.from(subtasks.values()).map(s => <SubtaskRow key={s.id} subtask={s} />)}</div>
                  </div>
                )}
                {remoteSubtask && (
                  <div>
                    <div className="text-[9px] text-secondary-400 font-bold mb-1.5 px-2">REMOTE WORKER</div>
                    <SubtaskRow subtask={remoteSubtask} />
                  </div>
                )}
              </div>
            )}

            {/* Mesh */}
            <div className="py-4">
              <div className="text-[10px] uppercase font-black text-text-dim mb-2">Peer Mesh ({peers.size})</div>
              <div className="space-y-1.5">
                {peers.size === 0 ? <div className="text-[10px] text-text-dim italic text-center py-4 border border-dashed border-border rounded">No common nodes found.</div> :
                  Array.from(peers.values()).map(peer => {
                    const isStale = (Date.now() - peer.lastHeartbeat) > 8000
                    return (
                      <div key={peer.peerId} className="flex items-center justify-between p-2 rounded bg-surface-200 border border-border transition-all hover:border-border/60">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isStale ? 'bg-error' : peer.state === 'idle' ? 'bg-success' : 'bg-warning'}`} />
                          <span className="text-[11px] font-mono text-text-secondary truncate">{peer.peerId.split('-')[1]}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] text-text-dim font-bold">{(peer.reliabilityScore * 100).toFixed(0)}%</span>
                          <span className="text-[8px] uppercase bg-surface-300 px-1 py-0.5 rounded text-text-dim font-black">{peer.state}</span>
                        </div>
                      </div>
                    )
                  })
                }
              </div>
            </div>

            {/* Tool Activity */}
            <div className="py-4">
              <div className="text-[10px] uppercase font-black text-text-dim mb-2">Tool Bridge</div>
              <div className="space-y-1 max-h-40 overflow-y-auto pr-1 custom-scrollbar">
                {toolEntries.length === 0 && <div className="text-[9px] text-text-dim text-center py-2 opacity-50">Waiting for activity...</div>}
                {toolEntries.slice(-15).reverse().map(e => (
                  <div key={e.id} className="text-[9px] bg-surface-200 p-2 rounded border border-border/40">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-secondary-400 font-mono">@{e.workerPeerId.split('-')[1] || 'local'}</span>
                      <span className="text-[8px] text-text-dim">{new Date(e.at).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    </div>
                    <div className="text-primary-300 font-bold truncate">{e.tool}</div>
                    <div className="text-[8px] text-text-dim mt-0.5 truncate opacity-70">{JSON.stringify(e.args)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer Input */}
      <div className="px-3 py-3 border-t border-border bg-surface-100 flex-shrink-0 shadow-lg">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder={modelReady ? 'Command…' : 'Initializing…'}
            disabled={!modelReady || (status !== 'idle' && status !== 'error' && status !== 'done')}
            rows={2}
            className="flex-1 bg-surface-200 border border-border rounded-lg px-3 py-2 text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-primary-500/30 transition-all resize-none disabled:opacity-50"
          />
          <button onClick={handleSend} disabled={!modelReady || !input.trim() || (status !== 'idle' && status !== 'error' && status !== 'done')}
            className="p-3 bg-primary-600 hover:bg-primary-500 disabled:opacity-30 rounded-lg transition-all shadow-lg shadow-primary-500/20 text-white"
          >
            <Send size={14} />
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between px-1">
          <label className="flex items-center gap-1.5 cursor-pointer group">
            <input type="checkbox" checked={isDistributed} onChange={e => setDistributed(e.target.checked)} className="accent-primary-500 size-3 rounded" />
            <span className={`text-[9px] uppercase font-black ${isDistributed ? 'text-primary-400' : 'text-text-dim group-hover:text-text-secondary'}`}>Distributed Mode</span>
          </label>
          <span className="text-[8px] text-text-dim font-mono uppercase tracking-tighter">Qwen2.5-Coder (Offline)</span>
        </div>
      </div>
    </div>
  )
}
