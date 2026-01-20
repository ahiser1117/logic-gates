# types/ - Type Definitions

## Files

### circuit.ts
Core circuit data model.

**Branded ID Types** (prevents mixing IDs):
```typescript
type ComponentId = number & { readonly __brand: 'ComponentId' }
type WireId = number & { readonly __brand: 'WireId' }
type InputId = number & { readonly __brand: 'InputId' }
type OutputId = number & { readonly __brand: 'OutputId' }
type CustomComponentId = string & { readonly __brand: 'CustomComponentId' }
```

**Component Types**:
```typescript
type PrimitiveGateType = 'NAND' | 'NOR' | 'SPLIT_MERGE'
type ComponentType = PrimitiveGateType | CustomComponentId
```
Split/Merge primitives use per-instance configuration (mode + partitions) stored on the component.
Use `isPrimitiveGate(type)` to check if a component type is primitive.

**Gate Definitions**:
```typescript
GATE_DEFINITIONS: Record<PrimitiveGateType, {
  width: number
  height: number
  pins: PinDefinition[]
}>
```
Pins have `offsetX/offsetY` relative to component center.

**Custom Component Definition**:
```typescript
interface CustomComponentDefinition {
  id: CustomComponentId
  name: string
  createdAt: number
  circuit: { inputs, outputs, components, wires, inputBoard, outputBoard }
  width, height, pins
}
```

**Key Types**:
- `Component` - gate instance with id, type, x, y, optional Split/Merge config (mode + partitions)
- `Wire` - connection with source, target, and optional `waypoints?: Point[]` for custom paths
- `Circuit` - full state including boards
- `BoardPosition` - x, y for draggable boards
- `Point` - simple `{ x: number, y: number }` for coordinates

**ID Creation Helpers** (for casting numbers/strings to branded types):
```typescript
createComponentId(n: number) → ComponentId
createWireId(n: number) → WireId
createInputId(n: number) → InputId
createOutputId(n: number) → OutputId
createCustomComponentId(uuid: string) → CustomComponentId
```

### ui.ts
UI state types.

- `Viewport` - panX, panY, zoom
- `DragState` - type (`none`, `component`, `palette`, `pan`, `marquee`, `wireHandle`) + coordinates + optional payload
- `PinRef` - union type for referencing any pin:
  ```typescript
  type PinRef =
    | { type: 'component'; componentId; pinIndex; pinType: 'input' | 'output' }
    | { type: 'input'; inputId }
    | { type: 'output'; outputId }
  ```
- `HoveredButton` - union type for board button hover states:
  ```typescript
  type HoveredButton =
    | 'input-add' | 'input-remove'
    | 'output-add' | 'output-remove'
    | { type: 'input-toggle'; inputId: InputId }
    | null
  ```
- `UIState` - full UI state shape
- `initialUIState` - default values

### index.ts
Re-exports everything for convenient imports:
```typescript
import type { Circuit, ComponentId } from '../types'
```

## Adding New Primitive Gate Types
1. Add to `PrimitiveGateType` union: `'NAND' | 'NOR' | 'NEW'`
2. Add to `GATE_DEFINITIONS` with dimensions and pins
3. Pin directions: `'input'` (left) or `'output'` (right)
4. For Split/Merge-like primitives, add a per-instance config type and update pin layout helpers
