import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { enableMapSet } from 'immer'

// Enable Immer support for Map and Set
enableMapSet()
import type {
  Circuit,
  ComponentId,
  WireId,
  WireSource,
  WireTarget,
  InputId,
  OutputId,
  ComponentType,
  CustomComponentId,
  CustomComponentDefinition,
} from '../types/circuit'
import { createCustomComponentId } from '../types/circuit'
import { validateCircuitForComponent } from '../utils/validation'
import { computePinLayout } from '../utils/pinLayout'
import type { UIState, Viewport, PinRef, DragState, HoveredButton } from '../types/ui'
import { initialUIState } from '../types/ui'

// === ID Counters ===
let nextComponentId = 1
let nextWireId = 1
let nextInputId = 1
let nextOutputId = 1

const STORAGE_KEY = 'logic-gate-custom-components'

// === Store Interface ===
interface AppState {
  // Circuit state
  circuit: Circuit

  // UI state
  ui: UIState

  // Custom components
  customComponents: Map<CustomComponentId, CustomComponentDefinition>

  // Circuit actions
  addComponent: (type: ComponentType, x: number, y: number) => ComponentId
  removeComponent: (id: ComponentId) => void
  moveComponent: (id: ComponentId, x: number, y: number) => void
  moveSelectedComponents: (dx: number, dy: number) => void

  addWire: (source: WireSource, target: WireTarget) => WireId | null
  removeWire: (id: WireId) => void

  addInput: (label?: string) => InputId
  removeInput: (id: InputId) => void
  toggleInput: (id: InputId) => void
  renameInput: (id: InputId, label: string) => void

  addOutput: (label?: string) => OutputId
  removeOutput: (id: OutputId) => void
  renameOutput: (id: OutputId, label: string) => void

  moveInputBoard: (x: number, y: number) => void
  moveOutputBoard: (x: number, y: number) => void

  // Custom component actions
  createCustomComponent: (name: string) => CustomComponentId | null
  deleteCustomComponent: (id: CustomComponentId) => void
  loadCustomComponents: () => void
  saveCustomComponents: () => void

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

  setHoveredPin: (componentId: ComponentId | null, pinIndex: number | null) => void
  setHoveredBoardPin: (inputId: InputId | null, outputId: OutputId | null) => void
  setHoveredButton: (button: HoveredButton) => void
}

// === Initial Circuit State ===
const initialCircuit: Circuit = {
  id: crypto.randomUUID(),
  name: 'Untitled Circuit',
  inputs: [],
  outputs: [],
  components: [],
  wires: [],
  inputBoard: { x: -350, y: 0 },
  outputBoard: { x: 350, y: 0 },
}

