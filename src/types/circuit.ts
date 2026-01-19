// === Point (for wire paths) ===
export interface Point {
  x: number
  y: number
}

// === Core Identifiers ===
export type ComponentId = number & { readonly __brand: 'ComponentId' }
export type WireId = number & { readonly __brand: 'WireId' }
export type InputId = number & { readonly __brand: 'InputId' }
export type OutputId = number & { readonly __brand: 'OutputId' }

// === Gate Types ===
export type PrimitiveGateType = 'NAND' | 'NOR' | 'SPLIT_MERGE'

export type SplitMergeMode = 'split' | 'merge'

export interface SplitMergeConfig {
  mode: SplitMergeMode
  partitions: number[]
}

const DEFAULT_SPLIT_MERGE_CONFIG: SplitMergeConfig = { mode: 'split', partitions: [1, 1] }

export function createDefaultSplitMergeConfig(): SplitMergeConfig {
  return structuredClone(DEFAULT_SPLIT_MERGE_CONFIG)
}

export function normalizeSplitMergeConfig(config?: SplitMergeConfig): SplitMergeConfig {
  const mode: SplitMergeMode = config?.mode === 'merge' ? 'merge' : 'split'
  const rawPartitions = config?.partitions ?? DEFAULT_SPLIT_MERGE_CONFIG.partitions
  const partitions = rawPartitions
    .map((size) => Math.max(1, Math.min(32, Math.floor(size))))
    .filter((size) => Number.isFinite(size))

  if (partitions.length === 0) {
    return createDefaultSplitMergeConfig()
  }

  return { mode, partitions }
}

// Custom component ID (branded string type)
export type CustomComponentId = string & { readonly __brand: 'CustomComponentId' }

// Union of primitive gates and custom components
export type ComponentType = PrimitiveGateType | CustomComponentId

// Backwards compatibility alias
export type GateType = PrimitiveGateType

// === Pin Definition (static per gate type) ===
export interface PinDefinition {
  index: number
  name: string
  direction: 'input' | 'output'
  offsetX: number  // Relative to component center
  offsetY: number
  bitWidth?: number  // Defaults to 1
}

// === Gate Definitions ===
export const GATE_DEFINITIONS: Record<GateType, { width: number; height: number; pins: PinDefinition[] }> = {
  NAND: {
    width: 60,
    height: 60,
    pins: [
      { index: 0, name: 'A', direction: 'input', offsetX: -30, offsetY: -20 },
      { index: 1, name: 'B', direction: 'input', offsetX: -30, offsetY: 20 },
      { index: 2, name: 'Y', direction: 'output', offsetX: 30, offsetY: 0 },
    ],
  },
  NOR: {
    width: 60,
    height: 60,
    pins: [
      { index: 0, name: 'A', direction: 'input', offsetX: -30, offsetY: -20 },
      { index: 1, name: 'B', direction: 'input', offsetX: -30, offsetY: 20 },
      { index: 2, name: 'Y', direction: 'output', offsetX: 30, offsetY: 0 },
    ],
  },
  SPLIT_MERGE: {
    width: 80,
    height: 80,
    pins: [],
  },
}

// === Component Instance ===
export interface Component {
  id: ComponentId
  type: ComponentType
  x: number  // Grid position
  y: number
  splitMerge?: SplitMergeConfig
}

// === Global Input (on input board) ===
export interface CircuitInput {
  id: InputId
  label: string
  value: boolean | boolean[]  // boolean[] for multi-bit (LSB at index 0)
  bitWidth: number            // Default 1
  order: number
}

// === Global Output (on output board) ===
export interface CircuitOutput {
  id: OutputId
  label: string
  bitWidth: number  // Default 1, auto-set when wire connects
  order: number
}

// === Wire Source ===
export type WireSource =
  | { type: 'component'; componentId: ComponentId; pinIndex: number }
  | { type: 'input'; inputId: InputId }

// === Wire Target ===
export type WireTarget =
  | { type: 'component'; componentId: ComponentId; pinIndex: number }
  | { type: 'output'; outputId: OutputId }

// === Wire Connection ===
export interface Wire {
  id: WireId
  source: WireSource
  target: WireTarget
  waypoints?: Point[]  // User-controlled intermediate points (world coords)
}

// === Board Position ===
export interface BoardPosition {
  x: number
  y: number
}

// === Full Circuit State ===
export interface Circuit {
  id: string
  name: string
  inputs: CircuitInput[]
  outputs: CircuitOutput[]
  components: Component[]
  wires: Wire[]
  inputBoard: BoardPosition
  outputBoard: BoardPosition
}

// === Helper to create typed IDs ===
export function createComponentId(n: number): ComponentId {
  return n as ComponentId
}
export function createWireId(n: number): WireId {
  return n as WireId
}
export function createInputId(n: number): InputId {
  return n as InputId
}
export function createOutputId(n: number): OutputId {
  return n as OutputId
}

export function createCustomComponentId(uuid: string): CustomComponentId {
  return uuid as CustomComponentId
}

// === Type Guards ===
export function isPrimitiveGate(type: ComponentType): type is PrimitiveGateType {
  return type === 'NAND' || type === 'NOR' || type === 'SPLIT_MERGE'
}

export function getSplitMergeConfig(component?: Component): SplitMergeConfig {
  return normalizeSplitMergeConfig(component?.splitMerge)
}

// === Custom Component Definition ===
export interface CustomComponentDefinition {
  id: CustomComponentId
  name: string
  createdAt: number
  circuit: {
    inputs: { id: InputId; label: string; bitWidth: number; order: number }[]
    outputs: { id: OutputId; label: string; bitWidth: number; order: number }[]
    components: Component[]
    wires: Wire[]
  }
  width: number
  height: number
  pins: PinDefinition[]
}
