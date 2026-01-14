# simulation/ - Circuit Simulation

Compiles circuits to netlists and evaluates boolean logic.

## Pipeline

1. **Compile** (`compiler.ts`): Circuit → Netlist
   - Groups wires into nets (one driver, many readers)
   - Creates compiled component representations
   - Runs topological sort and stores result in netlist
   - Validates circuit and stores any errors

2. **Evaluate** (`evaluator.ts`): Compute output values
   - Sets input net values from toggles
   - Walks topo order, evaluates each component
   - NAND: `!(A && B)`
   - NOR: `!(A || B)`
   - Custom components: evaluated recursively (hierarchical, not flattened)

## Files

### compiler.ts
`compile(circuit, customComponents?)` → `Netlist`

Creates nets from wires, maps component pins to net indices, runs topological sort, validates circuit.

Helper: `getComponentDefinition(type, customComponents?)` - returns width, height, pins for any component type (primitive or custom).

### topological.ts
`topologicalSort(components, nets)` → `TopoResult`

Returns evaluation order using Kahn's algorithm.
```typescript
interface TopoResult {
  order: number[]           // Component indices in evaluation order
  hasCycle: boolean         // True if cycle detected
  cycleComponents: ComponentId[]  // IDs of components in cycle
}
```

### evaluator.ts
`evaluate(netlist, inputValues, customComponents?, depth?)` → `Map<OutputId, boolean>`

Propagates values through the circuit. The `depth` parameter prevents infinite recursion in custom components.

### types.ts
```typescript
interface Netlist {
  nets: Net[]                    // Value-carrying wires
  components: CompiledComponent[] // Components with net references
  topoOrder: number[]            // Evaluation order (from topological sort)
  valid: boolean                 // False if cycle or other error
  errors: ValidationError[]      // Cycle info, floating pins, etc.
}

interface CompiledComponent {
  id: ComponentId
  type: ComponentType
  inputNetIds: NetId[]
  outputNetIds: NetId[]  // Array to support multiple outputs
}
```

## Usage
```typescript
const netlist = compile(circuit, customComponents)
if (!netlist.valid) {
  console.error(netlist.errors)
  return
}

const inputValues = new Map<InputId, boolean>()
// ... populate from circuit.inputs

const outputs = evaluate(netlist, inputValues, customComponents)
```
