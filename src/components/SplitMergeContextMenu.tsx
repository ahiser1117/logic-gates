import { useState, useRef, useEffect, useCallback } from 'react'
import { useStore } from '../store'
import type { ComponentId } from '../types'
import { normalizeSplitMergeConfig } from '../types'

interface SplitMergeContextMenuProps {
  componentId: ComponentId
  screenX: number
  screenY: number
  initialValue: string
  mode: 'split' | 'merge'
  onClose: () => void
}

export function SplitMergeContextMenu({
  componentId,
  screenX,
  screenY,
  initialValue,
  mode,
  onClose,
}: SplitMergeContextMenuProps) {
  const [value, setValue] = useState(initialValue)
  const [currentMode, setCurrentMode] = useState(mode)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const setSplitMergeConfig = useStore((s) => s.setSplitMergeConfig)

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  const parsePartitions = useCallback((): number[] | null => {
    const parts = value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => Number(part))

    if (parts.length === 0 || parts.some((part) => !Number.isFinite(part))) {
      return null
    }

    return parts.map((part) => Math.max(1, Math.min(32, Math.floor(part))))
  }, [value])

  const handleSubmit = useCallback(() => {
    const partitions = parsePartitions()
    if (partitions) {
      setSplitMergeConfig(componentId, normalizeSplitMergeConfig({ partitions, mode: currentMode }))
    }
    onClose()
  }, [componentId, parsePartitions, setSplitMergeConfig, onClose, currentMode])

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
        <label>Partitions:</label>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className="bit-width-input"
          placeholder="e.g. 2,2,4"
        />
        <button
          onClick={() => setCurrentMode((prev) => (prev === 'split' ? 'merge' : 'split'))}
          className="bit-width-set-btn"
          type="button"
        >
          {currentMode === 'split' ? 'Split' : 'Merge'}
        </button>
        <button onClick={handleSubmit} className="bit-width-set-btn">
          Set
        </button>
      </div>
    </div>
  )
}
