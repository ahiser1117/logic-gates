import type { Netlist } from './types'
import type {
  InputId,
  OutputId,
  ComponentId,
  PrimitiveGateType,
  CustomComponentId,
  CustomComponentDefinition,
  Circuit,
} from '../types'
import { isPrimitiveGate } from '../types'
import { compile } from './compiler'

// === SR Latch State ===
// Keyed by instance path: "compId" for top-level, "parentId/childId" for nested
const latchStates = new Map<string, { q: boolean }>()

export function resetLatchStates(): void {
  latchStates.clear()
}

export function removeLatchState(id: ComponentId): void {
  const prefix = String(id)
  for (const key of latchStates.keys()) {
    if (key === prefix || key.startsWith(prefix + '/')) {
      latchStates.delete(key)
    }
  }
}

function createDefaultValue(bitWidth: number): boolean | boolean[] {
  return bitWidth === 1 ? false : new Array(bitWidth).fill(false)
}

// Gate evaluation functions for primitive gates
const GATE_FUNCTIONS: Record<PrimitiveGateType, (inputs: boolean[]) => boolean> = {
  NAND: (inputs) => !(inputs[0] && inputs[1]),
  NOR: (inputs) => !(inputs[0] || inputs[1]),
  SR_LATCH: () => false, // Placeholder — SR Latch uses special-case evaluation
  SPLIT_MERGE: (inputs) => inputs[0] ?? false,
}

// Evaluate a custom component by recursively compiling and evaluating its internal circuit
function evaluateCustomComponent(
  inputs: (boolean | boolean[])[],
  definition: CustomComponentDefinition,
  customComponents: Map<CustomComponentId, CustomComponentDefinition>,
  depth: number = 0,
  instancePath: string = ''
): (boolean | boolean[])[] {
  // Prevent infinite recursion
  if (depth > 100) {
    console.error('Maximum recursion depth exceeded in custom component evaluation')
    return definition.circuit.outputs.map((o) => createDefaultValue(o.bitWidth ?? 1))
  }

  // Build internal circuit with input values
  const internalCircuit: Circuit = {
    id: `internal-${definition.id}`,
    name: definition.name,
    inputs: definition.circuit.inputs.map((pin, i) => ({
      id: pin.id,
      label: pin.label,
      value: inputs[i] ?? false,
      bitWidth: pin.bitWidth ?? 1,
      order: pin.order,
    })),
    outputs: definition.circuit.outputs.map((pin) => ({
      id: pin.id as OutputId,
      label: pin.label,
      bitWidth: pin.bitWidth ?? 1,
      order: pin.order,
    })),
    components: definition.circuit.components,
    wires: definition.circuit.wires,
    inputBoard: definition.circuit.inputBoard,
    outputBoard: definition.circuit.outputBoard,
  }

  // Compile and evaluate
  const netlist = compile(internalCircuit, customComponents)
  if (!netlist.valid) {
    return definition.circuit.outputs.map((o) => createDefaultValue(o.bitWidth ?? 1))
  }

  const internalInputs = new Map<InputId, boolean | boolean[]>(
    definition.circuit.inputs.map((pin, i) => [pin.id, inputs[i] ?? false])
  )

  const outputValues = evaluate(netlist, internalInputs, customComponents, depth + 1, instancePath)

  // Return outputs in order
  return [...definition.circuit.outputs]
    .sort((a, b) => a.order - b.order)
    .map((pin) => {
      const value = outputValues.get(pin.id as OutputId)
      if (value !== undefined) return value
      return createDefaultValue(pin.bitWidth ?? 1)
    })
}

