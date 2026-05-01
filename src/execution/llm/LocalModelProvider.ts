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

    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`
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

  isReady(): boolean { return this.ready }
  getModelName(): string { return this.modelName }
  getLoadProgress(): number { return this.loadProgress }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    this.ready = false
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
        this.ready = true
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
          resolver.resolve(data.text as string)
        }
        break
      }

      case 'error': {
        const resolver = this.pendingResolvers.get(data.requestId as string)
        if (resolver) {
          this.pendingResolvers.delete(data.requestId as string)
          resolver.reject(new Error(data.error as string))
        }
        initReject?.(new Error(data.error as string))
        break
      }
    }
  }
}

export const localModelProvider = new LocalModelProvider()
