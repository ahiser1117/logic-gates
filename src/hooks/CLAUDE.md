# hooks/ - Custom React Hooks

## Files

### useSimulation.ts
Connects simulation engine to React lifecycle.

Watches for circuit changes and recomputes:
1. Compiles circuit to netlist
2. Topologically sorts gates
3. Evaluates boolean values
4. Returns simulation result with output values, wire values, and component pin values

Returns `SimulationResult`:
```typescript
{
  outputValues: Map<OutputId, boolean>      // Board output pin values
  wireValues: Map<WireId, boolean>          // Wire signal values
  componentPinValues: Map<ComponentId, Map<number, boolean>>  // All component pin values
}
```

The `componentPinValues` map allows rendering pin states even without connected wires.

### index.ts
Re-exports hooks for convenient imports.

## Notes
- Simulation runs synchronously (fast for small circuits)
- Returns empty map on compile error or cycle
- Could be optimized with Web Workers for large circuits
