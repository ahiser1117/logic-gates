# Logic Gate Simulator

A web-based digital logic circuit designer and simulator built with React, TypeScript, and HTML5 Canvas.

## Tech Stack
- **Framework**: React 18 + TypeScript
- **Build**: Vite
- **State**: Zustand with Immer (`enableMapSet()` required for Set support)
- **Rendering**: HTML5 Canvas (not React components for circuit elements)

## Project Structure
```
src/
├── canvas/       # Canvas rendering, hit testing, interactions
├── store/        # Zustand store (circuit + UI state)
├── simulation/   # Circuit compilation and evaluation
├── types/        # TypeScript type definitions
├── components/   # React UI components (Layout, Palette)
├── hooks/        # Custom React hooks
└── utils/        # Utility functions (validation, pin layout)
```

## Key Concepts

### Circuit Model
- **Components**: NAND/NOR gates and custom components placed on canvas
- **Wires**: Connect component pins or board pins (support custom waypoints for path editing)
- **Input Board**: Draggable board with toggle switches (left side)
- **Output Board**: Draggable board showing computed values (right side)
- **Custom Components**: User-created reusable components saved to localStorage

### Wire Path Editing
- Select a wire to see segment handles at midpoints
- Drag handles to create custom L-shaped paths
- Dragging components recalculates connected wire L-shapes automatically
- See `canvas/wirePathfinding.ts` for routing logic

### Coordinate Systems
- **World coordinates**: Logical positions (circuit.components[].x/y)
- **Screen coordinates**: Pixel positions after viewport transform
- Use `worldToScreen()` / `screenToWorld()` from `canvas/grid.ts`

### State Architecture
- Single Zustand store at `store/index.ts`
- Circuit state: components, wires, inputs, outputs, board positions
- UI state: viewport, selection, drag state, wiring state

## Common Tasks

### Adding a new primitive gate type
1. Add type to `PrimitiveGateType` union in `types/circuit.ts`
2. Add definition to `GATE_DEFINITIONS` with width, height, pins
3. Gate will auto-appear in Palette

### Creating custom components
1. Build circuit with input/output board pins connected
2. Click "Create Component" in Palette
3. Custom components are saved to localStorage and persist across sessions

### Modifying hit testing
- Edit `canvas/hitTest.ts`
- Constants must match `renderer.ts` (PIN_SPACING, BOARD_WIDTH, etc.)

### Modifying rendering
- Edit `canvas/renderer.ts`
- Board positions come from `circuit.inputBoard` / `circuit.outputBoard`

## Running
```bash
npm install
npm run dev   # Dev server at localhost:5173
npm run build # Production build
```
