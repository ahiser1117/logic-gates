# hooks/ - Custom React Hooks

## Files

### useSimulation.ts
Connects simulation engine to React lifecycle.

Watches for circuit changes and recomputes:
1. Compiles circuit to netlist
2. Topologically sorts gates
3. Evaluates boolean values
4. Returns output values map

Usage:
```typescript
const outputs = useSimulation(circuit)
// outputs: Map<OutputId, boolean>
```

### index.ts
Re-exports hooks for convenient imports.

## Notes
- Simulation runs synchronously (fast for small circuits)
- Returns empty map on compile error or cycle
- Could be optimized with Web Workers for large circuits
