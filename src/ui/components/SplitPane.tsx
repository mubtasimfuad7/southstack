// ============================================================
// UI LAYER: ResizableSplitPane — drag to resize panels
// ============================================================

import { useRef, useCallback, ReactNode } from 'react'

interface SplitPaneProps {
  left: ReactNode
  right: ReactNode
  initialLeftWidth?: number
  minLeft?: number
  maxLeft?: number
  className?: string
}

export function HorizontalSplit({ left, right, initialLeftWidth = 240, minLeft = 140, maxLeft = 480, className = '' }: SplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const leftRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (me: MouseEvent) => {
      if (!isDragging.current || !containerRef.current || !leftRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const newWidth = Math.min(maxLeft, Math.max(minLeft, me.clientX - rect.left))
      leftRef.current.style.width = `${newWidth}px`
    }

    const onUp = () => {
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [minLeft, maxLeft])

  return (
    <div ref={containerRef} className={`flex flex-row h-full overflow-hidden ${className}`}>
      <div ref={leftRef} style={{ width: initialLeftWidth, flexShrink: 0 }} className="flex flex-col overflow-hidden">
        {left}
      </div>
      {/* Resize handle */}
      <div
        onMouseDown={onMouseDown}
        className="w-1 flex-shrink-0 bg-border hover:bg-primary-400/50 cursor-col-resize transition-colors"
      />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {right}
      </div>
    </div>
  )
}

interface RightSidebarSplitProps {
  left: ReactNode
  right: ReactNode
  initialRightWidth?: number
  minRight?: number
  maxRight?: number
  onResizeEnd?: (width: number) => void
  className?: string
}

export function RightSidebarSplit({ left, right, initialRightWidth = 400, minRight = 200, maxRight = 800, onResizeEnd, className = '' }: RightSidebarSplitProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (me: MouseEvent) => {
      if (!isDragging.current || !containerRef.current || !rightRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      // width of right panel = total width - mouse X position (relative to container)
      const newWidth = Math.min(maxRight, Math.max(minRight, rect.right - me.clientX))
      rightRef.current.style.width = `${newWidth}px`
    }

    const onUp = () => {
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      
      // Save the final width
      if (rightRef.current && onResizeEnd) {
        onResizeEnd(rightRef.current.getBoundingClientRect().width)
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [minRight, maxRight, onResizeEnd])

  return (
    <div ref={containerRef} className={`flex flex-row h-full overflow-hidden ${className}`}>
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {left}
      </div>
      {/* Resize handle */}
      <div
        onMouseDown={onMouseDown}
        className="w-1 flex-shrink-0 bg-border hover:bg-primary-400/50 cursor-col-resize transition-colors"
      />
      <div ref={rightRef} style={{ width: initialRightWidth, flexShrink: 0 }} className="flex flex-col overflow-hidden">
        {right}
      </div>
    </div>
  )
}

interface VerticalSplitProps {
  top: ReactNode
  bottom: ReactNode
  bottomHeight?: number
  minBottom?: number
  maxBottom?: number
}

export function VerticalSplit({ top, bottom, bottomHeight = 220, minBottom = 80, maxBottom = 600 }: VerticalSplitProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'

    const onMove = (me: MouseEvent) => {
      if (!isDragging.current || !containerRef.current || !bottomRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const newHeight = Math.min(maxBottom, Math.max(minBottom, rect.bottom - me.clientY))
      bottomRef.current.style.height = `${newHeight}px`
    }

    const onUp = () => {
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [minBottom, maxBottom])

  return (
    <div ref={containerRef} className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-hidden min-h-0">
        {top}
      </div>
      {/* Resize handle */}
      <div
        onMouseDown={onMouseDown}
        className="h-1 flex-shrink-0 bg-border hover:bg-primary-400/50 cursor-row-resize transition-colors"
      />
      <div ref={bottomRef} style={{ height: bottomHeight, flexShrink: 0 }} className="overflow-hidden">
        {bottom}
      </div>
    </div>
  )
}
