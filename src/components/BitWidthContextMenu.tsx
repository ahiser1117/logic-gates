import { useState, useRef, useEffect, useCallback } from 'react'
import { useStore } from '../store'
import type { InputId } from '../types'

interface BitWidthContextMenuProps {
  inputId: InputId
  screenX: number
  screenY: number
  initialBitWidth: number
  onClose: () => void
}

export function BitWidthContextMenu({
  inputId,
  screenX,
  screenY,
  initialBitWidth,
  onClose,
}: BitWidthContextMenuProps) {
  const [bitWidth, setBitWidth] = useState(String(initialBitWidth))
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const setInputBitWidth = useStore((s) => s.setInputBitWidth)

  // Focus input on mount
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [])

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  const handleSubmit = useCallback(() => {
    const value = parseInt(bitWidth, 10)
    if (!isNaN(value) && value >= 1 && value <= 32) {
      setInputBitWidth(inputId, value)
    }
    onClose()
  }, [bitWidth, inputId, setInputBitWidth, onClose])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleSubmit()
      } else if (e.key === 'Escape') {
        onClose()
      }
    },
    [handleSubmit, onClose]
  )

  return (
    <div
      ref={containerRef}
      className="bit-width-context-menu"
      style={{
        position: 'absolute',
        left: screenX,
        top: screenY,
        zIndex: 1000,
      }}
    >
      <div className="bit-width-menu-content">
        <label>Bit Width:</label>
        <input
          ref={inputRef}
          type="number"
          min={1}
          max={32}
          value={bitWidth}
          onChange={(e) => setBitWidth(e.target.value)}
          onKeyDown={handleKeyDown}
          className="bit-width-input"
        />
        <button onClick={handleSubmit} className="bit-width-set-btn">
          Set
        </button>
      </div>
    </div>
  )
}
