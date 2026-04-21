import { MLCEngine } from '@mlc-ai/web-llm'
import type { ChatCompletionMessageParam } from '@mlc-ai/web-llm'

let engine: MLCEngine | null = null
let currentModel: string | null = null
let currentAbortController: AbortController | null = null

const DEFAULT_ANALYSIS_PROMPT = `You analyze UI screenshots for a design-builder application.
Return ONLY valid JSON in this exact shape:
{
  "screenType": "short label for the screen",
  "summary": "1-2 sentence overview",
  "layoutNotes": ["short note", "short note"],
  "style": {
    "backgroundColor": "#hex or descriptive value",
    "primaryColor": "#hex or descriptive value",
    "accentColor": "#hex or descriptive value",
    "borderRadius": "short note"
  },
  "sections": [
    {
      "name": "short stable section name",
      "role": "header|summary|grid|navigation|content|other",
      "bounds": { "x": 0, "y": 0, "width": 0, "height": 0 }
    }
  ],
  "cards": [
    {
      "title": "short card title if visible",
      "subtitle": "short subtitle if visible",
      "section": "section name if obvious",
      "bounds": { "x": 0, "y": 0, "width": 0, "height": 0 }
    }
  ],
  "textSeen": [
    {
      "text": "visible text",
      "section": "section name if obvious"
    }
  ],
  "components": [
    {
      "type": "frame|header|hero|card|button|text|image|input|sidebar|nav|section|other",
      "label": "short human-readable label",
      "text": "visible text if any",
      "bounds": { "x": 0, "y": 0, "width": 0, "height": 0 },
      "children": []
    }
  ]
}
Rules:
- Focus on major layout blocks and reusable UI components.
- Use approximate bounds only when they are visually inferable.
- Keep the JSON concise and stable.
- Prefer a few high-signal sections/cards/text entries over exhaustive detail.
- Do not include markdown fences or extra commentary.`

self.onmessage = async (e: MessageEvent) => {
  const { type, ...data } = e.data

  switch (type) {
    case 'init':
      await handleInit(data.modelName)
      break
    case 'analyze':
      await handleAnalyze(data)
      break
    case 'answer':
      await handleAnswer(data)
      break
    case 'abort':
      currentAbortController?.abort()
      currentAbortController = null
      break
  }
}

async function handleInit(modelName: string) {
  try {
    if (engine && currentModel === modelName) {
      self.postMessage({ type: 'ready' })
      return
    }

    if (!engine) {
      engine = new MLCEngine()
    }

    engine.setInitProgressCallback((report) => {
      self.postMessage({
        type: 'progress',
        progress: report.progress,
        text: report.text,
      })
    })

    await engine.reload(modelName)
    currentModel = modelName
    self.postMessage({ type: 'ready' })
  } catch (err) {
    self.postMessage({
      type: 'error',
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

async function handleAnalyze(data: {
  requestId: string
  imageDataUrl: string
  prompt?: string
  maxTokens: number
  temperature: number
}) {
  if (!engine) {
    self.postMessage({ type: 'error', requestId: data.requestId, error: 'Vision engine not initialized' })
    return
  }

  currentAbortController = new AbortController()
  const signal = currentAbortController.signal

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: DEFAULT_ANALYSIS_PROMPT },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: data.prompt?.trim() || 'Analyze this UI screenshot and produce the requested JSON.',
        },
        {
          type: 'image_url',
          image_url: {
            url: data.imageDataUrl,
          },
        },
      ],
    },
  ]

  try {
    let fullText = ''

    const chunks = await engine.chat.completions.create({
      messages,
      max_tokens: data.maxTokens,
      temperature: data.temperature,
      stream: true,
    })

    for await (const chunk of chunks) {
      if (signal.aborted) break

      const token = chunk.choices[0]?.delta?.content ?? ''
      fullText += token
      if (token) {
        self.postMessage({ type: 'token', requestId: data.requestId, token })
      }
    }

    self.postMessage({ type: 'result', requestId: data.requestId, text: fullText })
  } catch (err) {
    self.postMessage({
      type: 'error',
      requestId: data.requestId,
      error: err instanceof Error ? err.message : String(err),
    })
  } finally {
    currentAbortController = null
  }
}

async function handleAnswer(data: {
  requestId: string
  imageDataUrl: string
  prompt: string
  maxTokens: number
  temperature: number
}) {
  if (!engine) {
    self.postMessage({ type: 'error', requestId: data.requestId, error: 'Vision engine not initialized' })
    return
  }

  currentAbortController = new AbortController()
  const signal = currentAbortController.signal

  const messages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: `You are a UI design assistant answering questions about an attached screenshot.
Answer conversationally and clearly.
Focus on what is visible in the image.
If the user asks about layout, components, spacing, colors, hierarchy, or improvements, answer directly.
Do not output JSON unless the user explicitly asks for JSON.`,
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: data.prompt.trim() },
        {
          type: 'image_url',
          image_url: {
            url: data.imageDataUrl,
          },
        },
      ],
    },
  ]

  try {
    let fullText = ''

    const chunks = await engine.chat.completions.create({
      messages,
      max_tokens: data.maxTokens,
      temperature: data.temperature,
      stream: true,
    })

    for await (const chunk of chunks) {
      if (signal.aborted) break

      const token = chunk.choices[0]?.delta?.content ?? ''
      fullText += token
      if (token) {
        self.postMessage({ type: 'token', requestId: data.requestId, token })
      }
    }

    self.postMessage({ type: 'result', requestId: data.requestId, text: fullText })
  } catch (err) {
    self.postMessage({
      type: 'error',
      requestId: data.requestId,
      error: err instanceof Error ? err.message : String(err),
    })
  } finally {
    currentAbortController = null
  }
}
