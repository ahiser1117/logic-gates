import type { Netlist } from './types'
import type { InputId, OutputId, PrimitiveGateType } from '../types'
import { isPrimitiveGate } from '../types'

export interface PackedNetlist {
  compType: Uint8Array
  compIn0: Uint32Array
  compIn1: Uint32Array
  compOut: Uint32Array
  netReaders: Uint32Array
  netReadersStart: Uint32Array
  netReadersCount: Uint32Array
  inputIds: Uint32Array
  inputNetIds: Uint32Array
  outputIds: Uint32Array
  outputNetIds: Uint32Array
  topoOrder: Uint32Array
  netCount: number
  compCount: number
}

export interface PackOptions {
  inputOrder?: InputId[]
  outputOrder?: OutputId[]
}

export interface PackResult {
  packed: PackedNetlist | null
  errors: string[]
}

const GATE_TYPE_CODES: Record<PrimitiveGateType, number> = {
  NAND: 0,
  NOR: 1,
}

export function packNetlist(netlist: Netlist, options: PackOptions = {}): PackResult {
  const errors: string[] = []

  if (!netlist.valid) {
    return { packed: null, errors: ['netlist is not valid'] }
  }

  const compCount = netlist.components.length
  const netCount = netlist.nets.length

  const compType = new Uint8Array(compCount)
  const compIn0 = new Uint32Array(compCount)
  const compIn1 = new Uint32Array(compCount)
  const compOut = new Uint32Array(compCount)

  for (let i = 0; i < compCount; i++) {
    const comp = netlist.components[i]!
    if (!isPrimitiveGate(comp.type)) {
      errors.push(`component ${comp.id} is not a primitive gate`)
      continue
    }

    if (comp.inputNetIds.length < 2) {
      errors.push(`component ${comp.id} has fewer than 2 inputs`)
      continue
    }
    if (comp.outputNetIds.length < 1) {
      errors.push(`component ${comp.id} has no outputs`)
      continue
    }

    compType[i] = GATE_TYPE_CODES[comp.type]
    compIn0[i] = comp.inputNetIds[0] as number
    compIn1[i] = comp.inputNetIds[1] as number
    compOut[i] = comp.outputNetIds[0] as number
  }

  if (errors.length > 0) {
    return { packed: null, errors }
  }

  const compIndexMap = new Map<number, number>()
  netlist.components.forEach((comp, idx) => {
    compIndexMap.set(comp.id as number, idx)
  })

  const readerCounts = new Uint32Array(netCount)
  const mark = new Int32Array(compCount)
  let markId = 1

  function bumpMarkId() {
    markId += 1
    if (markId >= 0x7fffffff) {
      mark.fill(0)
      markId = 1
    }
  }

  for (let netId = 0; netId < netCount; netId++) {
    bumpMarkId()
    let count = 0
    const net = netlist.nets[netId]
    if (!net) continue
    for (const reader of net.readers) {
      if (reader.type !== 'component') continue
      const idx = compIndexMap.get(reader.componentId as number)
      if (idx === undefined) {
        errors.push(`reader component ${reader.componentId} missing from netlist`)
        continue
      }
      if (mark[idx] !== markId) {
        mark[idx] = markId
        count += 1
      }
    }
    readerCounts[netId] = count
  }

  if (errors.length > 0) {
    return { packed: null, errors }
  }

  const netReadersStart = new Uint32Array(netCount)
  const netReadersCount = readerCounts

  let totalReaders = 0
  for (let netId = 0; netId < netCount; netId++) {
    netReadersStart[netId] = totalReaders
    totalReaders += readerCounts[netId]
  }

  const netReaders = new Uint32Array(totalReaders)
  mark.fill(0)
  markId = 1

  for (let netId = 0; netId < netCount; netId++) {
    bumpMarkId()
    let offset = netReadersStart[netId]
    let count = 0
    const net = netlist.nets[netId]
    if (!net) continue
    for (const reader of net.readers) {
      if (reader.type !== 'component') continue
      const idx = compIndexMap.get(reader.componentId as number)
      if (idx === undefined) continue
      if (mark[idx] !== markId) {
        mark[idx] = markId
        netReaders[offset + count] = idx
        count += 1
      }
    }
  }

  const inputMap = new Map<number, number>()
  for (let netId = 0; netId < netCount; netId++) {
    const net = netlist.nets[netId]
    if (net?.driver?.type === 'input') {
      inputMap.set(net.driver.inputId as number, netId)
    }
  }

  const inputIdsList = options.inputOrder
    ? options.inputOrder.map((id) => id as number)
    : [...inputMap.keys()].sort((a, b) => a - b)

  const inputIds = new Uint32Array(inputIdsList.length)
  const inputNetIds = new Uint32Array(inputIdsList.length)

  for (let i = 0; i < inputIdsList.length; i++) {
    const id = inputIdsList[i]!
    const netId = inputMap.get(id)
    if (netId === undefined) {
      errors.push(`input id ${id} not found in netlist`)
      continue
    }
    inputIds[i] = id
    inputNetIds[i] = netId
  }

  const outputMap = new Map<number, number>()
  for (let netId = 0; netId < netCount; netId++) {
    const net = netlist.nets[netId]
    if (!net) continue
    for (const reader of net.readers) {
      if (reader.type === 'output') {
        outputMap.set(reader.outputId as number, netId)
      }
    }
  }

  const outputIdsList = options.outputOrder
    ? options.outputOrder.map((id) => id as number)
    : [...outputMap.keys()].sort((a, b) => a - b)

  const outputIds = new Uint32Array(outputIdsList.length)
  const outputNetIds = new Uint32Array(outputIdsList.length)

  for (let i = 0; i < outputIdsList.length; i++) {
    const id = outputIdsList[i]!
    const netId = outputMap.get(id)
    if (netId === undefined) {
      errors.push(`output id ${id} not found in netlist`)
      continue
    }
    outputIds[i] = id
    outputNetIds[i] = netId
  }

  if (errors.length > 0) {
    return { packed: null, errors }
  }

  const topoOrder = new Uint32Array(netlist.topoOrder.length)
  for (let i = 0; i < netlist.topoOrder.length; i++) {
    topoOrder[i] = netlist.topoOrder[i]!
  }

  return {
    packed: {
      compType,
      compIn0,
      compIn1,
      compOut,
      netReaders,
      netReadersStart,
      netReadersCount,
      inputIds,
      inputNetIds,
      outputIds,
      outputNetIds,
      topoOrder,
      netCount,
      compCount,
    },
    errors: [],
  }
}
