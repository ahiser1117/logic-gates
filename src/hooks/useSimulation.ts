import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import {
  compile,
  compileWithPinMap,
  evaluate,
  flattenCircuit,
  getComponentDefinition,
  createSimulationWorker,
  initSimulationWorker,
  runWorker,
  setWorkerInputs,
  createSharedOutputViews,
} from '../simulation'
import type { NetId, Netlist } from '../simulation'
import type { SharedOutputViews, SimWorkerResponse } from '../simulation'
import type {
  Circuit,
  ComponentId,
  CustomComponentDefinition,
  CustomComponentId,
  InputId,
  OutputId,
  WireId,
} from '../types'

export interface SimulationResult {
  outputValues: Map<OutputId, boolean>
  wireValues: Map<WireId, boolean>
  componentPinValues: Map<ComponentId, Map<number, boolean>>
}

interface InputBatch {
  ids: Uint32Array
  values: Uint8Array
}

function buildInputMap(values: { id: InputId; value: boolean }[]): Map<InputId, boolean> {
  return new Map(values.map((input) => [input.id, input.value]))
}

function buildOutputMap(
  outputIds: Uint32Array | null,
  outputValues: Uint8Array | null,
  netlist: Netlist,
  netValues: Uint8Array
): Map<OutputId, boolean> {
  if (outputIds && outputValues && outputIds.length === outputValues.length) {
    const mapped = new Map<OutputId, boolean>()
    for (let i = 0; i < outputIds.length; i++) {
      mapped.set(outputIds[i]! as OutputId, outputValues[i] === 1)
    }
    return mapped
  }

  const fallback = new Map<OutputId, boolean>()
  for (const net of netlist.nets) {
    for (const reader of net.readers) {
      if (reader.type === 'output') {
        fallback.set(reader.outputId, netValues[net.id] === 1)
      }
    }
  }
  return fallback
}

function getPinKey(endpoint: { type: 'component'; componentId: ComponentId; pinIndex: number } | { type: 'input'; inputId: InputId } | { type: 'output'; outputId: OutputId }): string {
  if (endpoint.type === 'component') {
    return `c:${endpoint.componentId}:${endpoint.pinIndex}`
  }
  if (endpoint.type === 'input') {
    return `i:${endpoint.inputId}`
  }
  return `o:${endpoint.outputId}`
}

function getNetValueForPin(
  pinKey: string,
  netValues: Uint8Array,
  pinToNet: Map<string, NetId>,
  endpointMap: Map<string, string>
): boolean | null {
  const mappedKey = endpointMap.get(pinKey) ?? pinKey
  const netId = pinToNet.get(mappedKey)
  if (netId === undefined) {
    return null
  }
  return netValues[netId] === 1
}

function buildSimulationResultMapped(
  netValues: Uint8Array,
  pinToNet: Map<string, NetId>,
  endpointMap: Map<string, string>,
  outputIds: Uint32Array | null,
  outputValues: Uint8Array | null,
  circuit: Circuit,
  customComponents: Map<CustomComponentId, CustomComponentDefinition>
): SimulationResult {
  const outputValuesMap = new Map<OutputId, boolean>()

  if (outputIds && outputValues && outputIds.length === outputValues.length) {
    for (let i = 0; i < outputIds.length; i++) {
      outputValuesMap.set(outputIds[i]! as OutputId, outputValues[i] === 1)
    }
  } else {
    for (const output of circuit.outputs) {
      const value =
        getNetValueForPin(`o:${output.id}`, netValues, pinToNet, endpointMap) ?? false
      outputValuesMap.set(output.id, value)
    }
  }

  const wireValues = new Map<WireId, boolean>()
  for (const wire of circuit.wires) {
    const sourceKey = getPinKey(wire.source)
    const targetKey = getPinKey(wire.target)
    const sourceValue = getNetValueForPin(sourceKey, netValues, pinToNet, endpointMap)
    const targetValue = getNetValueForPin(targetKey, netValues, pinToNet, endpointMap)
    wireValues.set(wire.id, (sourceValue ?? targetValue) ?? false)
  }

  const componentPinValues = new Map<ComponentId, Map<number, boolean>>()
  for (const component of circuit.components) {
    const def = getComponentDefinition(component.type, customComponents)
    if (!def) continue

    const pinValues = new Map<number, boolean>()
    for (const pin of def.pins) {
      const pinKey = `c:${component.id}:${pin.index}`
      const value = getNetValueForPin(pinKey, netValues, pinToNet, endpointMap) ?? false
      pinValues.set(pin.index, value)
    }

    componentPinValues.set(component.id, pinValues)
  }

  return { outputValues: outputValuesMap, wireValues, componentPinValues }
}

