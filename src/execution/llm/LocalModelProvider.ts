// ============================================================
// EXECUTION LAYER: LocalModelProvider
// Uses @mlc-ai/web-llm. Model is loaded once, cached in IDB.
// Runs inside a WebWorker to never block the UI thread.
// ============================================================

import type { ModelProvider, ModelGenerateOptions, ChatMessage } from '@/core/interfaces/IModelProvider'

// We use web-llm's MLCEngine directly in a worker via postMessage bridge.
// This file is the MAIN THREAD PROXY — it talks to the worker.

export const DEFAULT_MODEL = 'Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC'

export class LocalModelProvider implements ModelProvider {
  private worker: Worker | null = null
  private ready = false
  private loadProgress = 0
  private modelName = DEFAULT_MODEL
  private pendingResolvers: Map<string, { resolve: (v: string) => void; reject: (e: Error) => void; onToken?: (t: string) => void }> = new Map()
  private progressListeners: Set<(progress: number, text: string) => void> = new Set()
  private busy = false
  private activeRequestId: string | null = null
  private busyListeners: Set<(busy: boolean) => void> = new Set()
  private readyListeners: Set<(ready: boolean) => void> = new Set()

  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.worker = new Worker(new URL('./llm.worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (e) => this._handleMessage(e.data, resolve, reject)
      this.worker.onerror = (e) => reject(new Error(e.message))
      this.worker.postMessage({ type: 'init', modelName: this.modelName })
    })
  }

  async generate(messages: ChatMessage[], options?: ModelGenerateOptions): Promise<string> {
    return this.generateStream(messages, options?.onToken ?? (() => { }), options)
  }

  async generateStream(
    messages: ChatMessage[],
    onToken: (token: string) => void,
    options?: ModelGenerateOptions
  ): Promise<string> {
    if (!this.worker || !this.ready) throw new Error('Model not initialized')

    if (this.activeRequestId) {
      const previous = this.pendingResolvers.get(this.activeRequestId)
      this.abort()
      previous?.reject(new Error('Generation preempted by a newer local request'))
      this.pendingResolvers.delete(this.activeRequestId)
      this.activeRequestId = null
      this._setBusy(false)
    }

    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`
    this.activeRequestId = requestId
    this._setBusy(true)

    return new Promise((resolve, reject) => {
      this.pendingResolvers.set(requestId, { resolve, reject, onToken })
      this.worker!.postMessage({
        type: 'generate',
        requestId,
        messages,
        maxTokens: options?.maxTokens ?? 2048,
        temperature: options?.temperature ?? 0.2,
      })
    })
  }

  abort(): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'abort' })
    }
  }

  isBusyGenerating(): boolean {
    return this.busy
  }

  onBusyChange(cb: (busy: boolean) => void): () => void {
    this.busyListeners.add(cb)
    return () => this.busyListeners.delete(cb)
  }

  onReadyChange(cb: (ready: boolean) => void): () => void {
    this.readyListeners.add(cb)
    return () => this.readyListeners.delete(cb)
  }

  isReady(): boolean { return this.ready }
  getModelName(): string { return this.modelName }
  getLoadProgress(): number { return this.loadProgress }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    this._setReady(false)
    this.activeRequestId = null
    this._setBusy(false)
  }

  onLoadProgress(cb: (progress: number, text: string) => void): () => void {
    this.progressListeners.add(cb)
    return () => this.progressListeners.delete(cb)
  }

  private _handleMessage(
    data: Record<string, unknown>,
    initResolve?: () => void,
    initReject?: (e: Error) => void
  ): void {
    switch (data.type) {
      case 'ready':
        this._setReady(true)
        initResolve?.()
        break

      case 'progress':
        this.loadProgress = data.progress as number
        this.progressListeners.forEach((cb) => cb(data.progress as number, data.text as string))
        break

      case 'token': {
        const resolver = this.pendingResolvers.get(data.requestId as string)
        resolver?.onToken?.(data.token as string)
        break
      }

      case 'result': {
        const resolver = this.pendingResolvers.get(data.requestId as string)
        if (resolver) {
          this.pendingResolvers.delete(data.requestId as string)
          if (this.activeRequestId === data.requestId) {
            this.activeRequestId = null
            this._setBusy(false)
          }
          resolver.resolve(data.text as string)
        }
        break
      }

      case 'error': {
        const resolver = this.pendingResolvers.get(data.requestId as string)
        if (resolver) {
          this.pendingResolvers.delete(data.requestId as string)
          if (this.activeRequestId === data.requestId) {
            this.activeRequestId = null
            this._setBusy(false)
          }
          resolver.reject(new Error(data.error as string))
        }
        if (!resolver) {
          this._setReady(false)
        }
        initReject?.(new Error(data.error as string))
        break
      }
    }
  }

  private _setBusy(next: boolean): void {
    if (this.busy === next) return
    this.busy = next
    this.busyListeners.forEach((listener) => listener(next))
  }

  private _setReady(next: boolean): void {
    if (this.ready === next) return
    this.ready = next
    this.readyListeners.forEach((listener) => listener(next))
  }
}

export const localModelProvider = new LocalModelProvider()
