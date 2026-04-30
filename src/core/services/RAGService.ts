// ============================================================
// CORE SERVICE: RAGService
// Orchestrates: file chunking → embedding → vector store
// Exposes: index(filePath, content), semanticSearch(query)
// ============================================================

import { upsertChunks, deleteChunksByFile, searchChunks, clearAllChunks } from '@/infrastructure/rag/vectorStore'
import type { VectorChunk } from '@/infrastructure/rag/vectorStore'

const CHUNK_SIZE = 500      // characters per chunk
const CHUNK_OVERLAP = 100   // overlap between consecutive chunks
const BATCH_SIZE = 8        // embed N chunks at once to reduce worker round-trips

// Text-only file extensions worth indexing
const INDEXABLE_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'php',
  'html', 'css', 'scss', 'json', 'md', 'txt', 'yaml', 'yml', 'sh', 'env',
])

type RAGStatus = 'idle' | 'loading_model' | 'indexing' | 'ready' | 'error'
type StatusListener = (status: RAGStatus, detail?: string) => void

class RAGService {
  private worker: Worker | null = null
  private pendingRequests = new Map<string, (vectors: number[][] | Error) => void>()
  private _status: RAGStatus = 'idle'
  private statusListeners = new Set<StatusListener>()
  private _workerReady = false
  private _initPromise: Promise<void> | null = null

  // ── Status ─────────────────────────────────────────────

  get status(): RAGStatus { return this._status }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  private _setStatus(s: RAGStatus, detail?: string) {
    this._status = s
    this.statusListeners.forEach(l => l(s, detail))
  }

  // ── Worker lifecycle ────────────────────────────────────

  async initialize(): Promise<void> {
    if (this._initPromise) return this._initPromise
    this._initPromise = this._doInit()
    return this._initPromise
  }

  private async _doInit(): Promise<void> {
    this._setStatus('loading_model', 'Loading embedding model…')
    this.worker = new Worker(
      new URL('@/execution/rag/embed.worker.ts', import.meta.url),
      { type: 'module' }
    )
    this.worker.onmessage = (e) => {
      const data = e.data as { id: string; vectors?: number[][]; error?: string }
      const resolve = this.pendingRequests.get(data.id)
      if (!resolve) return
      this.pendingRequests.delete(data.id)
      if (data.error) resolve(new Error(data.error))
      else resolve(data.vectors!)
    }
    // Warm up by embedding a single dummy string — this triggers model download
    try {
      await this._embed(['warmup'])
      this._workerReady = true
      this._setStatus('ready', 'Embedding model ready')
    } catch (err) {
      this._setStatus('error', String(err))
      throw err
    }
  }

  // ── Core embedding ──────────────────────────────────────

  private _embed(texts: string[]): Promise<number[][]> {
    return new Promise((resolve, reject) => {
      if (!this.worker) return reject(new Error('Worker not initialized'))
      const id = `emb-${Date.now()}-${Math.random().toString(36).slice(2)}`
      this.pendingRequests.set(id, (result) => {
        if (result instanceof Error) reject(result)
        else resolve(result)
      })
      this.worker.postMessage({ id, texts })
    })
  }

  // ── Chunking ────────────────────────────────────────────

  private _chunk(filePath: string, content: string): VectorChunk[] {
    const chunks: VectorChunk[] = []
    let i = 0
    let chunkIndex = 0
    while (i < content.length) {
      const slice = content.slice(i, i + CHUNK_SIZE)
      if (slice.trim().length > 20) { // skip near-empty slices
        chunks.push({
          id: `${filePath}#${chunkIndex}`,
          filePath,
          content: slice,
          vector: [], // filled in by embed step
        })
        chunkIndex++
      }
      i += CHUNK_SIZE - CHUNK_OVERLAP
    }
    return chunks
  }

  // ── Public API ──────────────────────────────────────────

  /** Index (or re-index) a single file. Called automatically on file write. */
  async indexFile(filePath: string, content: string): Promise<void> {
    const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
    if (!INDEXABLE_EXTS.has(ext)) return
    if (!this._workerReady) return // silently skip if model not ready yet

    const chunks = this._chunk(filePath, content)
    if (chunks.length === 0) return

    // Delete old chunks for this file first
    await deleteChunksByFile(filePath)

    // Embed in batches to avoid overwhelming the worker
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE)
      const texts = batch.map(c => c.content)
      const vectors = await this._embed(texts)
      batch.forEach((chunk, j) => { chunk.vector = vectors[j] })
      await upsertChunks(batch)
    }
  }

  /** Remove all chunks for a deleted file. */
  async removeFile(filePath: string): Promise<void> {
    await deleteChunksByFile(filePath)
  }

  /** Index all files in the project. Call this after opening a folder. */
  async indexProject(files: Array<{ path: string; content: string }>): Promise<void> {
    if (!this._workerReady) await this.initialize()
    this._setStatus('indexing', `Indexing ${files.length} files…`)
    await clearAllChunks()
    for (const file of files) {
      await this.indexFile(file.path, file.content)
    }
    this._setStatus('ready', `Indexed ${files.length} files`)
  }

  /** Semantic search: returns top matching code chunks for a query. */
  async search(query: string, topK = 5): Promise<Array<{ filePath: string; content: string; score: number }>> {
    if (!this._workerReady) throw new Error('RAG model not ready')
    const [queryVector] = await this._embed([query])
    const results = await searchChunks(queryVector, topK)
    return results.map(r => ({ filePath: r.filePath, content: r.content, score: r.score }))
  }

  destroy(): void {
    this.worker?.terminate()
    this.worker = null
    this._workerReady = false
    this._initPromise = null
  }
}

export const ragService = new RAGService()
