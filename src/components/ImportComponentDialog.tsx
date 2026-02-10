import { useEffect, useState, useCallback } from 'react'
import { useStore } from '../store'
import type { ImportResolution, ConflictChoice } from '../utils/componentFile'
import { prepareImport } from '../utils/componentFile'
import type { CustomComponentId } from '../types'
import { useDialogKeyboard } from '../hooks/useDialogKeyboard'
import './CreateComponentDialog.css'

interface Props {
  isOpen: boolean
  resolution: ImportResolution | null
  error: string | null
  onDone: () => void
  onClose: () => void
}

export function ImportComponentDialog({ isOpen, resolution, error, onDone, onClose }: Props) {
  const customComponents = useStore((s) => s.customComponents)
  const importComponents = useStore((s) => s.importComponents)

  const [conflictChoices, setConflictChoices] = useState<Map<CustomComponentId, ConflictChoice>>(new Map())

  // Reset choices when resolution changes
  useEffect(() => {
    if (resolution) {
      const defaults = new Map<CustomComponentId, ConflictChoice>()
      for (const conflict of resolution.nameConflicts) {
        defaults.set(conflict.incoming.id, 'skip')
      }
      setConflictChoices(defaults)
    }
  }, [resolution])

  const hasImportableWork = resolution
    ? resolution.newComponents.length > 0 ||
      resolution.nameConflicts.some(
        (c) => conflictChoices.get(c.incoming.id) === 'replace'
      )
    : false

  const handleImport = useCallback(() => {
    if (!resolution) return
    const plan = prepareImport(resolution, conflictChoices, customComponents)
    if (plan.toInsert.length > 0 || plan.toRemove.length > 0 || plan.toUpdate.length > 0) {
      importComponents(plan.toInsert, plan.toRemove, plan.toUpdate)
    }
    onDone()
  }, [resolution, conflictChoices, customComponents, importComponents, onDone])

  useDialogKeyboard(isOpen, onClose, hasImportableWork ? handleImport : null)

  if (!isOpen) return null

  if (error) {
    return (
      <div className="dialog-overlay" onClick={onClose}>
        <div className="dialog" onClick={(e) => e.stopPropagation()}>
          <h2>Import Failed</h2>
          <div className="dialog-errors">
            <p className="error">{error}</p>
          </div>
          <div className="dialog-buttons">
            <button onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    )
  }

  if (!resolution) return null

  const { newComponents, skippedCount, skippedNames, nameConflicts } = resolution
  const replaceCount = nameConflicts.filter(
    (c) => conflictChoices.get(c.incoming.id) === 'replace'
  ).length
  const totalNew = newComponents.length + replaceCount

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Import Components</h2>

        {newComponents.length > 0 && (
          <div className="dialog-info">
            <p>
              <strong>{newComponents.length}</strong> new component{newComponents.length !== 1 ? 's' : ''}:
            </p>
            {newComponents.map((def) => (
              <p key={def.id}>{def.name}</p>
            ))}
          </div>
        )}

        {skippedCount > 0 && (
          <div className="dialog-info">
            <p>
              <strong>{skippedCount}</strong> component{skippedCount !== 1 ? 's' : ''} already
              exist and will be skipped:
            </p>
            {skippedNames.map((name, i) => (
              <p key={i}>{name}</p>
            ))}
          </div>
        )}

        {nameConflicts.length > 0 && (
          <div className="dialog-warning">
            <p>
              <strong>{nameConflicts.length}</strong> component{nameConflicts.length !== 1 ? 's have' : ' has'} a
              name conflict:
            </p>
            {nameConflicts.map((conflict) => {
              const choice = conflictChoices.get(conflict.incoming.id) ?? 'skip'
              return (
                <div key={conflict.incoming.id} className="import-conflict">
                  <p className="import-conflict-name">
                    "{conflict.incoming.name}" already exists with a different ID
                  </p>
                  <div className="import-conflict-choices">
                    <button
                      className={choice === 'skip' ? 'active' : ''}
                      onClick={() => {
                        const next = new Map(conflictChoices)
                        next.set(conflict.incoming.id, 'skip')
                        setConflictChoices(next)
                      }}
                    >
                      Skip
                    </button>
                    <button
                      className={choice === 'replace' ? 'active' : ''}
                      onClick={() => {
                        const next = new Map(conflictChoices)
                        next.set(conflict.incoming.id, 'replace')
                        setConflictChoices(next)
                      }}
                    >
                      Replace
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {totalNew === 0 && nameConflicts.length === 0 && (
          <div className="dialog-info">
            <p>All components in this file already exist in your library.</p>
          </div>
        )}

        <div className="dialog-buttons">
          <button onClick={onClose}>Cancel</button>
          {(totalNew > 0 || hasImportableWork) && (
            <button onClick={handleImport} className="primary">
              Import{totalNew > 0 ? ` (${totalNew})` : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
