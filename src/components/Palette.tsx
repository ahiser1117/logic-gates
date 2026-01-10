import { useState } from 'react'
import { useStore } from '../store'
import type { GateType, ComponentType, CustomComponentId } from '../types'
import { CreateComponentDialog } from './CreateComponentDialog'
import './Palette.css'

const GATES: { type: GateType; label: string }[] = [
  { type: 'NAND', label: 'NAND' },
  { type: 'NOR', label: 'NOR' },
]

export function Palette() {
  const [dialogOpen, setDialogOpen] = useState(false)

  const setDrag = useStore((s) => s.setDrag)
  const customComponents = useStore((s) => s.customComponents)
  const deleteCustomComponent = useStore((s) => s.deleteCustomComponent)

  const handleDragStart = (e: React.DragEvent, componentType: ComponentType) => {
    e.dataTransfer.setData('componentType', componentType)
    setDrag({
      type: 'palette',
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY,
      payload: { gateType: componentType as GateType },
    })
  }

  const handleDeleteCustomComponent = (e: React.MouseEvent, id: CustomComponentId, name: string) => {
    e.stopPropagation()
    e.preventDefault()
    if (confirm(`Delete component "${name}"?`)) {
      deleteCustomComponent(id)
    }
  }

  const sortedCustomComponents = Array.from(customComponents.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  )

  return (
    <div className="palette">
      <h3>Components</h3>

      <div className="palette-section">
        <h4>Gates</h4>
        {GATES.map((gate) => (
          <div
            key={gate.type}
            className="palette-item"
            draggable
            onDragStart={(e) => handleDragStart(e, gate.type)}
          >
            <div className={`gate-icon gate-${gate.type.toLowerCase()}`}>{gate.label}</div>
          </div>
        ))}
      </div>

      {sortedCustomComponents.length > 0 && (
        <div className="palette-section">
          <h4>Custom</h4>
          {sortedCustomComponents.map((def) => (
            <div
              key={def.id}
              className="palette-item custom"
              draggable
              onDragStart={(e) => handleDragStart(e, def.id)}
            >
              <div className="gate-icon gate-custom">{def.name}</div>
              <button
                className="delete-btn"
                onClick={(e) => handleDeleteCustomComponent(e, def.id, def.name)}
                title="Delete component"
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="palette-actions">
        <button className="create-component-btn" onClick={() => setDialogOpen(true)}>
          + Create Component
        </button>
      </div>

      <CreateComponentDialog isOpen={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  )
}
