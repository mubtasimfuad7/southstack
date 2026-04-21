export interface VisionAnalysisPromptOptions {
  prompt?: string
  maxTokens?: number
  temperature?: number
}

export interface VisionStyleSummary {
  backgroundColor?: string
  primaryColor?: string
  accentColor?: string
  borderRadius?: string
}

export interface VisionComponentSummary {
  type: string
  label: string
  text?: string
  bounds?: { x: number; y: number; width: number; height: number }
  children?: VisionComponentSummary[]
}

export interface VisionSectionSummary {
  name: string
  role?: string
  bounds?: { x: number; y: number; width: number; height: number }
}

export interface VisionCardSummary {
  title?: string
  subtitle?: string
  section?: string
  bounds?: { x: number; y: number; width: number; height: number }
}

export interface VisionTextSummary {
  text: string
  section?: string
}

export interface VisionDesignAnalysis {
  screenType: string
  summary: string
  layoutNotes: string[]
  style: VisionStyleSummary
  components: VisionComponentSummary[]
  sections?: VisionSectionSummary[]
  cards?: VisionCardSummary[]
  textSeen?: VisionTextSummary[]
}

export interface VisionAnalysisResult {
  rawText: string
  structured: VisionDesignAnalysis | null
  warnings: string[]
}

export interface VisionModelProvider {
  initialize(): Promise<void>
  analyzeImage(imageDataUrl: string, options?: VisionAnalysisPromptOptions): Promise<VisionAnalysisResult>
  answerQuestion(imageDataUrl: string, prompt: string, options?: VisionAnalysisPromptOptions): Promise<string>
  abort(): void
  isReady(): boolean
  getModelName(): string
  getRequestedModelName(): string
  getLoadProgress(): number
  onLoadProgress(cb: (progress: number, text: string) => void): () => void
  dispose(): void
}
