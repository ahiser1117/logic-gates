import type { ComponentId, InputId, OutputId, ComponentType, SplitMergeConfig } from '../types'

// === Net ID ===
export type NetId = number & { readonly __brand: 'NetId' }

// === Driver Info ===
export type NetDriver =
  | { type: 'input'; inputId: InputId }
  | { type: 'component'; componentId: ComponentId; pinIndex: number }
  | null

// === Reader Info ===
export type NetReader =
  | { type: 'component'; componentId: ComponentId; pinIndex: number }
  | { type: 'output'; outputId: OutputId }

// === Compiled Net ===
export interface Net {
  id: NetId
  driver: NetDriver
  readers: NetReader[]
  value: boolean | boolean[]  // boolean[] for multi-bit nets
  bitWidth: number            // Default 1
}

// === Compiled Component ===
export interface CompiledComponent {
  id: ComponentId
  type: ComponentType
  inputNetIds: NetId[]
  outputNetIds: NetId[]  // Array to support custom components with multiple outputs
  splitMergeConfig?: SplitMergeConfig
}

// === Validation Error ===
export type ValidationError =
  | { type: 'cycle'; involvedComponents: ComponentId[] }
  | { type: 'multiple_drivers'; targetDesc: string }
  | { type: 'floating_input'; componentId: ComponentId; pinIndex: number }
  | { type: 'floating_output'; outputId: OutputId }

// === Compiled Netlist ===
export interface Netlist {
  nets: Net[]
  components: CompiledComponent[]
  topoOrder: number[]
  valid: boolean
  errors: ValidationError[]
}
