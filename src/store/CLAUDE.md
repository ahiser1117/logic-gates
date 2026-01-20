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
Inputs support multi-bit values; `bitWidth` controls whether the stored value is a single boolean or a boolean array.

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
  wiring: { active, startPin, waypoints }
  hoveredComponentId, hoveredPinIndex
  hoveredInputId, hoveredOutputId  // Board pin hover state
  hoveredButton                     // Board button hover state
}
```

## Key Actions

### Circuit
- `addComponent(type, x, y)` - add gate or custom component (Split/Merge gets default config)
- `moveComponent(id, x, y, initialWireState?)` - reposition gate (recalculates L-shape wire waypoints)
- `addWire(source, target, waypoints?)` - connect pins (auto-replaces existing connection to target)
- `setSplitMergeConfig(id, config)` - update Split/Merge partitions/mode and drop connected wires on change
- `updateWireWaypoints(id, waypoints)` - set custom waypoints for wire path editing
- `addInput()` / `removeInput(id)` - manage input board (minimum 1 pin always kept)
- `addOutput()` / `removeOutput(id)` - manage output board (minimum 1 pin always kept)
- `toggleInput(id)` - toggle input pin value on/off (single-bit only)
- `renameInput(id, label)` / `renameOutput(id, label)` - rename board pins
- `setInputBitWidth(id, bitWidth)` - update input pin width and stored value shape
- `setInputValue(id, value)` - directly set input pin value (single- or multi-bit)
- `moveInputBoard(x, y, initialWireState?)` / `moveOutputBoard(x, y, initialWireState?)` - reposition boards

Initial circuit starts with 1 default input and 1 default output. Boards are positioned at ±360 (on major grid lines).

### Custom Components
- `createCustomComponent(name)` - save current circuit as reusable component (overwrites when editing)
- `deleteCustomComponent(id)` - remove custom component
- `openCustomComponentForEdit(id)` - load custom component circuit into the canvas
- `loadCustomComponents()` - load from localStorage (called on app init)
- `saveCustomComponents()` - persist to localStorage

### UI
- `pan(dx, dy)` / `zoom(factor, cx, cy)` - viewport control
- `selectComponent(id, additive)` / `selectWire(id, additive)` - selection
- `clearSelection()` / `selectAll()` / `deleteSelected()` - bulk selection operations
- `setDrag(state)` / `resetDrag()` - drag tracking
- `startWiring(pin)` / `completeWiring(pin)` / `cancelWiring()` - wire creation
- `addWiringWaypoint(point)` / `removeWiringWaypoint(index)` - manage waypoints during wire creation
- `setHoveredPin(componentId, pinIndex)` - component pin hover
- `setHoveredBoardPin(inputId, outputId)` - board pin hover
- `setHoveredButton(button)` - board button hover (add/remove/toggle)
- `showContextMenu(menu)` / `hideContextMenu()` - context menus for board pins and Split/Merge config

## Wire Connection Validation
`completeWiring()` enforces these rules:
- **Sources**: Input Board pins, component output pins
- **Targets**: Output Board pins, component input pins
- Component input pins cannot connect to each other or to Output Board pins
- Self-connections (component output to its own input) are rejected
- Split/Merge pins validate using per-pin width (bus vs partitions)

## Wire Path Cache
Moving components or boards invalidates affected wire paths:
- `moveComponent()` / `moveSelectedComponents()` → `clearPathsForComponent()`
- `moveInputBoard()` → `clearPathsForInputBoard()`
- `moveOutputBoard()` → `clearPathsForOutputBoard()`

## Wire L-Shape Recalculation
When dragging components/boards, connected wires maintain their L-shape using `InitialWireState`:
```typescript
interface InitialWireState {
  wireId: WireId
  bothEndsMoving?: boolean      // True if both components selected (translation mode)
  originalWaypoints?: Point[]   // For translation mode
  xRatio: number                // Bend X as proportion from moving end to anchor
  anchorX, anchorY: number      // Fixed reference point
  isSourceEnd: boolean          // Which end is moving
  remainingWaypoints: Point[]   // Waypoints beyond the L-shape (stay fixed)
}
```
- When only one end moves: recalculates first 2 bends as L-shape, preserves rest
- When both ends move: translates all waypoints by same displacement

## ID Generation
Uses module-level counters cast to branded types:
```typescript
let nextComponentId = 1
let nextWireId = 1
let nextInputId = 2   // Starts at 2 (initial circuit uses ID 1)
let nextOutputId = 2  // Starts at 2 (initial circuit uses ID 1)
const id = nextComponentId++ as ComponentId
```
