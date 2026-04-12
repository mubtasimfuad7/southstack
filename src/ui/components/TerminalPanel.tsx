// ============================================================
// UI LAYER: TerminalPanel — xterm.js + WebContainer integration
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { Terminal as TerminalIcon, X, ChevronDown } from 'lucide-react'
import { useTerminalStore } from '@/application/store'
import { contextBuilder } from '@/core/services/ContextBuilder'
import { runtimeService } from '@/core/services/RuntimeService'
import { fileSystemService } from '@/core/services/FileSystemService'

// Lazy-load xterm to avoid SSR issues
let XTerminal: typeof import('@xterm/xterm').Terminal | null = null
let FitAddon: typeof import('@xterm/addon-fit').FitAddon | null = null

async function loadXterm() {
  if (!XTerminal) {
    const [xtermMod, fitMod] = await Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
    ])
    XTerminal = xtermMod.Terminal
    FitAddon = fitMod.FitAddon
  }
  return { XTerminal, FitAddon }
}

const TERM_THEME = {
  background: '#0a0c10',
  foreground: '#e2e8f0',
  cursor: '#a78bfa',
  cursorAccent: '#0a0c10',
  selectionBackground: 'rgba(124,58,237,0.3)',
  black: '#1a1d23',
  red: '#ef4444',
  green: '#10b981',
  yellow: '#f59e0b',
  blue: '#3b82f6',
  magenta: '#a78bfa',
  cyan: '#22d3ee',
  white: '#e2e8f0',
  brightBlack: '#4a5568',
  brightRed: '#f87171',
  brightGreen: '#34d399',
  brightYellow: '#fbbf24',
  brightBlue: '#60a5fa',
  brightMagenta: '#c4b5fd',
  brightCyan: '#67e8f9',
  brightWhite: '#f8fafc',
}

export function TerminalPanel() {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<InstanceType<typeof import('@xterm/xterm').Terminal> | null>(null)
  const fitAddonRef = useRef<InstanceType<typeof import('@xterm/addon-fit').FitAddon> | null>(null)
  const { isOpen, setOpen } = useTerminalStore()
  const [initialized, setInitialized] = useState(false)
  const [cmdBuffer, setCmdBuffer] = useState('')

  useEffect(() => {
    if (!isOpen) return

    let mounted = true

    async function init() {
      const { XTerminal: Term, FitAddon: Fit } = await loadXterm()
      if (!mounted || !terminalRef.current || xtermRef.current) return

      const term = new Term!({
        theme: TERM_THEME,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 12,
        lineHeight: 1.4,
        cursorBlink: true,
        cursorStyle: 'bar',
        scrollback: 1000,
        allowTransparency: true,
      })

      const fit = new Fit!()
      term.loadAddon(fit)
      term.open(terminalRef.current)
      fit.fit()

      xtermRef.current = term
      fitAddonRef.current = fit

      term.write('\r\n  \x1b[35m▸\x1b[0m \x1b[36mSouthstack Terminal\x1b[0m\r\n')
      term.write('  \x1b[90mBooting WebContainer...\x1b[0m\r\n')

      const statusHandler = (e: Event) => {
        const { message, type } = (e as CustomEvent).detail
        const color = type === 'success' ? '\x1b[32m' : type === 'error' ? '\x1b[31m' : '\x1b[36m'
        const symbol = type === 'success' ? '✓' : type === 'error' ? '✖' : '▸'
        term.write(`  ${color}${symbol} ${message}\x1b[0m\r\n`)
      }
      window.addEventListener('webcontainer:boot-status', statusHandler)

      try {
        const shellProcess = await runtimeService.spawnShell()
        term.write('\x1b[32m  ✓ WebContainer Ready (Node.js, npm)\x1b[0m\r\n\r\n')

        // Pipe WebContainer output to xterm
        shellProcess.output.pipeTo(new WritableStream({
          write(data) {
            term.write(data)
            contextBuilder.appendTerminalOutput(data)
          }
        }))

        const input = shellProcess.input.getWriter()

        // Pipe xterm keystrokes to WebContainer input
        term.onData((data) => {
          input.write(data)
          // If Enter is pressed, trigger a bi-directional sync after a small delay
          if (data.includes('\r')) {
            setTimeout(() => {
              fileSystemService.pullFromWebContainer()
            }, 600)
          }
        })

        // Listen for agent terminal:run events (optional: inject into stdin)
        window.addEventListener('terminal:run', (e) => {
          const cmd = (e as CustomEvent).detail.command as string
          input.write(`${cmd}\r\n`)
        })

      } catch (err) {
        term.write(`\r\n\x1b[31mError booting WebContainer: ${err}\x1b[0m\r\n`)
      }

      setInitialized(true)

      // Store handler for cleanup
      ;(init as any).statusHandler = statusHandler
    }

    init()

    return () => {
      mounted = false
      if ((init as any).statusHandler) {
        window.removeEventListener('webcontainer:boot-status', (init as any).statusHandler)
      }
    }
  }, [isOpen])

  useEffect(() => {
    const resizeObs = new ResizeObserver(() => {
      fitAddonRef.current?.fit()
    })
    if (terminalRef.current) resizeObs.observe(terminalRef.current)
    return () => resizeObs.disconnect()
  }, [initialized])

  if (!isOpen) return null

  return (
    <div className="flex flex-col h-full bg-surface-400 border-t border-border">
      {/* Terminal tab bar */}
      <div className="flex items-center justify-between px-3 py-1 bg-surface-200 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <TerminalIcon size={12} className="text-accent-400" />
          <span className="text-xs text-text-secondary font-medium">Terminal</span>
          <div className="flex items-center gap-1 ml-2">
            <div className="px-2 py-0.5 bg-surface-300 rounded text-xs text-text-primary border border-border">
              bash
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setOpen(false)}
            className="p-1 rounded hover:bg-white/5 text-text-dim hover:text-text-secondary transition-colors"
          >
            <ChevronDown size={12} />
          </button>
          <button
            onClick={() => setOpen(false)}
            className="p-1 rounded hover:bg-error/20 text-text-dim hover:text-error transition-colors"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* xterm.js container */}
      <div className="flex-1 relative overflow-hidden p-2">
        <div ref={terminalRef} className="h-full" />
      </div>
    </div>
  )
}
