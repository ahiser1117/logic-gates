import { useMemo } from 'react'
import { useStore } from '../store'
import { compile, evaluate, getComponentDefinition } from '../simulation'
import type { OutputId, WireId } from '../types'

export interface SimulationResult {
  outputValues: Map<OutputId, boolean>
  wireValues: Map<WireId, boolean>
}

export function useSimulation(): SimulationResult {
  const circuit = useStore((s) => s.circuit)
  const customComponents = useStore((s) => s.customComponents)

  return useMemo(() => {
    const emptyResult: SimulationResult = {
      outputValues: new Map(),
      wireValues: new Map(),
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

    return { outputValues, wireValues }
  }, [circuit, customComponents])
}