function getWasmModuleUrl(): string | undefined {
  const envUrl = import.meta.env?.VITE_SIM_WASM_URL
  const runtimeUrl =
    typeof window !== 'undefined' ? window.__SIM_WASM_URL__ : undefined
  if (runtimeUrl) {
    return runtimeUrl
  }
  if (envUrl) {
    return envUrl
  }
  return new URL('../simulation/wasm/engine.ts', import.meta.url).href
}

function buildSimulationResult(
  netlist: Netlist,
  netValues: Uint8Array,
  outputIds: Uint32Array | null,
  outputValues: Uint8Array | null,
  circuit: Pick<Circuit, 'inputs' | 'wires'>,
  customComponents: Map<CustomComponentId, CustomComponentDefinition>
): SimulationResult {
  const inputMap = buildInputMap(circuit.inputs)
  const outputValuesMap = buildOutputMap(outputIds, outputValues, netlist, netValues)

  const wireValues = new Map<WireId, boolean>()
  for (const wire of circuit.wires) {
    let value = false
    const source = wire.source

    if (source.type === 'input') {
      value = inputMap.get(source.inputId) ?? false
    } else {
      const comp = netlist.components.find((c) => c.id === source.componentId)
      if (comp) {
        const def = getComponentDefinition(comp.type, customComponents)
        if (def) {
          const outputPins = def.pins.filter((p) => p.direction === 'output')
          const outputPinIdx = outputPins.findIndex((p) => p.index === source.pinIndex)
          if (outputPinIdx >= 0 && outputPinIdx < comp.outputNetIds.length) {
            const netId = comp.outputNetIds[outputPinIdx]
            if (netId !== undefined) {
              value = netValues[netId] === 1
            }
          }
        }
      }
    }

    wireValues.set(wire.id, value)
  }

  const componentPinValues = new Map<ComponentId, Map<number, boolean>>()
  for (const comp of netlist.components) {
    const def = getComponentDefinition(comp.type, customComponents)
    if (!def) continue

    const pinValues = new Map<number, boolean>()
    const outputPins = def.pins.filter((p) => p.direction === 'output')
    outputPins.forEach((pin, idx) => {
      const netId = comp.outputNetIds[idx]
      if (netId !== undefined) {
        pinValues.set(pin.index, netValues[netId] === 1)
      }
    })

    const inputPins = def.pins.filter((p) => p.direction === 'input')
    inputPins.forEach((pin, idx) => {
      const netId = comp.inputNetIds[idx]
      if (netId !== undefined) {
        pinValues.set(pin.index, netValues[netId] === 1)
      }
    })

    componentPinValues.set(comp.id, pinValues)
  }

  return { outputValues: outputValuesMap, wireValues, componentPinValues }
}

function buildInputBatch(circuitInputs: { id: InputId; value: boolean }[], inputIds: Uint32Array): InputBatch {
  const inputMap = buildInputMap(circuitInputs)
  const values = new Uint8Array(inputIds.length)
  for (let i = 0; i < inputIds.length; i++) {
    values[i] = inputMap.get(inputIds[i]! as InputId) ? 1 : 0
  }
  return { ids: inputIds, values }
}

function readSharedOutputs(shared: SharedOutputViews): Uint8Array {
  const index = Atomics.load(shared.control, 0)
  return index === 0 ? shared.outputsA : shared.outputsB
}

