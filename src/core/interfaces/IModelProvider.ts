// ============================================================
// CORE SERVICES LAYER: ModelProvider interface (CRITICAL)
// This abstraction decouples the agent from any specific LLM.
// LocalModelProvider → uses @mlc-ai/web-llm
// PeerModelProvider  → future WebRTC-based (NOT implemented)
// ============================================================

export interface ModelGenerateOptions {
  maxTokens?: number
  temperature?: number
  stream?: boolean
  onToken?: (token: string) => void
}

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export interface ModelProvider {
  /** One-time initialization. Load model, warm up, etc. */
  initialize(): Promise<void>

  /** Generate a completion given messages */
  generate(messages: ChatMessage[], options?: ModelGenerateOptions): Promise<string>

  /** Stream tokens synchronously from a message list */
  generateStream(messages: ChatMessage[], onToken: (token: string) => void, options?: ModelGenerateOptions): Promise<string>

  /** Cancel an ongoing generation */
  abort(): void

  /** Return true when the model is loaded and ready */
  isReady(): boolean

  /** Human-readable model name */
  getModelName(): string

  /** Loading progress 0–1 */
  getLoadProgress(): number

  /** Register a callback for loading progress updates */
  onLoadProgress(cb: (progress: number, text: string) => void): () => void

  /** Tear down resources */
  dispose(): void
}

// ============================================================
// FUTURE P2P DESIGN (interface only, NOT implemented)
// ============================================================

export interface TransportLayer {
  send(peerId: string, payload: unknown): Promise<void>
  receive(): AsyncIterable<{ peerId: string; payload: unknown }>
  getPeers(): string[]
}

/**
 * PeerModelProvider: Future WebRTC-based model sharing.
 * Each peer runs a local model and shares generation requests
 * via the TransportLayer. NOT IMPLEMENTED.
 */
export interface PeerModelProvider extends ModelProvider {
  transport: TransportLayer
  requestFromPeer(peerId: string, messages: ChatMessage[]): Promise<string>
}
