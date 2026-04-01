// ============================================================
// UI LAYER: ResizableSplitPane — drag to resize panels
// ============================================================

import { useRef, useCallback, ReactNode, useState } from 'react'

interface SplitPaneProps {
  left: ReactNode
  right: ReactNode
  initialLeftWidth?: number
  minLeft?: number
  maxLeft?: number
  initialRightWidth?: number
  minRight?: number
  maxRight?: number
  primaryPane?: 'left' | 'right'
  className?: string
}

export function HorizontalSplit({ 
  left, 
  right, 
  initialLeftWidth = 240, 
  minLeft = 140, 
  maxLeft = 2000, 
  initialRightWidth = 320,
  minRight = 200,
  maxRight = 800,
  primaryPane = 'left',
  className = '' 
}: SplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const [currentWidth, setCurrentWidth] = useState(primaryPane === 'left' ? initialLeftWidth : initialRightWidth)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (me: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      
      if (primaryPane === 'left') {
        const newWidth = Math.min(maxLeft, Math.max(minLeft, me.clientX - rect.left))
        setCurrentWidth(newWidth)
      } else {
        const newWidth = Math.min(maxRight, Math.max(minRight, rect.right - me.clientX))
        setCurrentWidth(newWidth)
      }
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
  }, [minLeft, maxLeft, minRight, maxRight, primaryPane])

  return (
    <div ref={containerRef} className={`flex flex-row h-full w-full flex-1 overflow-hidden ${className}`}>
      {primaryPane === 'left' ? (
        <>
          <div 
            ref={leftRef} 
            style={{ 
              width: right ? `${currentWidth}px` : '100%', 
              flexShrink: 0 
            }} 
            className="flex flex-col overflow-hidden"
          >
            {left}
          </div>
          
          {right && (
            <>
              {/* Resize handle */}
              <div
                onMouseDown={onMouseDown}
                className="w-1.5 flex-shrink-0 bg-transparent hover:bg-primary-500/20 cursor-col-resize transition-all relative z-10 -ml-[5px]"
              />
              <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                {right}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            {left}
          </div>
          {right && (
            <>
              {/* Resize handle */}
              <div
                onMouseDown={onMouseDown}
                className="w-1.5 flex-shrink-0 bg-transparent hover:bg-primary-500/20 cursor-col-resize transition-all relative z-10 -mr-[5px]"
              />
              <div 
                ref={rightRef}
                style={{ 
                  width: `${currentWidth}px`, 
                  flexShrink: 0 
                }} 
                className="flex flex-col overflow-hidden"
              >
                {right}
              </div>
            </>
          )}
        </>
      )}
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
    <div ref={containerRef} className="flex flex-col h-full w-full overflow-hidden">
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
