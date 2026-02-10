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

export function DeleteComponentDialog({ isOpen, componentId, onClose }: Props) {
  const customComponents = useStore((s) => s.customComponents)
  const deleteCustomComponent = useStore((s) => s.deleteCustomComponent)

  const component = componentId ? customComponents.get(componentId) : null
  const dependencyInfo = componentId ? buildDependencyTree(componentId, customComponents) : null

  const handleConfirm = useCallback(() => {
    if (componentId) {
      deleteCustomComponent(componentId)
      onClose()
    }
  }, [componentId, deleteCustomComponent, onClose])

  useDialogKeyboard(isOpen, onClose, handleConfirm)

  if (!isOpen || !component) return null

  const handleDelete = () => {
    deleteCustomComponent(component.id)
    onClose()
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Delete Component</h2>
        <p className="dialog-subtitle">{component.name}</p>

        {dependencyInfo && (
          <DependencyWarning
            dependencyInfo={dependencyInfo}
            message="Deleting it will break those definitions."
          />
        )}

        <div className="dialog-buttons">
          <button onClick={onClose}>Cancel</button>
          <button onClick={handleDelete} className="primary">
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
