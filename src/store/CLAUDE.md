# store/ - State Management

Single Zustand store with Immer middleware.

## Setup
```typescript
import { enableMapSet } from 'immer'
enableMapSet() // REQUIRED - selection uses Set<ComponentId>
```

## State Shape

### Circuit State
```typescript
circuit: {
  id: string
  name: string
  inputs: CircuitInput[]      // Input board pins
  outputs: CircuitOutput[]    // Output board pins
  components: Component[]     // Gates on canvas
  wires: Wire[]               // Connections
  inputBoard: { x, y }        // Board position
  outputBoard: { x, y }       // Board position
}
```

### Custom Components
```typescript
customComponents: Map<CustomComponentId, CustomComponentDefinition>
```
Persisted to localStorage under key `'logic-gate-custom-components'`.

### UI State
```typescript
ui: {
  viewport: { panX, panY, zoom }
  selection: { components: Set, wires: Set }
  drag: { type, startX, startY, currentX, currentY }
  wiring: { active, startPin }
  hoveredComponentId, hoveredPinIndex
  hoveredInputId, hoveredOutputId  // Board pin hover state
  hoveredButton                     // Board button hover state
}
```

## Key Actions

### Circuit
- `addComponent(type, x, y)` - add gate or custom component
- `moveComponent(id, x, y)` - reposition gate
- `addWire(source, target)` - connect pins (auto-replaces existing connection to target)
- `addInput()` / `removeInput(id)` - manage input board
- `addOutput()` / `removeOutput(id)` - manage output board
- `renameInput(id, label)` / `renameOutput(id, label)` - rename board pins
- `moveInputBoard(x, y)` / `moveOutputBoard(x, y)` - reposition boards

### Custom Components
- `createCustomComponent(name)` - save current circuit as reusable component
- `deleteCustomComponent(id)` - remove custom component
- `loadCustomComponents()` - load from localStorage (called on app init)
- `saveCustomComponents()` - persist to localStorage

### UI
- `pan(dx, dy)` / `zoom(factor, cx, cy)` - viewport control
- `selectComponent(id, additive)` - selection
- `setDrag(state)` / `resetDrag()` - drag tracking
- `startWiring(pin)` / `completeWiring(pin)` / `cancelWiring()` - wire creation
- `setHoveredPin(componentId, pinIndex)` - component pin hover
- `setHoveredBoardPin(inputId, outputId)` - board pin hover
- `setHoveredButton(button)` - board button hover (add/remove/toggle)

## ID Generation
Uses module-level counters cast to branded types:
```typescript
let nextComponentId = 1
const id = nextComponentId++ as ComponentId
```