export function useSimulation(): SimulationResult {
  const circuit = useStore((s) => s.circuit)
  const customComponents = useStore((s) => s.customComponents)
  const inputValues = useMemo(
    () => circuit.inputs.map((input) => (input.value ? 1 : 0)),
    [circuit.inputs]
  )
  const structureKey = useMemo(() => {
    const inputs = circuit.inputs.map((input) => `${input.id}:${input.order}`)
    const outputs = circuit.outputs.map((output) => `${output.id}:${output.order}`)
    const components = circuit.components.map((comp) => `${comp.id}:${comp.type}`)
    const wires = circuit.wires.map((wire) => {
      const source =
        wire.source.type === 'component'
          ? `c:${wire.source.componentId}:${wire.source.pinIndex}`
          : `i:${wire.source.inputId}`
      const target =
        wire.target.type === 'component'
          ? `c:${wire.target.componentId}:${wire.target.pinIndex}`
          : `o:${wire.target.outputId}`
      return `${wire.id}:${source}->${target}`
    })
    return [...inputs, ...outputs, ...components, ...wires].join('|')
  }, [circuit.inputs, circuit.outputs, circuit.components, circuit.wires])

  const emptyResult = useMemo<SimulationResult>(() => {
    return { outputValues: new Map(), wireValues: new Map(), componentPinValues: new Map() }
  }, [])

  const [result, setResult] = useState<SimulationResult>(emptyResult)
  const [useWorker, setUseWorker] = useState(false)

  const workerRef = useRef<Worker | null>(null)
  const netlistRef = useRef<Netlist | null>(null)
  const pinToNetRef = useRef<Map<string, NetId> | null>(null)
  const endpointMapRef = useRef<Map<string, string> | null>(null)
  const inputIdsRef = useRef<Uint32Array | null>(null)
  const outputIdsRef = useRef<Uint32Array | null>(null)
  const sharedOutputsRef = useRef<SharedOutputViews | null>(null)
  const sharedNetValuesRef = useRef<Uint8Array | null>(null)
  const pendingInputsRef = useRef<InputBatch | null>(null)
  const workerReadyRef = useRef(false)
  const useWorkerRef = useRef(false)
  const initTimeoutRef = useRef<number | null>(null)
  const runTimeoutRef = useRef<number | null>(null)
  const runStartRef = useRef(0)
  const perfRef = useRef({ runs: 0, totalMs: 0, lastLog: 0 })

  const circuitRef = useRef(circuit)
  const customComponentsRef = useRef(customComponents)

  useEffect(() => {
    circuitRef.current = circuit
  }, [circuit])

  useEffect(() => {
    customComponentsRef.current = customComponents
  }, [customComponents])

  useEffect(() => {
    useWorkerRef.current = useWorker
  }, [useWorker])

  const syncResult = useMemo<SimulationResult>(() => {
    if (useWorker) {
      return emptyResult
    }

    const netlist = compile(circuit, customComponents)
    if (!netlist.valid) {
      return emptyResult
    }

    const inputMap = new Map(circuit.inputs.map((input) => [input.id, input.value]))
    evaluate(netlist, inputMap, customComponents)
    const netValues = new Uint8Array(netlist.nets.length)
    for (let i = 0; i < netlist.nets.length; i++) {
      netValues[i] = netlist.nets[i]?.value ? 1 : 0
    }

    return buildSimulationResult(
      netlist,
      netValues,
      null,
      null,
      { inputs: circuit.inputs, wires: circuit.wires },
      customComponents
    )
  }, [useWorker, circuit, customComponents, emptyResult])

  useEffect(() => {
    const supportsSharedBuffers =
      typeof SharedArrayBuffer !== 'undefined' &&
      typeof crossOriginIsolated !== 'undefined' &&
      crossOriginIsolated

    if (workerRef.current) {
      workerRef.current.terminate()
      workerRef.current = null
    }

    if (initTimeoutRef.current) {
      clearTimeout(initTimeoutRef.current)
      initTimeoutRef.current = null
    }
    if (runTimeoutRef.current) {
      clearTimeout(runTimeoutRef.current)
      runTimeoutRef.current = null
    }
    runStartRef.current = 0
    perfRef.current = { runs: 0, totalMs: 0, lastLog: 0 }

    workerReadyRef.current = false
    useWorkerRef.current = false
    inputIdsRef.current = null
    outputIdsRef.current = null
    sharedOutputsRef.current = null
    sharedNetValuesRef.current = null
    pendingInputsRef.current = null
    pinToNetRef.current = null
    endpointMapRef.current = null

    if (!supportsSharedBuffers) {
      setUseWorker(false)
      return
    }

    const { circuit: flatCircuit, endpointMap, errors: flattenErrors } = flattenCircuit(
      circuit,
      customComponents
    )
    if (flattenErrors.length > 0) {
      console.warn('Flattening errors:', flattenErrors)
      netlistRef.current = null
      setUseWorker(false)
      return
    }

    const { netlist, pinToNet } = compileWithPinMap(flatCircuit, customComponents)
    netlistRef.current = netlist
    pinToNetRef.current = pinToNet
    endpointMapRef.current = endpointMap

    if (!netlist.valid) {
      netlistRef.current = null
      setUseWorker(false)
      return
    }

    const worker = createSimulationWorker()
    workerRef.current = worker

    initTimeoutRef.current = window.setTimeout(() => {
      if (!workerReadyRef.current) {
        console.warn('Simulation worker initialization timed out')
        setUseWorker(false)
        worker.terminate()
        if (workerRef.current === worker) {
          workerRef.current = null
        }
      }
    }, 3000)

    const finishRun = () => {
      if (runTimeoutRef.current) {
        clearTimeout(runTimeoutRef.current)
        runTimeoutRef.current = null
      }
      const start = runStartRef.current
      if (start > 0) {
        const now = performance.now()
        const duration = now - start
        const perf = perfRef.current
        perf.runs += 1
        perf.totalMs += duration
        if (now - perf.lastLog > 2000) {
          const avg = perf.totalMs / perf.runs
          console.debug(`Simulation worker avg ${avg.toFixed(2)}ms over ${perf.runs} runs`)
          perf.runs = 0
          perf.totalMs = 0
          perf.lastLog = now
        }
        runStartRef.current = 0
      }
    }

    const handleMessage = (event: MessageEvent<SimWorkerResponse>) => {
      const message = event.data
      if (message.type === 'ready') {
        workerReadyRef.current = true
        if (initTimeoutRef.current) {
          clearTimeout(initTimeoutRef.current)
          initTimeoutRef.current = null
        }
        if (typeof message.usedWasm === 'boolean') {
          console.info('Simulation worker ready', { wasm: message.usedWasm })
        }
        if (message.shared?.outputs) {
          sharedOutputsRef.current = createSharedOutputViews(message.shared.outputs)
        }
        if (message.shared?.netValues) {
          sharedNetValuesRef.current = new Uint8Array(message.shared.netValues)
        }
        if (pendingInputsRef.current && workerRef.current) {
          setWorkerInputs(workerRef.current, pendingInputsRef.current.ids, pendingInputsRef.current.values)
          runStartRef.current = performance.now()
          if (runTimeoutRef.current) {
            clearTimeout(runTimeoutRef.current)
          }
          runTimeoutRef.current = window.setTimeout(() => {
            console.warn('Simulation worker run timed out')
            setUseWorker(false)
            if (workerRef.current) {
              workerRef.current.terminate()
              workerRef.current = null
            }
          }, 2000)
          runWorker(workerRef.current)
          pendingInputsRef.current = null
        }
        return
      }

      if (message.type === 'outputs') {
        const netValues = sharedNetValuesRef.current
        const pinToNet = pinToNetRef.current
        const endpointMap = endpointMapRef.current
        if (!netValues || !pinToNet || !endpointMap) {
          setResult(emptyResult)
          return
        }
        finishRun()
        setResult(
          buildSimulationResultMapped(
            netValues,
            pinToNet,
            endpointMap,
            outputIdsRef.current,
            message.outputValues,
            circuitRef.current,
            customComponentsRef.current
          )
        )
        return
      }

      if (message.type === 'outputs_shared') {
        const netValues = sharedNetValuesRef.current
        const sharedOutputs = sharedOutputsRef.current
        const pinToNet = pinToNetRef.current
        const endpointMap = endpointMapRef.current
        if (!netValues || !sharedOutputs || !pinToNet || !endpointMap) {
          setResult(emptyResult)
          return
        }
        const outputs = readSharedOutputs(sharedOutputs)
        finishRun()
        setResult(
          buildSimulationResultMapped(
            netValues,
            pinToNet,
            endpointMap,
            outputIdsRef.current,
            outputs,
            circuitRef.current,
            customComponentsRef.current
          )
        )
        return
      }

      if (message.type === 'error') {
        setUseWorker(false)
        if (workerRef.current) {
          workerRef.current.terminate()
          workerRef.current = null
        }
        if (initTimeoutRef.current) {
          clearTimeout(initTimeoutRef.current)
          initTimeoutRef.current = null
        }
        if (runTimeoutRef.current) {
          clearTimeout(runTimeoutRef.current)
          runTimeoutRef.current = null
        }
      }
    }

    worker.addEventListener('message', handleMessage)

    const inputOrder = [...circuit.inputs].sort((a, b) => a.order - b.order).map((i) => i.id)
    const outputOrder = [...circuit.outputs].sort((a, b) => a.order - b.order).map((o) => o.id)
    const wasmModuleUrl = getWasmModuleUrl()

    const initResult = initSimulationWorker(worker, netlist, {
      inputOrder,
      outputOrder,
      shared: { outputs: true, netValues: true },
      wasmModuleUrl,
    })

    if (!initResult.ok || !initResult.inputIds || !initResult.outputIds) {
      worker.removeEventListener('message', handleMessage)
      worker.terminate()
      workerRef.current = null
      if (initTimeoutRef.current) {
        clearTimeout(initTimeoutRef.current)
        initTimeoutRef.current = null
      }
      setUseWorker(false)
      return
    }

    useWorkerRef.current = true
    setUseWorker(true)
    inputIdsRef.current = initResult.inputIds
    outputIdsRef.current = initResult.outputIds
    pendingInputsRef.current = buildInputBatch(circuit.inputs, initResult.inputIds)
    setResult(emptyResult)

    return () => {
      worker.removeEventListener('message', handleMessage)
      worker.terminate()
      if (initTimeoutRef.current) {
        clearTimeout(initTimeoutRef.current)
        initTimeoutRef.current = null
      }
      if (runTimeoutRef.current) {
        clearTimeout(runTimeoutRef.current)
        runTimeoutRef.current = null
      }
      if (workerRef.current === worker) {
        workerRef.current = null
      }
    }
  }, [structureKey, customComponents])

  useEffect(() => {
    const netlist = netlistRef.current
    if (!netlist || !netlist.valid || !useWorkerRef.current) {
      return
    }

    if (!workerRef.current || !inputIdsRef.current) {
      return
    }

    const batch = buildInputBatch(circuit.inputs, inputIdsRef.current)
    if (workerReadyRef.current) {
      setWorkerInputs(workerRef.current, batch.ids, batch.values)
      runStartRef.current = performance.now()
      if (runTimeoutRef.current) {
        clearTimeout(runTimeoutRef.current)
      }
      runTimeoutRef.current = window.setTimeout(() => {
        console.warn('Simulation worker run timed out')
        setUseWorker(false)
        if (workerRef.current) {
          workerRef.current.terminate()
          workerRef.current = null
        }
      }, 2000)
      runWorker(workerRef.current)
    } else {
      pendingInputsRef.current = batch
    }
  }, [inputValues, customComponents])

  return useWorker ? result : syncResult
}
