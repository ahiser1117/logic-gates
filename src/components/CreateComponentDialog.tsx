import { useState, useEffect } from 'react'
import { useStore } from '../store'
import { validateCircuitForComponent, formatValidationError } from '../utils/validation'
import './CreateComponentDialog.css'

interface Props {
  isOpen: boolean
  onClose: () => void
}

export function CreateComponentDialog({ isOpen, onClose }: Props) {
  const [name, setName] = useState('')
  const [errors, setErrors] = useState<string[]>([])

  const circuit = useStore((s) => s.circuit)
  const customComponents = useStore((s) => s.customComponents)
  const createCustomComponent = useStore((s) => s.createCustomComponent)

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setName('')
      setErrors([])
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleValidate = (): boolean => {
    const validationErrors: string[] = []

    // Check name
    if (!name.trim()) {
      validationErrors.push('Component name is required')
    } else {
      // Check duplicate name
      for (const [, def] of customComponents) {
        if (def.name.toLowerCase() === name.trim().toLowerCase()) {
          validationErrors.push(`A component named "${def.name}" already exists`)
          break
        }
      }
    }

    // Validate circuit
    const result = validateCircuitForComponent(circuit)
    if (!result.valid) {
      for (const error of result.errors) {
        validationErrors.push(formatValidationError(error))
      }
    }

    setErrors(validationErrors)
    return validationErrors.length === 0
  }

  const handleCreate = () => {
    if (!handleValidate()) return

    const id = createCustomComponent(name.trim())
    if (id) {
      onClose()
    } else {
      setErrors(['Failed to create component'])
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCreate()
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  const inputLabels = circuit.inputs.map((i) => i.label).join(', ') || 'none'
  const outputLabels = circuit.outputs.map((o) => o.label).join(', ') || 'none'

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <h2>Create Component</h2>

        <div className="dialog-field">
          <label htmlFor="component-name">Name</label>
          <input
            id="component-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., AND, Half Adder"
            autoFocus
          />
        </div>

        <div className="dialog-info">
          <p>
            <strong>Inputs ({circuit.inputs.length}):</strong> {inputLabels}
          </p>
          <p>
            <strong>Outputs ({circuit.outputs.length}):</strong> {outputLabels}
          </p>
          <p>
            <strong>Components:</strong> {circuit.components.length}
          </p>
        </div>

        {errors.length > 0 && (
          <div className="dialog-errors">
            {errors.map((err, i) => (
              <p key={i} className="error">
                {err}
              </p>
            ))}
          </div>
        )}

        <div className="dialog-buttons">
          <button onClick={onClose}>Cancel</button>
          <button onClick={handleCreate} className="primary">
            Create
          </button>
        </div>
      </div>
    </div>
  )
}
