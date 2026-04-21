import React, { useEffect, useMemo, useState } from 'react'
import { ClipboardPaste, ImagePlus, Sparkles, X, Loader2 } from 'lucide-react'
import { imageDesignOrchestrator } from '../ai/ImageDesignOrchestrator'
import { localVisionModelProvider } from '@/execution/vision/LocalVisionModelProvider'
import type { VisionAnalysisResult } from '@/core/interfaces/IVisionModelProvider'

export const ImageToDesignPanel: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('Focus on reconstructing the major layout, visible text, and reusable UI blocks.')
  const [result, setResult] = useState<VisionAnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pasteStatus, setPasteStatus] = useState<string | null>(null)
  const [modelState, setModelState] = useState({ ready: localVisionModelProvider.isReady(), progress: 0, text: '' })

  useEffect(() => {
    const unsubProgress = localVisionModelProvider.onLoadProgress((progress, text) => {
      setModelState({ ready: progress >= 1, progress, text })
    })
    return () => {
      unsubProgress()
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const formattedJson = useMemo(() => {
    if (!result?.structured) return ''
    return JSON.stringify(result.structured, null, 2)
  }, [result])

  const handleFileChange = (file: File | null) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setSelectedFile(file)
    setPreviewUrl(file ? URL.createObjectURL(file) : null)
    setResult(null)
    setError(null)
    if (file) {
      setPasteStatus(`Selected image: ${file.name}`)
    }
  }

  useEffect(() => {
    if (!isOpen) return

    const handlePaste = (event: ClipboardEvent) => {
      const file = extractImageFile(event.clipboardData)
      if (!file) return

      event.preventDefault()
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setSelectedFile(file)
      setPreviewUrl(URL.createObjectURL(file))
      setResult(null)
      setError(null)
      setPasteStatus(`Pasted image: ${file.name}`)
    }

    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [isOpen, previewUrl])

  const handleAnalyze = async () => {
    if (!selectedFile || isAnalyzing) return

    try {
      setIsAnalyzing(true)
      setError(null)
      const analysis = await imageDesignOrchestrator.analyzeFile(selectedFile, prompt)
      setResult(analysis)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handlePasteButton = async () => {
    try {
      const clipboardItems = await navigator.clipboard.read()
      for (const item of clipboardItems) {
        const imageType = item.types.find((type) => type.startsWith('image/'))
        if (!imageType) continue

        const blob = await item.getType(imageType)
        const extension = imageType.split('/')[1] || 'png'
        const file = new File([blob], `pasted-image.${extension}`, { type: imageType })
        handleFileChange(file)
        setPasteStatus(`Pasted image: ${file.name}`)
        return
      }

      setPasteStatus('Clipboard does not contain an image right now.')
    } catch (err) {
      setPasteStatus(`Clipboard paste failed: ${(err as Error).message}`)
    }
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-24 right-6 w-14 h-14 rounded-full bg-emerald-600 text-white shadow-[0_12px_32px_rgba(16,185,129,0.35)] hover:bg-emerald-500 transition-all z-50 flex items-center justify-center"
        title="Open Image-to-Design Panel"
      >
        <ImagePlus size={22} />
      </button>
    )
  }

  return (
    <div className="fixed right-6 bottom-24 z-50 w-[420px] max-w-[calc(100vw-2rem)] h-[640px] max-h-[82vh] rounded-3xl border border-white/10 bg-[#10131d]/95 backdrop-blur-xl shadow-2xl overflow-hidden flex flex-col">
      <div className="h-14 px-4 flex items-center justify-between border-b border-white/10 bg-[#0b0f17]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-emerald-400" />
            <h3 className="text-sm font-semibold text-white">Image to Design</h3>
          </div>
          <p className="text-[11px] text-slate-400 truncate">
            Requested: {localVisionModelProvider.getRequestedModelName()} | Active runtime: {localVisionModelProvider.getModelName()}
          </p>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      <div className="p-4 space-y-4 overflow-y-auto">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Upload Screenshot</span>
          <div className="mt-2 space-y-3 rounded-2xl border border-dashed border-slate-700 bg-slate-950/60 p-3">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-slate-300 file:mr-3 file:rounded-xl file:border-0 file:bg-emerald-500 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-emerald-400"
            />
            <button
              type="button"
              onClick={handlePasteButton}
              className="w-full h-10 rounded-xl border border-white/10 bg-slate-900/80 text-slate-200 text-sm font-medium hover:bg-slate-800 transition-colors flex items-center justify-center gap-2"
            >
              <ClipboardPaste size={15} />
              Paste from Clipboard
            </button>
            <p className="text-[11px] text-slate-500">
              You can also press <span className="font-semibold text-slate-300">Cmd/Ctrl + V</span> while this panel is open.
            </p>
          </div>
        </label>

        {pasteStatus && (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
            {pasteStatus}
          </div>
        )}

        {previewUrl && (
          <div className="rounded-2xl overflow-hidden border border-white/10 bg-black/30">
            <img src={previewUrl} alt="Selected design reference" className="w-full h-48 object-cover" />
          </div>
        )}

        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Analysis Prompt</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-3 text-sm text-slate-100 outline-none focus:border-emerald-500"
          />
        </label>

        <button
          onClick={handleAnalyze}
          disabled={!selectedFile || isAnalyzing}
          className="w-full h-11 rounded-2xl bg-emerald-500 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-emerald-400 transition-colors flex items-center justify-center gap-2"
        >
          {isAnalyzing ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {isAnalyzing ? 'Analyzing Image...' : 'Analyze Image'}
        </button>

        {!modelState.ready && modelState.progress > 0 && (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-2">
            <div className="flex items-center justify-between text-xs text-amber-300">
              <span>Loading local vision model</span>
              <span>{Math.round(modelState.progress * 100)}%</span>
            </div>
            <p className="mt-1 text-[11px] text-amber-200/80">{modelState.text}</p>
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        {result?.warnings.length ? (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            {result.warnings.join(' ')}
          </div>
        ) : null}

        {result && (
          <div className="space-y-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Structured Output</div>
              <pre className="mt-2 rounded-2xl border border-white/10 bg-slate-950/80 p-3 text-[11px] leading-5 text-slate-200 overflow-x-auto whitespace-pre-wrap">
                {formattedJson || 'No structured JSON could be parsed.'}
              </pre>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Raw Model Output</div>
              <pre className="mt-2 rounded-2xl border border-white/10 bg-slate-950/50 p-3 text-[11px] leading-5 text-slate-400 overflow-x-auto whitespace-pre-wrap">
                {result.rawText}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function extractImageFile(clipboardData: DataTransfer | null): File | null {
  if (!clipboardData) return null

  for (const item of Array.from(clipboardData.items)) {
    if (!item.type.startsWith('image/')) continue

    const file = item.getAsFile()
    if (!file) continue

    const extension = file.type.split('/')[1] || 'png'
    return new File([file], file.name || `pasted-image.${extension}`, { type: file.type })
  }

  return null
}
