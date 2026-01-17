/// <reference lib="webworker" />
import type { PackedNetlist } from './packer'
import type {
  SharedBuffers,
  SharedOutputBuffers,
  SimWorkerRequest,
  SimWorkerResponse,
} from './workerProtocol'

type GateCode = 0 | 1

interface WasmEngine {
  setInputs: (inputIds: Uint32Array, inputValues: Uint8Array) => void
  run: (maxSteps?: number) => void
  getOutputs: () => Uint8Array
  getNetValues?: () => Uint8Array
}

let packed: PackedNetlist | null = null
let netValues: Uint8Array | null = null
let outputValues: Uint8Array | null = null
let outputScratch: Uint8Array | null = null
let inputIdToNet = new Map<number, number>()
let sharedOutputs: SharedOutputBuffers | null = null
let sharedOutputViews: { outputsA: Uint8Array; outputsB: Uint8Array; control: Int32Array } | null =
  null
let sharedNetValues: SharedArrayBuffer | null = null
let wasmEngine: WasmEngine | null = null
let usingWasm = false

function post(response: SimWorkerResponse) {
  self.postMessage(response)
}

function buildInputMap(nextPacked: PackedNetlist) {
  inputIdToNet = new Map()
  for (let i = 0; i < nextPacked.inputIds.length; i++) {
    inputIdToNet.set(nextPacked.inputIds[i]!, nextPacked.inputNetIds[i]!)
  }
}

function initRuntime(nextPacked: PackedNetlist, shared?: SharedBuffers) {
  packed = nextPacked
  sharedOutputs = shared?.outputs ?? null
  sharedNetValues = shared?.netValues ?? null
  sharedOutputViews = sharedOutputs
    ? {
        outputsA: new Uint8Array(sharedOutputs.outputsA),
        outputsB: new Uint8Array(sharedOutputs.outputsB),
        control: new Int32Array(sharedOutputs.outputControl),
      }
    : null

  netValues = sharedNetValues ? new Uint8Array(sharedNetValues) : new Uint8Array(nextPacked.netCount)
  outputValues = sharedOutputs ? null : new Uint8Array(nextPacked.outputNetIds.length)
  outputScratch = new Uint8Array(nextPacked.outputNetIds.length)

  buildInputMap(nextPacked)
}

function setInputs(inputIds: Uint32Array, inputValuesArr: Uint8Array) {
  if (!packed || !netValues) {
    post({ type: 'error', message: 'runtime not initialized' })
    return
  }
  if (inputIds.length !== inputValuesArr.length) {
    post({ type: 'error', message: 'inputIds length does not match inputValues length' })
    return
  }
  if (usingWasm && wasmEngine) {
    wasmEngine.setInputs(inputIds, inputValuesArr)
    return
  }
  for (let i = 0; i < inputIds.length; i++) {
    const netId = inputIdToNet.get(inputIds[i]!)
    if (netId === undefined) {
      post({ type: 'error', message: `input id ${inputIds[i]} not found` })
      continue
    }
    netValues[netId] = inputValuesArr[i]! ? 1 : 0
  }
}

function writeOutputs(values: Uint8Array) {
  if (sharedOutputViews) {
    const control = sharedOutputViews.control
    const current = Atomics.load(control, 0)
    const writeIndex = current === 0 ? 1 : 0
    const view = writeIndex === 0 ? sharedOutputViews.outputsA : sharedOutputViews.outputsB
    view.set(values)
    Atomics.store(control, 0, writeIndex)
    const version = Atomics.add(control, 1, 1) + 1
    post({ type: 'outputs_shared', version })
    return
  }

  if (!outputValues) {
    outputValues = new Uint8Array(values.length)
  }
  outputValues.set(values)
  post({ type: 'outputs', outputValues })
}

function runJs() {
  if (!packed || !netValues) {
    post({ type: 'error', message: 'runtime not initialized' })
    return
  }

  const { compType, compIn0, compIn1, compOut, topoOrder } = packed

  for (let i = 0; i < topoOrder.length; i++) {
    const compIdx = topoOrder[i]!
    const in0 = netValues[compIn0[compIdx]!]!
    const in1 = netValues[compIn1[compIdx]!]!
    const gate = compType[compIdx] as GateCode
    const out = gate === 0 ? (in0 & in1 ? 0 : 1) : (in0 | in1 ? 0 : 1)
    netValues[compOut[compIdx]!] = out
  }

  if (!outputScratch) {
    outputScratch = new Uint8Array(packed.outputNetIds.length)
  }
  for (let i = 0; i < packed.outputNetIds.length; i++) {
    outputScratch[i] = netValues[packed.outputNetIds[i]!]!
  }

  writeOutputs(outputScratch)
}

