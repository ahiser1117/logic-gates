import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { enableMapSet, type Draft } from 'immer'
import {
  clearPathCache,
  clearPathsForComponent,
  clearPathsForInputBoard,
  clearPathsForOutputBoard,
  clearWirePath,
  getWireEndpointWorld,
  computePreviewPathWithWaypoints,
  simplifyPath,
  GRID_STEP,
} from '../canvas/wirePathfinding'

// Snap a value to the grid
function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize
}

// Enable Immer support for Map and Set
enableMapSet()
import type {
  Circuit,
  ComponentId,
  Wire,
  WireId,
  WireSource,
  WireTarget,
  InputId,
  OutputId,
  ComponentType,
  CustomComponentId,
  CustomComponentDefinition,
  Point,
  SplitMergeConfig,
} from '../types/circuit'

// Initial wire state captured at drag start for L-shape recalculation
export interface InitialWireState {
  wireId: WireId
  // When both ends are moving, use translation mode
  bothEndsMoving?: boolean          // True if both source and target components are selected
  originalWaypoints?: Point[]       // Original waypoints for translation mode
  // L-shape recalculation mode (when only one end is moving)
  xRatio: number                    // Bend X as proportion from moving end to anchor
  anchorX: number                   // Anchor point X (fixed during drag)
  anchorY: number                   // Anchor point Y (fixed during drag)
  isSourceEnd: boolean              // Is moving component at source end of wire
  remainingWaypoints: Point[]       // Waypoints beyond the L-shape (stay fixed)
}
import { createCustomComponentId } from '../types/circuit'
import { validateCircuitForComponent } from '../utils/validation'
import { computePinLayout } from '../utils/pinLayout'
import { getComponentDefinition } from '../simulation/compiler'
import { resetLatchStates, removeLatchState } from '../simulation/evaluator'
import { createDefaultSplitMergeConfig, normalizeSplitMergeConfig } from '../types'
import type { UIState, Viewport, PinRef, DragState, HoveredButton, ContextMenuState } from '../types/ui'
import { initialUIState } from '../types/ui'

// === L-Shape Recalculation Helper ===
function recalculateLShapeWaypoints(
  wire: Wire,
  initial: InitialWireState,
  circuit: Circuit,
  customComponents: Map<CustomComponentId, CustomComponentDefinition>
): void {
  const { xRatio, anchorX, anchorY, isSourceEnd, remainingWaypoints } = initial

  // Get the new position of the moving end
  const movingEnd = isSourceEnd
    ? getWireEndpointWorld(wire.source, circuit, customComponents)
    : getWireEndpointWorld(wire.target, circuit, customComponents)
  if (!movingEnd) return

  // Calculate new bend X using proportional ratio
  const newBendX = snapToGrid(
    movingEnd.x + xRatio * (anchorX - movingEnd.x),
    GRID_STEP
  )

  // Create L-shape bends
  const bend1 = { x: newBendX, y: movingEnd.y }   // At moving end's Y
  const bend2 = { x: newBendX, y: anchorY }        // At anchor's Y

  // Reconstruct waypoints
  if (isSourceEnd) {
    wire.waypoints = [bend1, bend2, ...remainingWaypoints]
  } else {
    wire.waypoints = [...remainingWaypoints, bend2, bend1]
  }
}

// === ID Counters ===
let nextComponentId = 1
let nextWireId = 1
let nextInputId = 1
let nextOutputId = 1

function createDefaultCircuit(): Circuit {
  return {
    id: crypto.randomUUID(),
    name: 'Untitled Circuit',
    inputs: [{ id: nextInputId++ as InputId, label: 'I0', value: false, bitWidth: 1, order: 0 }],
    outputs: [{ id: nextOutputId++ as OutputId, label: 'O0', bitWidth: 1, order: 0 }],
    components: [],
    wires: [],
    inputBoard: { x: -360, y: 0 },
    outputBoard: { x: 360, y: 0 },
  }
}

const STORAGE_KEY = 'logic-gate-custom-components'

// === Store Interface ===
interface AppState {
  // Circuit state
  circuit: Circuit

  // UI state
  ui: UIState

  // Custom components
  customComponents: Map<CustomComponentId, CustomComponentDefinition>
  editingCustomComponentId: CustomComponentId | null

  // Undo/Redo
  undoStack: Circuit[]
  redoStack: Circuit[]
  pushUndo: () => void
  undo: () => void
  redo: () => void

  // Circuit actions
  addComponent: (type: ComponentType, x: number, y: number) => ComponentId
  removeComponent: (id: ComponentId) => void
  moveComponent: (id: ComponentId, x: number, y: number, initialWireState?: InitialWireState[]) => void
  moveSelectedComponents: (dx: number, dy: number) => void

