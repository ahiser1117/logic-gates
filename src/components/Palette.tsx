import { useRef, useState } from 'react'
import { useStore } from '../store'
import type { GateType, ComponentType, CustomComponentId } from '../types'
import { CreateComponentDialog } from './CreateComponentDialog'
import { DeleteComponentDialog } from './DeleteComponentDialog'
import { EditComponentDialog } from './EditComponentDialog'
import { ImportComponentDialog } from './ImportComponentDialog'
import {
  buildExportPayload,
  downloadComponentFile,
  readComponentFile,
  resolveImportComponents,
} from '../utils/componentFile'
import type { ImportResolution } from '../utils/componentFile'
import './Palette.css'

// 1x1 transparent image to suppress browser drag ghost
const emptyDragImage = document.createElement('canvas')
emptyDragImage.width = 1
emptyDragImage.height = 1

const GATES: { type: GateType; label: string }[] = [
  { type: 'NAND', label: 'NAND' },
  { type: 'NOR', label: 'NOR' },
  { type: 'SR_LATCH', label: 'SR Latch' },
  { type: 'SPLIT_MERGE', label: 'Split/Merge' },
]

export function Palette() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState<CustomComponentId | null>(null)
  const [editTargetId, setEditTargetId] = useState<CustomComponentId | null>(null)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [importResolution, setImportResolution] = useState<ImportResolution | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const setDrag = useStore((s) => s.setDrag)
  const customComponents = useStore((s) => s.customComponents)
  const editingCustomComponentId = useStore((s) => s.editingCustomComponentId)

  const handleDragStart = (e: React.DragEvent, componentType: ComponentType) => {
    e.dataTransfer.setDragImage(emptyDragImage, 0, 0)
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

  const handleDeleteCustomComponent = (e: React.MouseEvent, id: CustomComponentId) => {
    e.stopPropagation()
    e.preventDefault()
    setDeleteTargetId(id)
    setDeleteDialogOpen(true)
  }

  const handleEditCustomComponent = (e: React.MouseEvent, id: CustomComponentId) => {
    e.stopPropagation()
    e.preventDefault()
    setEditTargetId(id)
    setEditDialogOpen(true)
  }

  const handleExportComponent = (e: React.MouseEvent, id: CustomComponentId) => {
    e.stopPropagation()
    e.preventDefault()
    const def = customComponents.get(id)
    if (!def) return
    const payload = buildExportPayload([id], customComponents)
    const safeName = def.name.replace(/[^a-zA-Z0-9_-]/g, '_')
    downloadComponentFile(payload, safeName)
  }

  const handleExportAll = () => {
    const allIds = Array.from(customComponents.keys())
    const payload = buildExportPayload(allIds, customComponents)
    downloadComponentFile(payload, 'all-components')
  }

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Reset input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (!file) return

    try {
      const payload = await readComponentFile(file)
      const resolution = resolveImportComponents(payload, customComponents)
      setImportResolution(resolution)
      setImportError(null)
    } catch (err) {
      setImportResolution(null)
      setImportError(err instanceof Error ? err.message : 'Unknown error reading file')
    }
    setImportDialogOpen(true)
  }

  const closeImportDialog = () => {
    setImportDialogOpen(false)
    setImportResolution(null)
    setImportError(null)
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
        <div className="palette-section palette-section-custom">
          <div className="palette-section-header">
            <h4>Custom</h4>
            <button className="export-all-btn" onClick={handleExportAll} title="Export all components">
              Export All
            </button>
          </div>
          <div className="palette-custom-list">
            {sortedCustomComponents.map((def) => (
              <div
                key={def.id}
                className={`palette-item custom${
                  editingCustomComponentId === def.id ? ' is-editing' : ''
                }`}
                draggable
                onDragStart={(e) => handleDragStart(e, def.id)}
              >
                <div className="gate-icon gate-custom">{def.name}</div>
                <div className="custom-actions">
                  <button
                    className="export-btn"
                    onClick={(e) => handleExportComponent(e, def.id)}
                    title="Export component"
                  >
                    ↓
                  </button>
                  <button
                    className="edit-btn"
                    onClick={(e) => handleEditCustomComponent(e, def.id)}
                    title="Edit component"
                  >
                    Edit
                  </button>
                  <button
                    className="delete-btn"
                    onClick={(e) => handleDeleteCustomComponent(e, def.id)}
                    title="Delete component"
                  >
                    x
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="palette-actions">
        {editingCustomComponentId ? (
          <button className="create-component-btn" onClick={() => setDialogOpen(true)}>
            Save
          </button>
        ) : (
          <button className="create-component-btn" onClick={() => setDialogOpen(true)}>
            + Create Component
          </button>
        )}
        <button className="import-btn" onClick={handleImportClick}>
          Import
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".lgc,.json"
          style={{ display: 'none' }}
          onChange={handleFileSelected}
        />
      </div>

      <CreateComponentDialog isOpen={dialogOpen} onClose={() => setDialogOpen(false)} />
      <DeleteComponentDialog
        isOpen={deleteDialogOpen}
        componentId={deleteTargetId}
        onClose={() => {
          setDeleteDialogOpen(false)
          setDeleteTargetId(null)
        }}
      />
      <EditComponentDialog
        isOpen={editDialogOpen}
        componentId={editTargetId}
        onClose={() => {
          setEditDialogOpen(false)
          setEditTargetId(null)
        }}
      />
      <ImportComponentDialog
        isOpen={importDialogOpen}
        resolution={importResolution}
        error={importError}
        onDone={closeImportDialog}
        onClose={closeImportDialog}
      />
    </div>
  )
}
