import type { ComponentId, WireId, InputId, OutputId, GateType, Point } from './circuit'

// === Viewport State ===
export interface Viewport {
  panX: number
  panY: number
  zoom: number
}

// === Selection State ===
export interface Selection {
  components: Set<ComponentId>
  wires: Set<WireId>
}

// === Pin Reference ===
export type PinRef =
  | { type: 'component'; componentId: ComponentId; pinIndex: number; pinType: 'input' | 'output' }
  | { type: 'input'; inputId: InputId }
  | { type: 'output'; outputId: number }

// === Wiring Mode State ===
export interface WiringState {
  active: boolean
  startPin: PinRef | null
  waypoints: Point[]
}

// === Drag State ===
export interface DragState {
  type: 'none' | 'component' | 'palette' | 'pan' | 'marquee' | 'wireHandle'
  startX: number
  startY: number
  currentX: number
  currentY: number
  payload?: {
    gateType?: GateType
    componentIds?: ComponentId[]
    offsetX?: number
    offsetY?: number
    // Wire handle dragging
    wireId?: WireId
    handleIndex?: number
  }
}

// === Hovered Button Types ===
export type HoveredButton =
  | 'input-add'
  | 'input-remove'
  | 'output-add'
  | 'output-remove'
  | { type: 'input-toggle'; inputId: InputId }
  | null

// === Full UI State ===
export interface UIState {
  viewport: Viewport
  selection: Selection
  wiring: WiringState
  drag: DragState
  hoveredComponentId: ComponentId | null
  hoveredPinIndex: number | null
  hoveredInputId: InputId | null
  hoveredOutputId: OutputId | null
  hoveredButton: HoveredButton
}

// === Initial UI State ===
export const initialUIState: UIState = {
  viewport: {
    panX: 0,
    panY: 0,
    zoom: 1,
  },
  selection: {
    components: new Set(),
    wires: new Set(),
  },
  wiring: {
    active: false,
    startPin: null,
    waypoints: [],
  },
  drag: {
    type: 'none',
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
  },
  hoveredComponentId: null,
  hoveredPinIndex: null,
  hoveredInputId: null,
  hoveredOutputId: null,
  hoveredButton: null,
}
