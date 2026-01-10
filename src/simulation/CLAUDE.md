# simulation/ - Circuit Simulation

Compiles circuits to netlists and evaluates boolean logic.

## Pipeline

1. **Compile** (`compiler.ts`): Circuit → Netlist
   - Groups wires into nets (one driver, many readers)
   - Creates compiled gate representations

2. **Topological Sort** (`topological.ts`): Order gates for evaluation
   - Kahn's algorithm
   - Detects cycles (returns null if cycle found)

3. **Evaluate** (`evaluator.ts`): Compute output values
   - Sets input net values from toggles
   - Walks topo order, evaluates each gate
   - NAND: `!(A && B)`
   - NOR: `!(A || B)`
   - Custom components: evaluated recursively (hierarchical, not flattened)

## Files

### compiler.ts
`compile(circuit, customComponents?)` → `Netlist`

Creates nets from wires, maps component pins to net indices.

Helper: `getComponentDefinition(type, customComponents?)` - returns width, height, pins for any component type (primitive or custom).

### topological.ts
`topologicalSort(netlist)` → `number[] | null`

Returns gate evaluation order, or null if cycle detected.

### evaluator.ts
`evaluateCircuit(circuit, netlist, order)` → `Map<OutputId, boolean>`

Propagates values through the circuit.

### types.ts
```typescript
interface Netlist {
  nets: Net[]           // Value-carrying wires
  gates: CompiledGate[] // Gates with net references
  inputNets: Map<InputId, number>
  outputNets: Map<OutputId, number>
}
```

## Usage
```typescript
const netlist = compileCircuit(circuit)
if (!netlist) return // compilation error

const order = topologicalSort(netlist)
if (!order) return // cycle detected

const outputs = evaluateCircuit(circuit, netlist, order)
```
