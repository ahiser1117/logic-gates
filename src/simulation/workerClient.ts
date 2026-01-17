import type { Netlist } from './types'
import type { PackOptions } from './packer'
import type { SharedOutputBuffers, SimWorkerRequest } from './workerProtocol'
import { packNetlist } from './packer'

export interface InitWorkerResult {
  ok: boolean
  errors?: string[]
  inputIds?: Uint32Array
  outputIds?: Uint32Array
}

export interface InitWorkerOptions extends PackOptions {
  shared?: { outputs?: boolean; netValues?: boolean }
  wasmModuleUrl?: string
}

export interface SharedOutputViews {
  outputsA: Uint8Array
  outputsB: Uint8Array
  control: Int32Array
}

export function createSimulationWorker(): Worker {
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
}

export function initSimulationWorker(
  worker: Worker,
  netlist: Netlist,
  options: InitWorkerOptions = {}
): InitWorkerResult {
  const { packed, errors } = packNetlist(netlist, options)
  if (!packed) {
    return { ok: false, errors }
  }

  const inputIdsCopy = packed.inputIds.slice()
  const outputIdsCopy = packed.outputIds.slice()

  const transferables: Transferable[] = [
    packed.compType.buffer,
    packed.compIn0.buffer,
    packed.compIn1.buffer,
    packed.compOut.buffer,
    packed.netReaders.buffer,
    packed.netReadersStart.buffer,
    packed.netReadersCount.buffer,
    packed.inputIds.buffer,
    packed.inputNetIds.buffer,
    packed.outputIds.buffer,
    packed.outputNetIds.buffer,
    packed.topoOrder.buffer,
  ]

  const message: SimWorkerRequest = {
    type: 'init',
    packed,
    wasmModuleUrl: options.wasmModuleUrl,
    shared: options.shared,
  }
  worker.postMessage(message, transferables)

  return { ok: true, inputIds: inputIdsCopy, outputIds: outputIdsCopy }
}

export function createSharedOutputViews(shared: SharedOutputBuffers): SharedOutputViews {
  return {
    outputsA: new Uint8Array(shared.outputsA),
    outputsB: new Uint8Array(shared.outputsB),
    control: new Int32Array(shared.outputControl),
  }
}

export function setWorkerInputs(
  worker: Worker,
  inputIds: Uint32Array,
  inputValues: Uint8Array
) {
  const message: SimWorkerRequest = { type: 'set_inputs', inputIds, inputValues }
  worker.postMessage(message)
}

export function runWorker(worker: Worker, maxSteps?: number) {
  const message: SimWorkerRequest = { type: 'run', maxSteps }
  worker.postMessage(message)
}

export function resetWorker(worker: Worker) {
  const message: SimWorkerRequest = { type: 'reset' }
  worker.postMessage(message)
}