  addWire: (source: WireSource, target: WireTarget, waypoints?: Point[]) => WireId | null
  removeWire: (id: WireId) => void
  updateWireWaypoints: (id: WireId, waypoints: Point[] | undefined) => void

  addInput: (label?: string) => InputId
  removeInput: (id: InputId) => void
  toggleInput: (id: InputId) => void
  renameInput: (id: InputId, label: string) => void
  setInputBitWidth: (id: InputId, bitWidth: number) => void
  setInputValue: (id: InputId, value: boolean | boolean[]) => void

  addOutput: (label?: string) => OutputId
  removeOutput: (id: OutputId) => void
  renameOutput: (id: OutputId, label: string) => void

  setSplitMergeConfig: (id: ComponentId, config: SplitMergeConfig) => void

  moveInputBoard: (x: number, y: number, initialWireState?: InitialWireState[]) => void
  moveOutputBoard: (x: number, y: number, initialWireState?: InitialWireState[]) => void

  // Custom component actions
  createCustomComponent: (name: string) => CustomComponentId | null
  deleteCustomComponent: (id: CustomComponentId) => void
  importComponents: (toInsert: CustomComponentDefinition[], toRemove?: CustomComponentId[], toUpdate?: CustomComponentDefinition[]) => void
  loadCustomComponents: () => void
  saveCustomComponents: () => void
  openCustomComponentForEdit: (id: CustomComponentId) => boolean

  // UI actions
  setViewport: (viewport: Partial<Viewport>) => void
  pan: (dx: number, dy: number) => void
  zoom: (factor: number, centerX: number, centerY: number) => void

  selectComponent: (id: ComponentId, additive?: boolean) => void
  selectWire: (id: WireId, additive?: boolean) => void
  clearSelection: () => void
  selectAll: () => void
  deleteSelected: () => void

  setDrag: (drag: Partial<DragState>) => void
  resetDrag: () => void

  startWiring: (pin: PinRef) => void
  completeWiring: (pin: PinRef) => void
  cancelWiring: () => void
  addWiringWaypoint: (point: Point) => void
  removeWiringWaypoint: (index: number) => void

  setHoveredPin: (componentId: ComponentId | null, pinIndex: number | null) => void
  setHoveredBoardPin: (inputId: InputId | null, outputId: OutputId | null) => void
  setHoveredButton: (button: HoveredButton) => void

  showContextMenu: (menu: ContextMenuState) => void
  hideContextMenu: () => void
}

