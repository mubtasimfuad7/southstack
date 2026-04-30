// ============================================================
// EXECUTION LAYER: Embedding Web Worker
// Runs @huggingface/transformers in a dedicated thread so the
// main UI thread is never blocked during embedding computation.
// ============================================================

import { pipeline, env } from '@huggingface/transformers'

// Use the browser's own cache for model weights (no server needed)
env.useBrowserCache = true
env.allowLocalModels = false

type EmbedRequest = { id: string; texts: string[] }
type EmbedResponse = { id: string; vectors: number[][] } | { id: string; error: string }

let extractor: Awaited<ReturnType<typeof pipeline>> | null = null

async function getExtractor() {
  if (!extractor) {
    // all-MiniLM-L6-v2: 384-dim embeddings, ~23MB download, fast inference
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      dtype: 'fp32',
    })
  }
  return extractor
}

self.addEventListener('message', async (event: MessageEvent<EmbedRequest>) => {
  const { id, texts } = event.data
  try {
    const ext = await getExtractor()
    const output = await (ext as any)(texts, { pooling: 'mean', normalize: true })
    // output.tolist() returns number[][]
    const vectors: number[][] = (output as any).tolist()
    const response: EmbedResponse = { id, vectors }
    self.postMessage(response)
  } catch (err) {
    const response: EmbedResponse = { id, error: String(err) }
    self.postMessage(response)
  }
})
