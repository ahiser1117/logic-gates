import type { Netlist } from './types'
import type {
  InputId,
  OutputId,
  PrimitiveGateType,
  CustomComponentId,
  CustomComponentDefinition,
  Circuit,
} from '../types'
import { isPrimitiveGate } from '../types'
import { compile } from './compiler'

// Gate evaluation functions for primitive gates
const GATE_FUNCTIONS: Record<PrimitiveGateType, (inputs: boolean[]) => boolean> = {
  NAND: (inputs) => !(inputs[0] && inputs[1]),
  NOR: (inputs) => !(inputs[0] || inputs[1]),
}

// Evaluate a custom component by recursively compiling and evaluating its internal circuit
function evaluateCustomComponent(
  inputs: boolean[],
  definition: CustomComponentDefinition,
  customComponents: Map<CustomComponentId, CustomComponentDefinition>,
  depth: number = 0
): boolean[] {
  // Prevent infinite recursion
  if (depth > 100) {
    console.error('Maximum recursion depth exceeded in custom component evaluation')
    return definition.circuit.outputs.map(() => false)
  }

  // Build internal circuit with input values
  const internalCircuit: Circuit = {
    id: `internal-${definition.id}`,
    name: definition.name,
    inputs: definition.circuit.inputs.map((pin, i) => ({
      id: pin.id,
      label: pin.label,
      value: inputs[i] ?? false,
      order: pin.order,
    })),
    outputs: definition.circuit.outputs.map((pin) => ({
      id: pin.id as OutputId,
      label: pin.label,
      order: pin.order,
    })),
    components: definition.circuit.components,
    wires: definition.circuit.wires,
    inputBoard: { x: 0, y: 0 },
    outputBoard: { x: 0, y: 0 },
  }

  // Compile and evaluate
  const netlist = compile(internalCircuit, customComponents)
  if (!netlist.valid) {
    return definition.circuit.outputs.map(() => false)
  }

  const internalInputs = new Map(
    definition.circuit.inputs.map((pin, i) => [pin.id, inputs[i] ?? false])
  )

  const outputValues = evaluate(netlist, internalInputs, customComponents, depth + 1)

  // Return outputs in order
  return [...definition.circuit.outputs]
    .sort((a, b) => a.order - b.order)
    .map((pin) => outputValues.get(pin.id as OutputId) ?? false)
}

export function evaluate(
  netlist: Netlist,
  inputValues: Map<InputId, boolean>,
  customComponents?: Map<CustomComponentId, CustomComponentDefinition>,
  depth: number = 0
): Map<OutputId, boolean> {
  if (!netlist.valid) {
    return new Map()
  }

  // Reset all net values
  for (const net of netlist.nets) {
    net.value = false
  }

  // Set input net values
  for (const net of netlist.nets) {
    if (net.driver?.type === 'input') {
      net.value = inputValues.get(net.driver.inputId) ?? false
    }
  }

  // Evaluate components in topological order
  for (const compIdx of netlist.topoOrder) {
    const comp = netlist.components[compIdx]!

    // Gather input values
    const inputVals = comp.inputNetIds.map((netId) => {
      const net = netlist.nets[netId]
      return net?.value ?? false
    })

    if (isPrimitiveGate(comp.type)) {
      // Primitive gate - use direct evaluation
      const outputVal = GATE_FUNCTIONS[comp.type](inputVals)

      // Set output net value (primitive gates have exactly one output)
      const outputNetId = comp.outputNetIds[0]
      if (outputNetId !== undefined) {
        const outputNet = netlist.nets[outputNetId]
        if (outputNet) {
          outputNet.value = outputVal
        }
      }
    } else {
      // Custom component - recursive evaluation
      const customDef = customComponents?.get(comp.type as CustomComponentId)
      if (customDef) {
        const outputVals = evaluateCustomComponent(inputVals, customDef, customComponents!, depth)

        // Set all output net values
        comp.outputNetIds.forEach((netId, i) => {
          const net = netlist.nets[netId]
          if (net) {
            net.value = outputVals[i] ?? false
          }
        })
      }
    }
  }

  // Collect output values
  const outputs = new Map<OutputId, boolean>()

  for (const net of netlist.nets) {
    for (const reader of net.readers) {
      if (reader.type === 'output') {
        outputs.set(reader.outputId, net.value)
      }
    }
  }

  return outputs
}