// === Store Implementation ===
export const useStore = create<AppState>()(
  immer((set, get) => {
    const MAX_UNDO = 100
    const withUndo = (fn: (state: Draft<AppState>) => void) => {
      const currentCircuit = get().circuit
      set((state) => {
        state.undoStack.push(currentCircuit)
        state.redoStack.length = 0
        if (state.undoStack.length > MAX_UNDO)
          state.undoStack.splice(0, state.undoStack.length - MAX_UNDO)
        fn(state)
      })
    }

    return {
    circuit: createDefaultCircuit(),
    undoStack: [] as Circuit[],
    redoStack: [] as Circuit[],
    ui: initialUIState,
    customComponents: new Map<CustomComponentId, CustomComponentDefinition>(),
    editingCustomComponentId: null,

    // === Circuit Actions ===
    addComponent: (type, x, y) => {
      const id = nextComponentId++ as ComponentId
      withUndo((state) => {
        state.circuit.components.push({
          id,
          type,
          x,
          y,
          splitMerge: type === 'SPLIT_MERGE' ? createDefaultSplitMergeConfig() : undefined,
        })
      })
      return id
    },

    removeComponent: (id) => {
      withUndo((state) => {
        state.circuit.components = state.circuit.components.filter((c) => c.id !== id)
        // Remove connected wires
        state.circuit.wires = state.circuit.wires.filter(
          (w) =>
            !(w.source.type === 'component' && w.source.componentId === id) &&
            !(w.target.type === 'component' && w.target.componentId === id)
        )
        state.ui.selection.components.delete(id)
      })
      removeLatchState(id)
    },

    moveComponent: (id, x, y, initialWireState) => {
      set((state) => {
        const component = state.circuit.components.find((c) => c.id === id)
        if (component) {
          // Move the component
          component.x = x
          component.y = y

          // If initial wire state is provided, use it for waypoint updates
          if (initialWireState && initialWireState.length > 0) {
            const initialStateMap = new Map(initialWireState.map((s) => [s.wireId, s]))

            for (const wire of state.circuit.wires) {
              const initial = initialStateMap.get(wire.id)
              if (!initial) continue

              // Translation mode: both ends moving, translate all waypoints
              if (initial.bothEndsMoving && initial.originalWaypoints) {
                // Get current source position and compute delta from original
                const sourcePos = getWireEndpointWorld(wire.source, state.circuit, state.customComponents)
                if (!sourcePos) continue

                // The delta is already applied to the component, so we can compute it from
                // the current position vs the anchor (which was the original source position)
                const dx = sourcePos.x - initial.anchorX
                const dy = sourcePos.y - initial.anchorY

                // Translate all waypoints by the same delta
                wire.waypoints = initial.originalWaypoints.map(wp => ({
                  x: snapToGrid(wp.x + dx, GRID_STEP),
                  y: snapToGrid(wp.y + dy, GRID_STEP)
                }))
                continue
              }

              // L-shape recalculation mode: only one end moving
              recalculateLShapeWaypoints(wire, initial, state.circuit, state.customComponents)
            }
          }

          // Clear cached wire paths for this component
          clearPathsForComponent(id, state.circuit)
        }
      })
    },

    moveSelectedComponents: (dx, dy) => {
      set((state) => {
        for (const id of state.ui.selection.components) {
          const component = state.circuit.components.find((c) => c.id === id)
          if (component) {
            component.x += dx
            component.y += dy
            // Clear cached wire paths for this component
            clearPathsForComponent(id, state.circuit)
          }
        }
      })
    },

    addWire: (source, target, waypoints) => {
      const id = nextWireId++ as WireId
      withUndo((state) => {
        // Remove any existing wire to the same target (input pins can only have one connection)
        state.circuit.wires = state.circuit.wires.filter((w) => {
          if (target.type === 'component') {
            return !(
              w.target.type === 'component' &&
              w.target.componentId === target.componentId &&
              w.target.pinIndex === target.pinIndex
            )
          } else {
            return !(w.target.type === 'output' && w.target.outputId === target.outputId)
          }
        })
        const wire: Wire = { id, source, target }
        if (waypoints && waypoints.length > 0) {
          wire.waypoints = waypoints
        }
        state.circuit.wires.push(wire)
      })
      return id
    },

    removeWire: (id) => {
      withUndo((state) => {
        state.circuit.wires = state.circuit.wires.filter((w) => w.id !== id)
        state.ui.selection.wires.delete(id)
      })
      clearWirePath(id)
    },

    updateWireWaypoints: (id, waypoints) => {
      set((state) => {
        const wire = state.circuit.wires.find((w) => w.id === id)
        if (wire) {
          wire.waypoints = waypoints
          // Clear cached path so it gets recomputed
          clearWirePath(id)
        }
      })
    },

    addInput: (label) => {
      const id = nextInputId++ as InputId
      const state = get()
      const order = state.circuit.inputs.length
      withUndo((state) => {
        state.circuit.inputs.push({
          id,
          label: label ?? `I${order}`,
          value: false,
          bitWidth: 1,
          order,
        })
      })
      return id
    },

    removeInput: (id) => {
      withUndo((state) => {
        // Always keep at least 1 input
        if (state.circuit.inputs.length <= 1) return
        state.circuit.inputs = state.circuit.inputs.filter((i) => i.id !== id)
        // Remove connected wires
        state.circuit.wires = state.circuit.wires.filter(
          (w) => !(w.source.type === 'input' && w.source.inputId === id)
        )
        // Reorder remaining inputs
        state.circuit.inputs.forEach((input, idx) => {
          input.order = idx
        })
      })
    },

    toggleInput: (id) => {
      withUndo((state) => {
        const input = state.circuit.inputs.find((i) => i.id === id)
        if (input) {
          // Only toggle single-bit inputs
          if (input.bitWidth === 1 && typeof input.value === 'boolean') {
            input.value = !input.value
          }
        }
      })
    },

    renameInput: (id, label) => {
      withUndo((state) => {
        const input = state.circuit.inputs.find((i) => i.id === id)
        if (input) {
          input.label = label
        }
      })
    },

    setInputBitWidth: (id, bitWidth) => {
      withUndo((state) => {
        const input = state.circuit.inputs.find((i) => i.id === id)
        if (input) {
          const clampedWidth = Math.max(1, Math.min(32, bitWidth))
          const oldWidth = input.bitWidth

          if (clampedWidth === oldWidth) return

          if (clampedWidth === 1) {
            // Convert to single-bit: use LSB or false
            if (Array.isArray(input.value)) {
              input.value = input.value[0] ?? false
            }
          } else {
            // Convert to multi-bit
            const newValue: boolean[] = new Array(clampedWidth).fill(false)
            if (Array.isArray(input.value)) {
              // Copy existing bits, pad/truncate as needed
              for (let i = 0; i < Math.min(input.value.length, clampedWidth); i++) {
                newValue[i] = input.value[i] ?? false
              }
            } else {
              // Single-bit becoming multi-bit: use old value as LSB
              newValue[0] = input.value
            }
            input.value = newValue
          }

          input.bitWidth = clampedWidth

          // Update connected output board pins to match the new bit width
          for (const wire of state.circuit.wires) {
            const source = wire.source
            const target = wire.target
            if (source.type === 'input' && source.inputId === id) {
              if (target.type === 'output') {
                const output = state.circuit.outputs.find((o) => o.id === target.outputId)
                if (output) {
                  output.bitWidth = clampedWidth
                }
              }
            }
          }
        }
      })
    },

    setInputValue: (id, value) => {
      withUndo((state) => {
        const input = state.circuit.inputs.find((i) => i.id === id)
        if (input) {
          // Ensure value matches bitWidth
          if (input.bitWidth === 1) {
            input.value = Array.isArray(value) ? (value[0] ?? false) : value
          } else {
            if (Array.isArray(value)) {
              // Pad or truncate to match bitWidth
              const newValue: boolean[] = new Array(input.bitWidth).fill(false)
              for (let i = 0; i < Math.min(value.length, input.bitWidth); i++) {
                newValue[i] = value[i] ?? false
              }
              input.value = newValue
            } else {
              // Single boolean to multi-bit: use as LSB
              const newValue: boolean[] = new Array(input.bitWidth).fill(false)
              newValue[0] = value
              input.value = newValue
            }
          }
        }
      })
    },

    addOutput: (label) => {
      const id = nextOutputId++ as OutputId
      const state = get()
      const order = state.circuit.outputs.length
      withUndo((state) => {
        state.circuit.outputs.push({
          id,
          label: label ?? `O${order}`,
          bitWidth: 1,
          order,
        })
      })
      return id
    },

    removeOutput: (id) => {
      withUndo((state) => {
        // Always keep at least 1 output
        if (state.circuit.outputs.length <= 1) return
        state.circuit.outputs = state.circuit.outputs.filter((o) => o.id !== id)
        // Remove connected wires
        state.circuit.wires = state.circuit.wires.filter(
          (w) => !(w.target.type === 'output' && w.target.outputId === id)
        )
        // Reorder remaining outputs
        state.circuit.outputs.forEach((output, idx) => {
          output.order = idx
        })
      })
    },

    renameOutput: (id, label) => {
      withUndo((state) => {
        const output = state.circuit.outputs.find((o) => o.id === id)
        if (output) {
          output.label = label
        }
      })
    },

    setSplitMergeConfig: (id, config) => {
      withUndo((state) => {
        const component = state.circuit.components.find((c) => c.id === id)
        if (!component || component.type !== 'SPLIT_MERGE') return
        const nextConfig = normalizeSplitMergeConfig(config)
        const prevConfig = component.splitMerge
        const changed =
          !prevConfig ||
          prevConfig.mode !== nextConfig.mode ||
          prevConfig.partitions.length !== nextConfig.partitions.length ||
          prevConfig.partitions.some((size, index) => size !== nextConfig.partitions[index])

        component.splitMerge = nextConfig

        if (changed) {
          state.circuit.wires = state.circuit.wires.filter(
            (w) =>
              !(w.source.type === 'component' && w.source.componentId === id) &&
              !(w.target.type === 'component' && w.target.componentId === id)
          )
          clearPathsForComponent(id, state.circuit)
        }
      })
    },

    moveInputBoard: (x, y, initialWireState) => {
      set((state) => {
        // Move the board
        state.circuit.inputBoard.x = x
        state.circuit.inputBoard.y = y

        // If initial wire state is provided, use it for L-shape recalculation
        if (initialWireState && initialWireState.length > 0) {
          const initialStateMap = new Map(initialWireState.map((s) => [s.wireId, s]))

          for (const wire of state.circuit.wires) {
            const initial = initialStateMap.get(wire.id)
            if (!initial) continue

            recalculateLShapeWaypoints(wire, initial, state.circuit, state.customComponents)
          }
        }

        // Clear cached wire paths for input board wires
        clearPathsForInputBoard(state.circuit)
      })
    },

    moveOutputBoard: (x, y, initialWireState) => {
      set((state) => {
        // Move the board
        state.circuit.outputBoard.x = x
        state.circuit.outputBoard.y = y

        // If initial wire state is provided, use it for L-shape recalculation
        if (initialWireState && initialWireState.length > 0) {
          const initialStateMap = new Map(initialWireState.map((s) => [s.wireId, s]))

          for (const wire of state.circuit.wires) {
            const initial = initialStateMap.get(wire.id)
            if (!initial) continue

            recalculateLShapeWaypoints(wire, initial, state.circuit, state.customComponents)
          }
        }

        // Clear cached wire paths for output board wires
        clearPathsForOutputBoard(state.circuit)
      })
    },

    // === Custom Component Actions ===
    createCustomComponent: (name) => {
      const state = get()

      // Validate the circuit
      const validation = validateCircuitForComponent(state.circuit)
      if (!validation.valid) {
        console.warn('Circuit validation failed:', validation.errors)
        return null
      }

      const editingId = state.editingCustomComponentId
      const normalizedName = name.trim()

      // Check for duplicate name
      for (const [, def] of state.customComponents) {
        if (def.name.toLowerCase() === normalizedName.toLowerCase()) {
          if (!editingId || def.id !== editingId) {
            console.warn('Component name already exists:', name)
            return null
          }
        }
      }

      // Generate ID and compute layout
      const id = editingId ?? createCustomComponentId(crypto.randomUUID())
      const inputLabels = [...state.circuit.inputs]
        .sort((a, b) => a.order - b.order)
        .map((i) => i.label)
      const outputLabels = [...state.circuit.outputs]
        .sort((a, b) => a.order - b.order)
        .map((o) => o.label)
      const { width, height, pins } = computePinLayout(
        state.circuit.inputs.length,
        state.circuit.outputs.length,
        inputLabels,
        outputLabels,
        name
      )

      // Create pins with bit widths from circuit inputs/outputs
      const sortedInputs = [...state.circuit.inputs].sort((a, b) => a.order - b.order)
      const sortedOutputs = [...state.circuit.outputs].sort((a, b) => a.order - b.order)

      // Update pins with bitWidth from corresponding circuit inputs/outputs
      const pinsWithBitWidth = pins.map((pin) => {
        if (pin.direction === 'input') {
          const inputIdx = pins.filter((p, i) => i < pins.indexOf(pin) && p.direction === 'input').length
          const input = sortedInputs[inputIdx]
          return { ...pin, bitWidth: input?.bitWidth ?? 1 }
        } else {
          const outputIdx = pins.filter((p, i) => i < pins.indexOf(pin) && p.direction === 'output').length
          const output = sortedOutputs[outputIdx]
          return { ...pin, bitWidth: output?.bitWidth ?? 1 }
        }
      })

      const definition: CustomComponentDefinition = {
        id,
        name: normalizedName,
        createdAt: editingId ? (state.customComponents.get(editingId)?.createdAt ?? Date.now()) : Date.now(),
        circuit: {
          inputs: state.circuit.inputs.map((i) => ({
            id: i.id,
            label: i.label,
            bitWidth: i.bitWidth,
            order: i.order,
          })),
          outputs: state.circuit.outputs.map((o) => ({
            id: o.id,
            label: o.label,
            bitWidth: o.bitWidth,
            order: o.order,
          })),
          components: structuredClone(state.circuit.components),
          wires: structuredClone(state.circuit.wires),
          inputBoard: structuredClone(state.circuit.inputBoard),
          outputBoard: structuredClone(state.circuit.outputBoard),
        },
        width,
        height,
        pins: pinsWithBitWidth,
      }

      set((state) => {
        state.customComponents.set(id, definition)

        // Reset the circuit to initial state
        state.circuit = createDefaultCircuit()

        state.editingCustomComponentId = null

        // Clear undo/redo stacks (circuit was replaced)
        state.undoStack.length = 0
        state.redoStack.length = 0

        // Clear selection
        state.ui.selection.components.clear()
        state.ui.selection.wires.clear()
      })
      clearPathCache()
      resetLatchStates()

      // Persist to localStorage
      get().saveCustomComponents()

      return id
    },

    deleteCustomComponent: (id) => {
      set((state) => {
        state.customComponents.delete(id)
      })
      get().saveCustomComponents()
    },

    importComponents: (toInsert, toRemove, toUpdate) => {
      set((state) => {
        if (toRemove) {
          for (const id of toRemove) {
            state.customComponents.delete(id)
          }
        }
        if (toUpdate) {
          for (const def of toUpdate) {
            state.customComponents.set(def.id, def)
          }
        }
        for (const def of toInsert) {
          state.customComponents.set(def.id, def)
        }
      })
      get().saveCustomComponents()
    },

    loadCustomComponents: () => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY)
        if (stored) {
          const parsed = JSON.parse(stored) as CustomComponentDefinition[]
          set((state) => {
            state.customComponents.clear()
            for (const def of parsed) {
              state.customComponents.set(def.id, def)
            }
          })
        }
      } catch (e) {
        console.error('Failed to load custom components:', e)
      }
    },

    saveCustomComponents: () => {
      const state = get()
      const definitions = Array.from(state.customComponents.values())
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(definitions))
      } catch (e) {
        console.error('Failed to save custom components:', e)
      }
    },

    openCustomComponentForEdit: (id) => {
      const state = get()
      const definition = state.customComponents.get(id)
      if (!definition) return false

      set((draft) => {
        draft.circuit = {
          id: crypto.randomUUID(),
          name: definition.name,
          inputs: definition.circuit.inputs.map((input) => ({
            id: input.id,
            label: input.label,
            value: false,
            bitWidth: input.bitWidth,
            order: input.order,
          })),
          outputs: definition.circuit.outputs.map((output) => ({
            id: output.id,
            label: output.label,
            bitWidth: output.bitWidth,
            order: output.order,
          })),
          components: structuredClone(definition.circuit.components),
          wires: structuredClone(definition.circuit.wires),
          inputBoard: structuredClone(definition.circuit.inputBoard),
          outputBoard: structuredClone(definition.circuit.outputBoard),
        }

        draft.editingCustomComponentId = id
        draft.undoStack.length = 0
        draft.redoStack.length = 0
        draft.ui.selection.components.clear()
        draft.ui.selection.wires.clear()
        draft.ui.wiring.active = false
        draft.ui.wiring.startPin = null
        draft.ui.wiring.waypoints = []
        draft.ui.drag = {
          type: 'none',
          startX: 0,
          startY: 0,
          currentX: 0,
          currentY: 0,
        }
      })
      clearPathCache()
      resetLatchStates()

      return true
    },

    // === UI Actions ===
    setViewport: (viewport) => {
      set((state) => {
        Object.assign(state.ui.viewport, viewport)
      })
    },

    pan: (dx, dy) => {
      set((state) => {
        state.ui.viewport.panX += dx
        state.ui.viewport.panY += dy
      })
    },

    zoom: (factor, centerX, centerY) => {
      set((state) => {
        const oldZoom = state.ui.viewport.zoom
        const newZoom = Math.max(0.1, Math.min(5, oldZoom * factor))

        // Zoom towards cursor position
        state.ui.viewport.panX = centerX - (centerX - state.ui.viewport.panX) * (newZoom / oldZoom)
        state.ui.viewport.panY = centerY - (centerY - state.ui.viewport.panY) * (newZoom / oldZoom)
        state.ui.viewport.zoom = newZoom
      })
    },

    selectComponent: (id, additive = false) => {
      set((state) => {
        if (!additive) {
          state.ui.selection.components.clear()
          state.ui.selection.wires.clear()
        }
        if (state.ui.selection.components.has(id)) {
          state.ui.selection.components.delete(id)
        } else {
          state.ui.selection.components.add(id)
        }
      })
    },

    selectWire: (id, additive = false) => {
      set((state) => {
        if (!additive) {
          state.ui.selection.components.clear()
          state.ui.selection.wires.clear()
        }
        if (state.ui.selection.wires.has(id)) {
          state.ui.selection.wires.delete(id)
        } else {
          state.ui.selection.wires.add(id)
        }
      })
    },

    clearSelection: () => {
      set((state) => {
        state.ui.selection.components.clear()
        state.ui.selection.wires.clear()
      })
    },

    selectAll: () => {
      set((state) => {
        for (const c of state.circuit.components) {
          state.ui.selection.components.add(c.id)
        }
        for (const w of state.circuit.wires) {
          state.ui.selection.wires.add(w.id)
        }
      })
    },

    deleteSelected: () => {
      const { ui } = get()
      if (ui.selection.components.size === 0 && ui.selection.wires.size === 0) return
      const deletedComponents = new Set(ui.selection.components)
      const deletedWires = new Set(ui.selection.wires)
      withUndo((state) => {
        for (const id of deletedComponents) {
          state.circuit.wires = state.circuit.wires.filter(
            (w) =>
              !(w.source.type === 'component' && w.source.componentId === id) &&
              !(w.target.type === 'component' && w.target.componentId === id)
          )
        }
        state.circuit.components = state.circuit.components.filter(
          (c) => !deletedComponents.has(c.id)
        )
        state.circuit.wires = state.circuit.wires.filter(
          (w) => !deletedWires.has(w.id)
        )
        state.ui.selection.components.clear()
        state.ui.selection.wires.clear()
      })
      for (const id of deletedComponents) removeLatchState(id)
      for (const id of deletedWires) clearWirePath(id)
    },

    setDrag: (drag) => {
      set((state) => {
        Object.assign(state.ui.drag, drag)
      })
    },

    resetDrag: () => {
      set((state) => {
        state.ui.drag = {
          type: 'none',
          startX: 0,
          startY: 0,
          currentX: 0,
          currentY: 0,
        }
      })
    },

    startWiring: (pin) => {
      set((state) => {
        state.ui.wiring.active = true
        state.ui.wiring.startPin = pin
        state.ui.wiring.waypoints = []
      })
    },

    completeWiring: (pin) => {
      const state = get()
      const startPin = state.ui.wiring.startPin
      if (!startPin) return

      // Helper to determine if a pin can be a source
      // Sources: Input Board pins, Component output pins
      const canBeSource = (p: PinRef): WireSource | null => {
        if (p.type === 'input') {
          return { type: 'input', inputId: p.inputId }
        }
        if (p.type === 'component' && p.pinType === 'output') {
          return { type: 'component', componentId: p.componentId, pinIndex: p.pinIndex }
        }
        return null
      }

      // Helper to determine if a pin can be a target
      // Targets: Output Board pins, Component input pins
      const canBeTarget = (p: PinRef): WireTarget | null => {
        if (p.type === 'output') {
          return { type: 'output', outputId: p.outputId as OutputId }
        }
        if (p.type === 'component' && p.pinType === 'input') {
          return { type: 'component', componentId: p.componentId, pinIndex: p.pinIndex }
        }
        return null
      }

      // Check for self-connection (component output to its own input)
      const isSelfConnection =
        startPin.type === 'component' &&
        pin.type === 'component' &&
        startPin.componentId === pin.componentId

      if (isSelfConnection) {
        state.cancelWiring()
        return
      }

      // Helper to get bit width of a pin reference
      const getPinBitWidth = (p: PinRef): number => {
        if (p.type === 'input') {
          const input = state.circuit.inputs.find((i) => i.id === p.inputId)
          return input?.bitWidth ?? 1
        }
        if (p.type === 'output') {
          const output = state.circuit.outputs.find((o) => o.id === p.outputId)
          return output?.bitWidth ?? 1
        }
        if (p.type === 'component') {
          const component = state.circuit.components.find((c) => c.id === p.componentId)
          if (component) {
            const def = getComponentDefinition(component.type, state.customComponents, component)
            if (def) {
              const pin = def.pins.find((pin) => pin.index === p.pinIndex)
              return pin?.bitWidth ?? 1
            }
          }
        }
        return 1
      }

      // Get user-specified waypoints
      const userWaypoints = state.ui.wiring.waypoints

      // Helper to compute final waypoints including L-shape bends
      const computeFinalWaypoints = (
        source: WireSource,
        target: WireTarget,
        waypoints: Point[]
      ): Point[] | undefined => {
        // If no user waypoints, use default L-shape routing
        if (waypoints.length === 0) {
          return undefined
        }

        const startPos = getWireEndpointWorld(source, state.circuit, state.customComponents)
        const endPos = getWireEndpointWorld(target, state.circuit, state.customComponents)

        if (!startPos || !endPos) {
          return waypoints // Fallback to user waypoints
        }

        // Compute full path with L-shapes (isSourcePin=true since we're going source->target)
        const fullPath = computePreviewPathWithWaypoints(startPos, waypoints, endPos, true)

        // Simplify the path to remove collinear points, then extract waypoints
        const simplified = simplifyPath(fullPath)

        // Extract waypoints (everything except first and last which are pin positions)
        if (simplified.length > 2) {
          return simplified.slice(1, -1)
        }

        return undefined
      }

      // Helper to validate bit width compatibility
        const getSplitMergePinWidth = (pin: PinRef): number | null => {
          if (pin.type !== 'component') return null
          const component = state.circuit.components.find((c) => c.id === pin.componentId)
          if (!component || component.type !== 'SPLIT_MERGE') return null
          const config = normalizeSplitMergeConfig(component.splitMerge)
          if (pin.pinIndex === 0) {
            return config.partitions.reduce((sum, size) => sum + size, 0)
          }
          return config.partitions[pin.pinIndex - 1] ?? 1
        }

        const validateBitWidth = (sourcePin: PinRef, targetPin: PinRef): boolean => {
          const sourceBitWidth = getPinBitWidth(sourcePin)
          const targetBitWidth = getPinBitWidth(targetPin)

          // If target is output board pin, will auto-adapt in withUndo block
          if (targetPin.type === 'output') {
            return true
          }

          const targetSplitWidth = getSplitMergePinWidth(targetPin)
          if (targetSplitWidth !== null && targetSplitWidth !== sourceBitWidth) {
            console.warn(`Split/Merge pin width mismatch: pin=${targetSplitWidth}, source=${sourceBitWidth}`)
            return false
          }

          const sourceSplitWidth = getSplitMergePinWidth(sourcePin)
          if (sourceSplitWidth !== null && sourceSplitWidth !== targetBitWidth) {
            console.warn(`Split/Merge pin width mismatch: pin=${sourceSplitWidth}, target=${targetBitWidth}`)
            return false
          }

          // If target is component input pin, reject if bit widths don't match
          if (targetPin.type === 'component' && sourceBitWidth !== targetBitWidth) {
            console.warn(`Bit width mismatch: source=${sourceBitWidth}, target=${targetBitWidth}`)
            return false
          }

          return true
        }

      // Helper to add wire with undo in a single transaction (including bitwidth adaptation)
      const addWireWithUndo = (source: WireSource, target: WireTarget, waypoints: Point[] | undefined, sourcePin: PinRef) => {
        const id = nextWireId++ as WireId
        withUndo((s) => {
          // Auto-adapt output bitwidth to match source
          if (target.type === 'output') {
            const sourceBitWidth = getPinBitWidth(sourcePin)
            const output = s.circuit.outputs.find((o) => o.id === target.outputId)
            if (output && output.bitWidth !== sourceBitWidth) {
              output.bitWidth = sourceBitWidth
            }
          }
          // Remove existing wire to same target
          s.circuit.wires = s.circuit.wires.filter((w) => {
            if (target.type === 'component') {
              return !(
                w.target.type === 'component' &&
                w.target.componentId === target.componentId &&
                w.target.pinIndex === target.pinIndex
              )
            } else {
              return !(w.target.type === 'output' && w.target.outputId === target.outputId)
            }
          })
          const wire: Wire = { id, source, target }
          if (waypoints && waypoints.length > 0) {
            wire.waypoints = waypoints
          }
          s.circuit.wires.push(wire)
        })
      }

      // Try startPin as source, pin as target
      const source1 = canBeSource(startPin)
      const target1 = canBeTarget(pin)
      if (source1 && target1) {
        if (!validateBitWidth(startPin, pin)) {
          state.cancelWiring()
          return
        }
        const finalWaypoints = computeFinalWaypoints(source1, target1, userWaypoints)
        addWireWithUndo(source1, target1, finalWaypoints, startPin)
        state.cancelWiring()
        return
      }

      // Try pin as source, startPin as target (reverse direction)
      const source2 = canBeSource(pin)
      const target2 = canBeTarget(startPin)
      if (source2 && target2) {
        if (!validateBitWidth(pin, startPin)) {
          state.cancelWiring()
          return
        }
        // When reversing direction, reverse the user waypoints first
        const reversedUserWaypoints = [...userWaypoints].reverse()
        const finalWaypoints = computeFinalWaypoints(source2, target2, reversedUserWaypoints)
        addWireWithUndo(source2, target2, finalWaypoints, pin)
      }

      state.cancelWiring()
    },

    cancelWiring: () => {
      set((state) => {
        state.ui.wiring.active = false
        state.ui.wiring.startPin = null
        state.ui.wiring.waypoints = []
      })
    },

    addWiringWaypoint: (point) => {
      set((state) => {
        if (state.ui.wiring.active) {
          state.ui.wiring.waypoints.push(point)
        }
      })
    },

    removeWiringWaypoint: (index) => {
      set((state) => {
        if (state.ui.wiring.active && index >= 0 && index < state.ui.wiring.waypoints.length) {
          state.ui.wiring.waypoints.splice(index, 1)
        }
      })
    },

    setHoveredPin: (componentId, pinIndex) => {
      set((state) => {
        state.ui.hoveredComponentId = componentId
        state.ui.hoveredPinIndex = pinIndex
      })
    },

    setHoveredBoardPin: (inputId, outputId) => {
      set((state) => {
        state.ui.hoveredInputId = inputId
        state.ui.hoveredOutputId = outputId
      })
    },

    setHoveredButton: (button) => {
      set((state) => {
        state.ui.hoveredButton = button
      })
    },

    showContextMenu: (menu) => {
      set((state) => {
        state.ui.contextMenu = menu
      })
    },

    hideContextMenu: () => {
      set((state) => {
        state.ui.contextMenu = null
      })
    },

    pushUndo: () => {
      const currentCircuit = get().circuit
      set((state) => {
        state.undoStack.push(currentCircuit)
        state.redoStack.length = 0
        if (state.undoStack.length > MAX_UNDO)
          state.undoStack.splice(0, state.undoStack.length - MAX_UNDO)
      })
    },

    undo: () => {
      const s = get()
      if (s.undoStack.length === 0) return
      if (s.ui.drag.type !== 'none' || s.ui.wiring.active) return
      const currentCircuit = s.circuit
      set((state) => {
        state.redoStack.push(currentCircuit)
        state.circuit = state.undoStack.pop()!
        state.ui.selection.components.clear()
        state.ui.selection.wires.clear()
        state.ui.wiring = { active: false, startPin: null, waypoints: [] }
        state.ui.contextMenu = null
      })
      clearPathCache()
      resetLatchStates()
    },

    redo: () => {
      const s = get()
      if (s.redoStack.length === 0) return
      if (s.ui.drag.type !== 'none' || s.ui.wiring.active) return
      const currentCircuit = s.circuit
      set((state) => {
        state.undoStack.push(currentCircuit)
        state.circuit = state.redoStack.pop()!
        state.ui.selection.components.clear()
        state.ui.selection.wires.clear()
        state.ui.wiring = { active: false, startPin: null, waypoints: [] }
        state.ui.contextMenu = null
      })
      clearPathCache()
      resetLatchStates()
    },
  }
  })
)
