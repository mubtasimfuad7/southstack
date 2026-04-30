// ============================================================
// INFRASTRUCTURE LAYER: VectorStore — IndexedDB-backed chunk store
// Stores code chunks with their embeddings for semantic search
// ============================================================

import { openDB, IDBPDatabase } from 'idb'

const DB_NAME = 'southstack-rag'
const DB_VERSION = 1
const CHUNKS_STORE = 'chunks'

export interface VectorChunk {
  id: string           // `${filePath}#${chunkIndex}`
  filePath: string
  content: string      // raw text of the chunk
  vector: number[]     // embedding (e.g. 384-dim for MiniLM)
}

let _db: IDBPDatabase | null = null

async function getDb(): Promise<IDBPDatabase> {
  if (_db) return _db
  _db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
        const store = db.createObjectStore(CHUNKS_STORE, { keyPath: 'id' })
        store.createIndex('byFilePath', 'filePath')
      }
    },
  })
  return _db
}

export async function upsertChunks(chunks: VectorChunk[]): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(CHUNKS_STORE, 'readwrite')
  await Promise.all([...chunks.map(c => tx.store.put(c)), tx.done])
}

export async function deleteChunksByFile(filePath: string): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(CHUNKS_STORE, 'readwrite')
  const index = tx.store.index('byFilePath')
  let cursor = await index.openCursor(IDBKeyRange.only(filePath))
  while (cursor) {
    await cursor.delete()
    cursor = await cursor.continue()
  }
  await tx.done
}

export async function getAllChunks(): Promise<VectorChunk[]> {
  const db = await getDb()
  return db.getAll(CHUNKS_STORE)
}

export async function clearAllChunks(): Promise<void> {
  const db = await getDb()
  await db.clear(CHUNKS_STORE)
}

/** Cosine similarity between two equal-length vectors */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom === 0 ? 0 : dot / denom
}

/** Search for the topK most similar chunks to a query vector */
export async function searchChunks(queryVector: number[], topK = 5): Promise<Array<VectorChunk & { score: number }>> {
  const all = await getAllChunks()
  const scored = all.map(chunk => ({
    ...chunk,
    score: cosineSimilarity(queryVector, chunk.vector),
  }))
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK)
}
