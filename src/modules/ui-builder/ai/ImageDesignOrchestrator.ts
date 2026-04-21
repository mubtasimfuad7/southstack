import { localVisionModelProvider } from '@/execution/vision/LocalVisionModelProvider'
import type { VisionAnalysisResult } from '@/core/interfaces/IVisionModelProvider'

const PHI_VISION_WIDTH = 1344
const PHI_VISION_HEIGHT = 1008

export class ImageDesignOrchestrator {
  async analyzeFiles(files: File[], prompt?: string): Promise<VisionAnalysisResult[]> {
    if (!localVisionModelProvider.isReady()) {
      await localVisionModelProvider.initialize()
    }

    const results: VisionAnalysisResult[] = []
    for (const file of files) {
      const imageDataUrl = await fileToPhiVisionDataUrl(file)
      results.push(await localVisionModelProvider.analyzeImage(imageDataUrl, { prompt }))
    }
    return results
  }

  async analyzeFile(file: File, prompt?: string): Promise<VisionAnalysisResult> {
    if (!localVisionModelProvider.isReady()) {
      await localVisionModelProvider.initialize()
    }

    const imageDataUrl = await fileToPhiVisionDataUrl(file)
    return localVisionModelProvider.analyzeImage(imageDataUrl, { prompt })
  }

  async answerQuestionAboutFile(file: File, prompt: string): Promise<string> {
    if (!localVisionModelProvider.isReady()) {
      await localVisionModelProvider.initialize()
    }

    const imageDataUrl = await fileToPhiVisionDataUrl(file)
    return localVisionModelProvider.answerQuestion(imageDataUrl, prompt, { maxTokens: 700, temperature: 0.2 })
  }
}

async function fileToPhiVisionDataUrl(file: File): Promise<string> {
  const sourceUrl = await fileToDataUrl(file)
  const image = await loadImage(sourceUrl)
  return normalizeForPhiVision(image)
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image file'))
    reader.readAsDataURL(file)
  })
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to decode image'))
    image.src = src
  })
}

function normalizeForPhiVision(image: HTMLImageElement): string {
  const canvas = document.createElement('canvas')
  canvas.width = PHI_VISION_WIDTH
  canvas.height = PHI_VISION_HEIGHT

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Failed to create canvas context for image preprocessing')
  }

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const scale = Math.min(canvas.width / image.width, canvas.height / image.height)
  const drawWidth = Math.max(1, Math.round(image.width * scale))
  const drawHeight = Math.max(1, Math.round(image.height * scale))
  const offsetX = Math.floor((canvas.width - drawWidth) / 2)
  const offsetY = Math.floor((canvas.height - drawHeight) / 2)

  ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight)
  return canvas.toDataURL('image/png')
}

export const imageDesignOrchestrator = new ImageDesignOrchestrator()