// === Store Implementation ===
export const useStore = create<AppState>()(
  immer((set, get) => ({
    circuit: initialCircuit,
    ui: initialUIState,
    customComponents: new Map<CustomComponentId, CustomComponentDefinition>(),

    // === Circuit Actions ===
    addComponent: (type, x, y) => {
      const id = nextComponentId++ as ComponentId
      set((state) => {
        state.circuit.components.push({ id, type, x, y })
      })
      return id
    },

    removeComponent: (id) => {
      set((state) => {
        state.circuit.components = state.circuit.components.filter((c) => c.id !== id)
        // Remove connected wires
        state.circuit.wires = state.circuit.wires.filter(
          (w) =>
            !(w.source.type === 'component' && w.source.componentId === id) &&
            !(w.target.type === 'component' && w.target.componentId === id)
        )
        state.ui.selection.components.delete(id)
      })
    },

    moveComponent: (id, x, y) => {
      set((state) => {
        const component = state.circuit.components.find((c) => c.id === id)
        if (component) {
          component.x = x
          component.y = y
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
          }
        }
      })
    },

    addWire: (source, target) => {
      const id = nextWireId++ as WireId
      set((state) => {
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
        state.circuit.wires.push({ id, source, target })
      })
      return id
    },

    removeWire: (id) => {
      set((state) => {
        state.circuit.wires = state.circuit.wires.filter((w) => w.id !== id)
        state.ui.selection.wires.delete(id)
      })
    },

    addInput: (label) => {
      const id = nextInputId++ as InputId
      const state = get()
      const order = state.circuit.inputs.length
      set((state) => {
        state.circuit.inputs.push({
          id,
          label: label ?? `I${order}`,
          value: false,
          order,
        })
      })
      return id
    },

    removeInput: (id) => {
      set((state) => {
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
      set((state) => {
        const input = state.circuit.inputs.find((i) => i.id === id)
        if (input) {
          input.value = !input.value
        }
      })
    },

    renameInput: (id, label) => {
      set((state) => {
        const input = state.circuit.inputs.find((i) => i.id === id)
        if (input) {
          input.label = label
        }
      })
    },

    addOutput: (label) => {
      const id = nextOutputId++ as OutputId
      const state = get()
      const order = state.circuit.outputs.length
      set((state) => {
        state.circuit.outputs.push({
          id,
          label: label ?? `O${order}`,
          order,
        })
      })
      return id
    },

    removeOutput: (id) => {
      set((state) => {
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
      set((state) => {
        const output = state.circuit.outputs.find((o) => o.id === id)
        if (output) {
          output.label = label
        }
      })
    },

    moveInputBoard: (x, y) => {
      set((state) => {
        state.circuit.inputBoard.x = x
        state.circuit.inputBoard.y = y
      })
    },

    moveOutputBoard: (x, y) => {
      set((state) => {
        state.circuit.outputBoard.x = x
        state.circuit.outputBoard.y = y
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

      // Check for duplicate name
      for (const [, def] of state.customComponents) {
        if (def.name.toLowerCase() === name.toLowerCase()) {
          console.warn('Component name already exists:', name)
          return null
        }
      }

      // Generate ID and compute layout
      const id = createCustomComponentId(crypto.randomUUID())
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
        outputLabels
      )

      const definition: CustomComponentDefinition = {
        id,
        name,
        createdAt: Date.now(),
        circuit: {
          inputs: state.circuit.inputs.map((i) => ({
            id: i.id,
            label: i.label,
            order: i.order,
          })),
          outputs: state.circuit.outputs.map((o) => ({
            id: o.id,
            label: o.label,
            order: o.order,
          })),
          components: structuredClone(state.circuit.components),
          wires: structuredClone(state.circuit.wires),
        },
        width,
        height,
        pins,
      }

      set((state) => {
        state.customComponents.set(id, definition)

        // Reset the circuit to initial state
        state.circuit = {
          id: crypto.randomUUID(),
          name: 'Untitled Circuit',
          inputs: [],
          outputs: [],
          components: [],
          wires: [],
          inputBoard: { x: -350, y: 0 },
          outputBoard: { x: 350, y: 0 },
        }

        // Clear selection
        state.ui.selection.components.clear()
        state.ui.selection.wires.clear()
      })

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
      const state = get()
      for (const id of state.ui.selection.components) {
        state.removeComponent(id)
      }
      for (const id of state.ui.selection.wires) {
        state.removeWire(id)
      }
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
        if (p.type === 'component') {
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
        if (p.type === 'component') {
          return { type: 'component', componentId: p.componentId, pinIndex: p.pinIndex }
        }
        return null
      }

      // Try startPin as source, pin as target
      const source1 = canBeSource(startPin)
      const target1 = canBeTarget(pin)
      if (source1 && target1) {
        const wireId = state.addWire(source1, target1)
        if (wireId) {
          state.cancelWiring()
          return
        }
      }

      // Try pin as source, startPin as target (reverse direction)
      const source2 = canBeSource(pin)
      const target2 = canBeTarget(startPin)
      if (source2 && target2) {
        state.addWire(source2, target2)
      }

      state.cancelWiring()
    },

    cancelWiring: () => {
      set((state) => {
        state.ui.wiring.active = false
        state.ui.wiring.startPin = null
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
  }))
)
