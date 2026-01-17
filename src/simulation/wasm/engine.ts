import type { PackedNetlist } from '../packer'
import type { SharedOutputBuffers } from '../workerProtocol'

export interface EngineInitOptions {
  sharedOutputs?: SharedOutputBuffers | null
  sharedNetValues?: SharedArrayBuffer | null
}

export class Engine {
  private compType: Uint8Array
  private compIn0: Uint32Array
  private compIn1: Uint32Array
  private compOut: Uint32Array
  private netReaders: Uint32Array
  private netReadersStart: Uint32Array
  private netReadersCount: Uint32Array
  private topoOrder: Uint32Array
  private outputNetIds: Uint32Array
  private netValues: Uint8Array
  private outputValues: Uint8Array
  private inputIdToNet: Map<number, number>
  private dirtyNets: Uint32Array
  private dirtyCount: number
  private compQueue: Uint32Array
  private compHead: number
  private compTail: number
  private compMark: Uint32Array
  private markId: number
  private hasEvaluated: boolean

  constructor(packed: PackedNetlist, options: EngineInitOptions = {}) {
    this.compType = packed.compType
    this.compIn0 = packed.compIn0
    this.compIn1 = packed.compIn1
    this.compOut = packed.compOut
    this.netReaders = packed.netReaders
    this.netReadersStart = packed.netReadersStart
    this.netReadersCount = packed.netReadersCount
    this.topoOrder = packed.topoOrder
    this.outputNetIds = packed.outputNetIds
    this.netValues = options.sharedNetValues
      ? new Uint8Array(options.sharedNetValues)
      : new Uint8Array(packed.netCount)
    this.outputValues = new Uint8Array(packed.outputNetIds.length)
    this.inputIdToNet = new Map()
    for (let i = 0; i < packed.inputIds.length; i++) {
      this.inputIdToNet.set(packed.inputIds[i]!, packed.inputNetIds[i]!)
    }
    this.dirtyNets = new Uint32Array(Math.max(8, packed.inputIds.length))
    this.dirtyCount = 0
    this.compQueue = new Uint32Array(Math.max(8, packed.compCount))
    this.compHead = 0
    this.compTail = 0
    this.compMark = new Uint32Array(packed.compCount)
    this.markId = 1
    this.hasEvaluated = false
  }

  setInputs(inputIds: Uint32Array, inputValues: Uint8Array) {
    if (inputIds.length !== inputValues.length) {
      throw new Error('inputIds length does not match inputValues length')
    }
    for (let i = 0; i < inputIds.length; i++) {
      const netId = this.inputIdToNet.get(inputIds[i]!)
      if (netId === undefined) {
        continue
      }
      const nextValue = inputValues[i]! ? 1 : 0
      if (this.netValues[netId] !== nextValue) {
        this.netValues[netId] = nextValue
        this.pushDirty(netId)
      }
    }
  }

  run(maxSteps?: number) {
    if (!this.hasEvaluated) {
      this.fullEvaluate(maxSteps)
      this.hasEvaluated = true
      this.dirtyCount = 0
      this.refreshOutputs()
      return
    }

    if (this.dirtyCount === 0) {
      this.refreshOutputs()
      return
    }

    this.bumpMark()
    this.compHead = 0
    this.compTail = 0

    for (let i = 0; i < this.dirtyCount; i++) {
      this.enqueueReaders(this.dirtyNets[i]!)
    }
    this.dirtyCount = 0

    let steps = 0
    while (this.compHead < this.compTail) {
      const compIdx = this.compQueue[this.compHead++]!
      const in0 = this.netValues[this.compIn0[compIdx]!]!
      const in1 = this.netValues[this.compIn1[compIdx]!]!
      const gate = this.compType[compIdx]!
      const out = gate === 0 ? (in0 & in1 ? 0 : 1) : (in0 | in1 ? 0 : 1)
      const outNet = this.compOut[compIdx]!
      if (out !== this.netValues[outNet]) {
        this.netValues[outNet] = out
        this.enqueueReaders(outNet)
      }

      if (maxSteps !== undefined) {
        steps += 1
        if (steps >= maxSteps) {
          break
        }
      }
    }

    this.refreshOutputs()
    this.hasEvaluated = true
  }

  getOutputs(): Uint8Array {
    return this.outputValues
  }

  getNetValues(): Uint8Array {
    return this.netValues
  }

  private refreshOutputs() {
    for (let i = 0; i < this.outputNetIds.length; i++) {
      this.outputValues[i] = this.netValues[this.outputNetIds[i]!]!
    }
  }

  private fullEvaluate(maxSteps?: number) {
    let steps = 0
    for (let i = 0; i < this.topoOrder.length; i++) {
      const compIdx = this.topoOrder[i]!
      const in0 = this.netValues[this.compIn0[compIdx]!]!
      const in1 = this.netValues[this.compIn1[compIdx]!]!
      const gate = this.compType[compIdx]!
      const out = gate === 0 ? (in0 & in1 ? 0 : 1) : (in0 | in1 ? 0 : 1)
      this.netValues[this.compOut[compIdx]!] = out

      if (maxSteps !== undefined) {
        steps += 1
        if (steps >= maxSteps) {
          break
        }
      }
    }
  }

  private pushDirty(netId: number) {
    if (this.dirtyCount >= this.dirtyNets.length) {
      const next = new Uint32Array(this.dirtyNets.length * 2)
      next.set(this.dirtyNets)
      this.dirtyNets = next
    }
    this.dirtyNets[this.dirtyCount] = netId
    this.dirtyCount += 1
  }

  private enqueueReaders(netId: number) {
    const start = this.netReadersStart[netId]!
    const count = this.netReadersCount[netId]!
    for (let i = 0; i < count; i++) {
      this.enqueueComp(this.netReaders[start + i]!)
    }
  }

  private enqueueComp(compIdx: number) {
    if (this.compMark[compIdx] === this.markId) {
      return
    }
    this.compMark[compIdx] = this.markId
    if (this.compTail >= this.compQueue.length) {
      const next = new Uint32Array(this.compQueue.length * 2)
      next.set(this.compQueue)
      this.compQueue = next
    }
    this.compQueue[this.compTail] = compIdx
    this.compTail += 1
  }

  private bumpMark() {
    this.markId += 1
    if (this.markId >= 0x7fffffff) {
      this.compMark.fill(0)
      this.markId = 1
    }
  }
}

export function createEngine(packed: PackedNetlist, options: EngineInitOptions = {}) {
  return new Engine(packed, options)
}
