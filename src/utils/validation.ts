import type { Circuit, InputId, OutputId, ComponentId } from '../types'

export type ValidationError =
  | { type: 'unused_input'; inputId: InputId; label: string }
  | { type: 'unused_output'; outputId: OutputId; label: string }
  | { type: 'disconnected_component'; componentId: ComponentId; issue: 'no_input' | 'no_output' }
  | { type: 'no_inputs' }
  | { type: 'no_outputs' }
  | { type: 'empty_circuit' }

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
}

export function validateCircuitForComponent(circuit: Circuit): ValidationResult {
  const errors: ValidationError[] = []

  // Check for empty circuit
  if (circuit.components.length === 0) {
    errors.push({ type: 'empty_circuit' })
    return { valid: false, errors }
  }

  // Must have at least one input and one output
  if (circuit.inputs.length === 0) {
    errors.push({ type: 'no_inputs' })
  }
  if (circuit.outputs.length === 0) {
    errors.push({ type: 'no_outputs' })
  }

  // All input board pins must be used (as wire sources)
  const usedInputIds = new Set(
    circuit.wires
      .filter((w) => w.source.type === 'input')
      .map((w) => (w.source as { type: 'input'; inputId: InputId }).inputId)
  )
  for (const input of circuit.inputs) {
    if (!usedInputIds.has(input.id)) {
      errors.push({ type: 'unused_input', inputId: input.id, label: input.label })
    }
  }

  // All output board pins must be used (as wire targets)
  const usedOutputIds = new Set(
    circuit.wires
      .filter((w) => w.target.type === 'output')
      .map((w) => (w.target as { type: 'output'; outputId: OutputId }).outputId)
  )
  for (const output of circuit.outputs) {
    if (!usedOutputIds.has(output.id)) {
      errors.push({ type: 'unused_output', outputId: output.id, label: output.label })
    }
  }

  // All components must have at least one input AND output connected
  for (const component of circuit.components) {
    const hasConnectedInput = circuit.wires.some(
      (w) => w.target.type === 'component' && w.target.componentId === component.id
    )
    const hasConnectedOutput = circuit.wires.some(
      (w) => w.source.type === 'component' && w.source.componentId === component.id
    )

    if (!hasConnectedInput) {
      errors.push({ type: 'disconnected_component', componentId: component.id, issue: 'no_input' })
    }
    if (!hasConnectedOutput) {
      errors.push({ type: 'disconnected_component', componentId: component.id, issue: 'no_output' })
    }
  }

  return { valid: errors.length === 0, errors }
}

export function formatValidationError(error: ValidationError): string {
  switch (error.type) {
    case 'unused_input':
      return `Input "${error.label}" is not connected`
    case 'unused_output':
      return `Output "${error.label}" is not connected`
    case 'disconnected_component':
      return error.issue === 'no_input'
        ? 'A component has no inputs connected'
        : 'A component has no outputs connected'
    case 'no_inputs':
      return 'Circuit must have at least one input'
    case 'no_outputs':
      return 'Circuit must have at least one output'
    case 'empty_circuit':
      return 'Circuit has no components'
    default:
      return 'Unknown validation error'
  }
}
