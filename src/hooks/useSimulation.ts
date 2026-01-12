import { useMemo } from 'react'
import { useStore } from '../store'
import { compile, evaluate, getComponentDefinition } from '../simulation'
import type { OutputId, WireId, ComponentId } from '../types'

export interface SimulationResult {
  outputValues: Map<OutputId, boolean>
  wireValues: Map<WireId, boolean>
  componentPinValues: Map<ComponentId, Map<number, boolean>>
}

export function useSimulation(): SimulationResult {
  const circuit = useStore((s) => s.circuit)
  const customComponents = useStore((s) => s.customComponents)

  return useMemo(() => {
    const emptyResult: SimulationResult = {
      outputValues: new Map(),
      wireValues: new Map(),
      componentPinValues: new Map(),
    }

    // Compile circuit to netlist
    const netlist = compile(circuit, customComponents)

    if (!netlist.valid) {
      // Return empty results for circuits with hard errors (cycles, multiple drivers)
      const hardErrors = netlist.errors.filter(
        (e) => e.type === 'cycle' || e.type === 'multiple_drivers'
      )
      console.warn('Circuit errors:', hardErrors)
      return emptyResult
    }

    // Evaluate netlist (this sets net.value on all nets)
    const inputValues = new Map(circuit.inputs.map((i) => [i.id, i.value]))
    const outputValues = evaluate(netlist, inputValues, customComponents)

    // Compute wire values from the evaluated netlist
    const wireValues = new Map<WireId, boolean>()

    for (const wire of circuit.wires) {
      let value = false
      const source = wire.source

      if (source.type === 'input') {
        // Wire from input board: use the input's current value
        const input = circuit.inputs.find((i) => i.id === source.inputId)
        value = input?.value ?? false
      } else {
        // Wire from component output: find the component and its output net
        const comp = netlist.components.find((c) => c.id === source.componentId)
        if (comp) {
          // Find the output net for this specific pin
          const def = getComponentDefinition(comp.type, customComponents)
          if (def) {
            const outputPins = def.pins.filter((p) => p.direction === 'output')
            const outputPinIdx = outputPins.findIndex((p) => p.index === source.pinIndex)
            if (outputPinIdx >= 0 && outputPinIdx < comp.outputNetIds.length) {
              const netId = comp.outputNetIds[outputPinIdx]
              if (netId !== undefined) {
                const net = netlist.nets[netId]
                value = net?.value ?? false
              }
            }
          }
        }
      }

      wireValues.set(wire.id, value)
    }

    // Compute component pin values (for showing output pin states without wires)
    const componentPinValues = new Map<ComponentId, Map<number, boolean>>()

    for (const comp of netlist.components) {
      const def = getComponentDefinition(comp.type, customComponents)
      if (!def) continue

      const pinValues = new Map<number, boolean>()

      // Get output pin values from the evaluated nets
      const outputPins = def.pins.filter((p) => p.direction === 'output')
      outputPins.forEach((pin, idx) => {
        const netId = comp.outputNetIds[idx]
        if (netId !== undefined) {
          const net = netlist.nets[netId]
          pinValues.set(pin.index, net?.value ?? false)
        }
      })

      // Get input pin values from connected nets
      const inputPins = def.pins.filter((p) => p.direction === 'input')
      inputPins.forEach((pin, idx) => {
        const netId = comp.inputNetIds[idx]
        if (netId !== undefined) {
          const net = netlist.nets[netId]
          pinValues.set(pin.index, net?.value ?? false)
        }
      })

      componentPinValues.set(comp.id, pinValues)
    }

    return { outputValues, wireValues, componentPinValues }
  }, [circuit, customComponents])
}
