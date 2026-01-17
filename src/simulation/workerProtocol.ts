import type { PackedNetlist } from './packer'

export type PackedNetlistTransfer = PackedNetlist

export interface SharedOutputBuffers {
  outputsA: SharedArrayBuffer
  outputsB: SharedArrayBuffer
  outputControl: SharedArrayBuffer
}

export interface SharedBuffers {
  outputs?: SharedOutputBuffers
  netValues?: SharedArrayBuffer
}

export type SimWorkerRequest =
  | {
      type: 'init'
      packed: PackedNetlistTransfer
      wasmModuleUrl?: string
      shared?: { outputs?: boolean; netValues?: boolean }
    }
  | { type: 'set_inputs'; inputIds: Uint32Array; inputValues: Uint8Array }
  | { type: 'run'; maxSteps?: number }
  | { type: 'reset' }

export type SimWorkerResponse =
  | {
      type: 'ready'
      netCount: number
      compCount: number
      inputCount: number
      outputCount: number
      shared?: SharedBuffers
      usedWasm?: boolean
    }
  | { type: 'outputs'; outputValues: Uint8Array }
  | { type: 'outputs_shared'; version: number }
  | { type: 'error'; message: string; details?: string[] }
