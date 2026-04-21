import type {
  VisionAnalysisPromptOptions,
  VisionAnalysisResult,
  VisionDesignAnalysis,
  VisionModelProvider,
} from '@/core/interfaces/IVisionModelProvider'

// WebLLM 0.2.82 ships with Phi-3.5 vision as the browser-ready VLM.
// Qwen2.5-VL remains the intended target model for future custom MLC integration.
export const REQUESTED_VISION_MODEL = 'Qwen2.5-VL-7B-Instruct'
export const DEFAULT_VISION_MODEL = 'Phi-3.5-vision-instruct-q4f16_1-MLC'

export class LocalVisionModelProvider implements VisionModelProvider {
  private worker: Worker | null = null
  private ready = false
  private loadProgress = 0
  private modelName = DEFAULT_VISION_MODEL
  private pendingResolvers: Map<string, {
    resolve: (v: VisionAnalysisResult) => void
    reject: (e: Error) => void
  }> = new Map()
  private progressListeners: Set<(progress: number, text: string) => void> = new Set()

  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.worker = new Worker(new URL('./vision.worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (e) => this._handleMessage(e.data, resolve, reject)
      this.worker.onerror = (e) => reject(new Error(e.message))
      this.worker.postMessage({ type: 'init', modelName: this.modelName })
    })
  }

  async analyzeImage(imageDataUrl: string, options?: VisionAnalysisPromptOptions): Promise<VisionAnalysisResult> {
    if (!this.worker || !this.ready) throw new Error('Vision model not initialized')

    const requestId = `vision-${Date.now()}-${Math.random().toString(36).slice(2)}`

    return new Promise((resolve, reject) => {
      this.pendingResolvers.set(requestId, { resolve, reject })
      this.worker!.postMessage({
        type: 'analyze',
        requestId,
        imageDataUrl,
        prompt: options?.prompt,
        maxTokens: options?.maxTokens ?? 900,
        temperature: options?.temperature ?? 0.1,
      })
    })
  }

  async answerQuestion(imageDataUrl: string, prompt: string, options?: VisionAnalysisPromptOptions): Promise<string> {
    if (!this.worker || !this.ready) throw new Error('Vision model not initialized')

    const requestId = `vision-chat-${Date.now()}-${Math.random().toString(36).slice(2)}`

    return new Promise((resolve, reject) => {
      this.pendingResolvers.set(requestId, {
        resolve: (result) => resolve(result.rawText),
        reject,
      })
      this.worker!.postMessage({
        type: 'answer',
        requestId,
        imageDataUrl,
        prompt,
        maxTokens: options?.maxTokens ?? 700,
        temperature: options?.temperature ?? 0.2,
      })
    })
  }

  abort(): void {
    this.worker?.postMessage({ type: 'abort' })
  }

  isReady(): boolean { return this.ready }
  getModelName(): string { return this.modelName }
  getRequestedModelName(): string { return REQUESTED_VISION_MODEL }
  getLoadProgress(): number { return this.loadProgress }

  onLoadProgress(cb: (progress: number, text: string) => void): () => void {
    this.progressListeners.add(cb)
    return () => this.progressListeners.delete(cb)
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    this.ready = false
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

      case 'result': {
        const requestId = data.requestId as string
        const resolver = this.pendingResolvers.get(requestId)
        if (!resolver) break

        this.pendingResolvers.delete(requestId)
        const rawText = String(data.text ?? '')
        const structured = tryParseVisionJson(rawText)
        const warnings = structured ? [] : ['The model response was not valid JSON. Inspect the raw output below.']
        resolver.resolve({ rawText, structured, warnings })
        break
      }

      case 'error': {
        const requestId = data.requestId as string | undefined
        if (requestId) {
          const resolver = this.pendingResolvers.get(requestId)
          if (resolver) {
            this.pendingResolvers.delete(requestId)
            resolver.reject(new Error(data.error as string))
          }
        } else {
          initReject?.(new Error(data.error as string))
        }
        break
      }
    }
  }
}

function tryParseVisionJson(text: string): VisionDesignAnalysis | null {
  const cleaned = text.trim()
  const fencedMatch = cleaned.match(/```json\s*([\s\S]*?)\s*```/i)
  const candidate = fencedMatch?.[1] ?? cleaned.match(/\{[\s\S]*\}/)?.[0]
  if (!candidate) return null

  try {
    return JSON.parse(candidate) as VisionDesignAnalysis
  } catch {
    return null
  }
}

export const localVisionModelProvider = new LocalVisionModelProvider()