function runWasm(maxSteps?: number) {
  if (!wasmEngine) {
    post({ type: 'error', message: 'WASM engine not initialized' })
    return
  }
  wasmEngine.run(maxSteps)
  const outputs = wasmEngine.getOutputs()
  writeOutputs(outputs)
  if (sharedNetValues && wasmEngine.getNetValues) {
    const values = wasmEngine.getNetValues()
    if (values.buffer !== sharedNetValues) {
      const netView = new Uint8Array(sharedNetValues)
      netView.set(values)
    }
  }
}

async function initWasmEngine(wasmModuleUrl: string, shared?: SharedBuffers): Promise<boolean> {
  try {
    const wasmModule = await import(/* @vite-ignore */ wasmModuleUrl)
    const initOptions = {
      sharedOutputs: shared?.outputs ?? null,
      sharedNetValues: shared?.netValues ?? null,
    }
    if (typeof wasmModule.createEngine === 'function') {
      wasmEngine = await wasmModule.createEngine(packed, initOptions)
    } else if (typeof wasmModule.Engine === 'function') {
      wasmEngine = new wasmModule.Engine(packed, initOptions)
    } else {
      throw new Error('WASM module missing createEngine or Engine export')
    }

    if (shared?.netValues && !wasmEngine.getNetValues) {
      post({
        type: 'error',
        message: 'WASM engine does not expose net values',
        details: ['shared net values were requested, but getNetValues is missing'],
      })
      wasmEngine = null
      return false
    }

    usingWasm = true
    return true
  } catch (error) {
    post({
      type: 'error',
      message: 'failed to load WASM module',
      details: [error instanceof Error ? error.message : String(error)],
    })
    wasmEngine = null
    return false
  }
}

async function handleMessage(msg: SimWorkerRequest) {
  switch (msg.type) {
    case 'init': {
      try {
        const shared: SharedBuffers = {}
        if (msg.shared?.outputs) {
          const outputBytes = msg.packed.outputIds.length
          shared.outputs = {
            outputsA: new SharedArrayBuffer(outputBytes),
            outputsB: new SharedArrayBuffer(outputBytes),
            outputControl: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2),
          }
          const control = new Int32Array(shared.outputs.outputControl)
          control[0] = 0
          control[1] = 0
        }
        if (msg.shared?.netValues) {
          shared.netValues = new SharedArrayBuffer(msg.packed.netCount)
        }

        initRuntime(msg.packed, shared)

        usingWasm = false
        wasmEngine = null
        if (msg.wasmModuleUrl) {
          const wasmReady = await initWasmEngine(msg.wasmModuleUrl, shared)
          if (!wasmReady) {
            usingWasm = false
          }
        }

        post({
          type: 'ready',
          netCount: msg.packed.netCount,
          compCount: msg.packed.compCount,
          inputCount: msg.packed.inputIds.length,
          outputCount: msg.packed.outputIds.length,
          shared: shared.outputs || shared.netValues ? shared : undefined,
          usedWasm: usingWasm,
        })
      } catch (error) {
        post({
          type: 'error',
          message: 'failed to initialize runtime',
          details: [error instanceof Error ? error.message : String(error)],
        })
      }
      break
    }
    case 'set_inputs':
      setInputs(msg.inputIds, msg.inputValues)
      break
    case 'run':
      if (usingWasm) {
        runWasm(msg.maxSteps)
      } else {
        runJs()
      }
      break
    case 'reset':
      if (netValues) {
        netValues.fill(0)
      }
      if (outputValues) {
        outputValues.fill(0)
      }
      if (sharedOutputViews) {
        Atomics.store(sharedOutputViews.control, 0, 0)
        Atomics.store(sharedOutputViews.control, 1, 0)
      }
      break
    default:
      post({ type: 'error', message: 'unknown message type' })
  }
}

self.onmessage = (event: MessageEvent<SimWorkerRequest>) => {
  void handleMessage(event.data)
}