export function evaluate(
  netlist: Netlist,
  inputValues: Map<InputId, boolean | boolean[]>,
  customComponents?: Map<CustomComponentId, CustomComponentDefinition>,
  depth: number = 0,
  instancePath: string = ''
): Map<OutputId, boolean | boolean[]> {
  if (!netlist.valid) {
    return new Map()
  }

  // Reset all net values
  for (const net of netlist.nets) {
    net.value = createDefaultValue(net.bitWidth)
  }

  // Set input net values
  for (const net of netlist.nets) {
    if (net.driver?.type === 'input') {
      const inputValue = inputValues.get(net.driver.inputId)
      if (inputValue !== undefined) {
        net.value = inputValue
      }
    }
  }

  // Helper to extract boolean from net value (use bit 0 for multi-bit)
  const getBooleanFromValue = (value: boolean | boolean[]): boolean => {
    if (Array.isArray(value)) {
      return value[0] ?? false
    }
    return value
  }

  // Evaluate components in topological order
  for (const compIdx of netlist.topoOrder) {
    const comp = netlist.components[compIdx]!

    // Gather input values (extract bit 0 for primitive gate evaluation)
    const inputVals = comp.inputNetIds.map((netId) => {
      const net = netlist.nets[netId]
      return getBooleanFromValue(net?.value ?? false)
    })

    if (isPrimitiveGate(comp.type)) {
      if (comp.type === 'SR_LATCH') {
        const s = inputVals[0] ?? false
        const r = inputVals[1] ?? false

        const stateKey = instancePath ? `${instancePath}/${comp.id}` : String(comp.id)
        let prev = latchStates.get(stateKey)
        if (!prev) {
          prev = { q: false }
          latchStates.set(stateKey, prev)
        }

        let q: boolean
        let qBar: boolean

        if (s && r) {
          // Invalid: output 0,0 but don't update stored state
          q = false
          qBar = false
        } else if (s) {
          q = true
          qBar = false
          prev.q = true
        } else if (r) {
          q = false
          qBar = true
          prev.q = false
        } else {
          // Hold
          q = prev.q
          qBar = !prev.q
        }

        const qNetId = comp.outputNetIds[0]
        if (qNetId !== undefined) {
          const qNet = netlist.nets[qNetId]
          if (qNet) qNet.value = q
        }
        const qBarNetId = comp.outputNetIds[1]
        if (qBarNetId !== undefined) {
          const qBarNet = netlist.nets[qBarNetId]
          if (qBarNet) qBarNet.value = qBar
        }
      } else if (comp.type === 'SPLIT_MERGE') {
        const config = comp.splitMergeConfig
        if (!config) {
          continue
        }

        const totalWidth = config.partitions.reduce((sum, size) => sum + size, 0)

        if (config.mode === 'split') {
          const busNetId = comp.inputNetIds[0]
          const busNet = busNetId !== undefined ? netlist.nets[busNetId] : undefined
          const busValue = busNet?.value ?? new Array(totalWidth).fill(false)
          const busArray = Array.isArray(busValue)
            ? busValue
            : [busValue]

          let offset = 0
          comp.outputNetIds.forEach((netId, index) => {
            const net = netlist.nets[netId]
            if (!net) return
            const width = config.partitions[index] ?? 1
            const slice = busArray.slice(offset, offset + width)
            const outputValue = width === 1 ? (slice[0] ?? false) : slice
            net.value = outputValue
            offset += width
          })
        } else {
          const merged: boolean[] = []
          config.partitions.forEach((width, index) => {
            const netId = comp.inputNetIds[index]
            const net = netId !== undefined ? netlist.nets[netId] : undefined
            const value = net?.value ?? new Array(width).fill(false)
            const bits = Array.isArray(value) ? value : [value]
            for (let i = 0; i < width; i++) {
              merged.push(bits[i] ?? false)
            }
          })

          const outputNetId = comp.outputNetIds[0]
          const outputNet = outputNetId !== undefined ? netlist.nets[outputNetId] : undefined
          if (outputNet) {
            outputNet.value = totalWidth === 1 ? (merged[0] ?? false) : merged
          }
        }
      } else {
        // Primitive gate - use direct evaluation (single-bit only)
        const outputVal = GATE_FUNCTIONS[comp.type](inputVals)

        // Set output net value (primitive gates have exactly one output)
        const outputNetId = comp.outputNetIds[0]
        if (outputNetId !== undefined) {
          const outputNet = netlist.nets[outputNetId]
          if (outputNet) {
            outputNet.value = outputVal
          }
        }
      }
    } else {
      // Custom component - recursive evaluation with full multi-bit support
      const customDef = customComponents?.get(comp.type as CustomComponentId)
      if (customDef) {
        // Get raw net values (preserving multi-bit)
        const rawInputVals = comp.inputNetIds.map((netId) => {
          const net = netlist.nets[netId]
          return net?.value ?? false
        })
        const compPath = instancePath ? `${instancePath}/${comp.id}` : String(comp.id)
        const outputVals = evaluateCustomComponent(rawInputVals, customDef, customComponents!, depth, compPath)

        // Set all output net values
        comp.outputNetIds.forEach((netId, i) => {
          const net = netlist.nets[netId]
          if (net) {
            net.value = outputVals[i] ?? createDefaultValue(net.bitWidth)
          }
        })
      }
    }
  }

  // Collect output values
  const outputs = new Map<OutputId, boolean | boolean[]>()

  for (const net of netlist.nets) {
    for (const reader of net.readers) {
      if (reader.type === 'output') {
        outputs.set(reader.outputId, net.value)
      }
    }
  }

  return outputs
}
