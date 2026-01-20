import { useEffect } from 'react'
import { useStore } from '../store'
import type { CustomComponentId } from '../types'
import { buildDependencyTree } from '../utils/componentDependencies'
import './CreateComponentDialog.css'

interface Props {
  isOpen: boolean
  componentId: CustomComponentId | null
  onClose: () => void
}

export function EditComponentDialog({ isOpen, componentId, onClose }: Props) {
  const customComponents = useStore((s) => s.customComponents)
  const openCustomComponentForEdit = useStore((s) => s.openCustomComponentForEdit)

  const component = componentId ? customComponents.get(componentId) : null
  const dependencyInfo = componentId ? buildDependencyTree(componentId, customComponents) : null

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'Enter') {
        if (componentId) {
          openCustomComponentForEdit(componentId)
          onClose()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [componentId, isOpen, onClose, openCustomComponentForEdit])

  if (!isOpen || !component) return null

  const handleOpen = () => {
    openCustomComponentForEdit(component.id)
    onClose()
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Edit Component</h2>
        <p className="dialog-subtitle">{component.name}</p>

        <div className="dialog-warning">
          <p>Opening this component will replace the current circuit.</p>
          <p>Any unsaved changes will be lost.</p>
        </div>

        {dependencyInfo && dependencyInfo.total > 0 && (
          <div className="dialog-warning">
            <p>
              This component is used by {dependencyInfo.total} custom component
              {dependencyInfo.total > 1 ? 's' : ''}:
            </p>
            <div className="dialog-warning-tree">
              {dependencyInfo.lines.map((line, index) => (
                <div key={`${line.prefix}${line.name}-${index}`} className="dialog-warning-line">
                  <span className="dialog-warning-prefix">{line.prefix}</span>
                  <span
                    className={line.isTarget ? 'dialog-warning-target' : undefined}
                  >
                    {line.name}
                  </span>
                  {line.note && !line.isTarget && (
                    <span className="dialog-warning-note">({line.note})</span>
                  )}
                </div>
              ))}
            </div>
            <p>Edits may require updating those definitions.</p>
          </div>
        )}

        <div className="dialog-buttons">
          <button onClick={onClose}>Cancel</button>
          <button onClick={handleOpen} className="primary">
            Open for Edit
          </button>
        </div>
      </div>
    </div>
  )
}
