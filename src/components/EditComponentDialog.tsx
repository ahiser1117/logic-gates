import { useCallback } from 'react'
import { useStore } from '../store'
import type { CustomComponentId } from '../types'
import { buildDependencyTree } from '../utils/componentDependencies'
import { DependencyWarning } from './DependencyWarning'
import { useDialogKeyboard } from '../hooks/useDialogKeyboard'
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

  const handleConfirm = useCallback(() => {
    if (componentId) {
      openCustomComponentForEdit(componentId)
      onClose()
    }
  }, [componentId, openCustomComponentForEdit, onClose])

  useDialogKeyboard(isOpen, onClose, handleConfirm)

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

        {dependencyInfo && (
          <DependencyWarning
            dependencyInfo={dependencyInfo}
            message="Edits may require updating those definitions."
          />
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
