import type { Circuit, Wire, PinDefinition, CustomComponentId, CustomComponentDefinition, ComponentType } from '../types'
import { GATE_DEFINITIONS, isPrimitiveGate } from '../types'
import type { Netlist, Net, NetId, CompiledComponent, ValidationError, NetDriver, NetReader } from './types'
import { topologicalSort } from './topological'

// Helper to get component definition for any component type
export function getComponentDefinition(
  type: ComponentType,
  customComponents?: Map<CustomComponentId, CustomComponentDefinition>
): { width: number; height: number; pins: PinDefinition[] } | null {
  if (isPrimitiveGate(type)) {
    return GATE_DEFINITIONS[type]
  }

  const customDef = customComponents?.get(type as CustomComponentId)
  if (customDef) {
    return {
      width: customDef.width,
      height: customDef.height,
      pins: customDef.pins,
    }
  }

  return null
}

interface CompileInternalResult {
  netlist: Netlist
  pinToNet: Map<string, NetId>
}

function compileInternal(
  circuit: Circuit,
  customComponents?: Map<CustomComponentId, CustomComponentDefinition>
): CompileInternalResult {
  const errors: ValidationError[] = []
  const nets: Net[] = []
  const netMap = new Map<string, NetId>() // pinKey -> netId

  // Helper to get unique key for a pin
  function getPinKey(endpoint: Wire['source'] | Wire['target']): string {
    if (endpoint.type === 'component') {
      return `c:${endpoint.componentId}:${endpoint.pinIndex}`
    } else if (endpoint.type === 'input') {
      return `i:${endpoint.inputId}`
    } else {
      return `o:${endpoint.outputId}`
    }
  }

  // Helper to get or create net for a pin
  function getOrCreateNet(key: string): NetId {
    if (netMap.has(key)) {
      return netMap.get(key)!
    }
    const netId = nets.length as NetId
    nets.push({
      id: netId,
      driver: null,
      readers: [],
      value: false,
    })
    netMap.set(key, netId)
    return netId
  }

  // Process all wires
  for (const wire of circuit.wires) {
    const sourceKey = getPinKey(wire.source)
    const targetKey = getPinKey(wire.target)

    // Source and target should share the same net
    let netId: NetId

    if (netMap.has(sourceKey) && netMap.has(targetKey)) {
      // Both already exist - they should be the same net
      // If not, merge them (for simplicity, we'll just use source's net)
      netId = netMap.get(sourceKey)!
      const targetNetId = netMap.get(targetKey)!
      if (netId !== targetNetId) {
        // Merge: move all readers from target net to source net
        const targetNet = nets[targetNetId]!
        const sourceNet = nets[netId]!
        sourceNet.readers.push(...targetNet.readers)
        if (targetNet.driver && sourceNet.driver) {
          errors.push({
            type: 'multiple_drivers',
            targetDesc: targetKey,
          })
        } else if (targetNet.driver) {
          sourceNet.driver = targetNet.driver
        }
        // Update all pins pointing to target net
        for (const [key, id] of netMap) {
          if (id === targetNetId) {
            netMap.set(key, netId)
          }
        }
      }
    } else if (netMap.has(sourceKey)) {
      netId = netMap.get(sourceKey)!
      netMap.set(targetKey, netId)
    } else if (netMap.has(targetKey)) {
      netId = netMap.get(targetKey)!
      netMap.set(sourceKey, netId)
    } else {
      netId = getOrCreateNet(sourceKey)
      netMap.set(targetKey, netId)
    }

    const net = nets[netId]!

    // Set driver (source is always a driver)
    const driver: NetDriver =
      wire.source.type === 'input'
        ? { type: 'input', inputId: wire.source.inputId }
        : { type: 'component', componentId: wire.source.componentId, pinIndex: wire.source.pinIndex }

    if (net.driver === null) {
      net.driver = driver
    } else if (
      !(
        net.driver.type === driver.type &&
        ((net.driver.type === 'input' && driver.type === 'input' && net.driver.inputId === driver.inputId) ||
          (net.driver.type === 'component' &&
            driver.type === 'component' &&
            net.driver.componentId === driver.componentId &&
            net.driver.pinIndex === driver.pinIndex))
      )
    ) {
      // Different driver - error
      errors.push({
        type: 'multiple_drivers',
        targetDesc: `net ${netId}`,
      })
    }

    // Add reader (target is always a reader)
    const reader: NetReader =
      wire.target.type === 'output'
        ? { type: 'output', outputId: wire.target.outputId }
        : { type: 'component', componentId: wire.target.componentId, pinIndex: wire.target.pinIndex }

    // Avoid duplicate readers
    const readerExists = net.readers.some((r) => {
      if (r.type !== reader.type) return false
      if (r.type === 'output' && reader.type === 'output') {
        return r.outputId === reader.outputId
      }
      if (r.type === 'component' && reader.type === 'component') {
        return r.componentId === reader.componentId && r.pinIndex === reader.pinIndex
      }
      return false
    })

    if (!readerExists) {
      net.readers.push(reader)
    }
  }

  // Build compiled components
  const compiledComponents: CompiledComponent[] = []

  for (const component of circuit.components) {
    const def = getComponentDefinition(component.type, customComponents)
    if (!def) {
      console.warn('Unknown component type:', component.type)
      continue
    }

    const inputPins = def.pins.filter((p) => p.direction === 'input')
    const outputPins = def.pins.filter((p) => p.direction === 'output')

    const inputNetIds: NetId[] = []

    for (const pin of inputPins) {
      const key = `c:${component.id}:${pin.index}`
      if (netMap.has(key)) {
        inputNetIds.push(netMap.get(key)!)
      } else {
        // Floating input - create a net with no driver
        const netId = nets.length as NetId
        nets.push({
          id: netId,
          driver: null,
          readers: [{ type: 'component', componentId: component.id, pinIndex: pin.index }],
          value: false,
        })
        netMap.set(key, netId)
        inputNetIds.push(netId)

        errors.push({
          type: 'floating_input',
          componentId: component.id,
          pinIndex: pin.index,
        })
      }
    }

    // Output pins - might not be connected (that's ok, just no readers)
    const outputNetIds: NetId[] = []

    for (const outputPin of outputPins) {
      const outputKey = `c:${component.id}:${outputPin.index}`
      let outputNetId: NetId

      if (netMap.has(outputKey)) {
        outputNetId = netMap.get(outputKey)!
      } else {
        outputNetId = nets.length as NetId
        nets.push({
          id: outputNetId,
          driver: { type: 'component', componentId: component.id, pinIndex: outputPin.index },
          readers: [],
          value: false,
        })
        netMap.set(outputKey, outputNetId)
      }

      outputNetIds.push(outputNetId)
    }

    compiledComponents.push({
      id: component.id,
      type: component.type,
      inputNetIds,
      outputNetIds,
    })
  }

  // Check for floating outputs
  for (const output of circuit.outputs) {
    const key = `o:${output.id}`
    if (!netMap.has(key)) {
      errors.push({
        type: 'floating_output',
        outputId: output.id,
      })
    }
  }

  // Topological sort
  const { order, hasCycle, cycleComponents } = topologicalSort(compiledComponents, nets)

  if (hasCycle) {
    errors.push({
      type: 'cycle',
      involvedComponents: cycleComponents,
    })
  }

  // Only cycles and multiple drivers are hard errors that prevent simulation
  // Floating inputs/outputs are warnings - simulation can proceed with default values
  const hasHardErrors = errors.some(
    (e) => e.type === 'cycle' || e.type === 'multiple_drivers'
  )

  return {
    netlist: {
      nets,
      components: compiledComponents,
      topoOrder: order,
      valid: !hasHardErrors,
      errors,
    },
    pinToNet: netMap,
  }
}

export function compile(
  circuit: Circuit,
  customComponents?: Map<CustomComponentId, CustomComponentDefinition>
): Netlist {
  return compileInternal(circuit, customComponents).netlist
}

export function compileWithPinMap(
  circuit: Circuit,
  customComponents?: Map<CustomComponentId, CustomComponentDefinition>
): CompileInternalResult {
  return compileInternal(circuit, customComponents)
}
