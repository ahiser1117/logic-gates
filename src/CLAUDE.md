# src/ - Source Code

## Entry Points
- `main.tsx` - React app bootstrap
- `App.tsx` - Root component, renders Layout
- `index.css` - Global styles

## Directory Overview

### canvas/
Canvas-based rendering and interaction. All circuit visualization happens here via HTML5 Canvas, not React components.

### store/
Zustand store with Immer middleware. Single source of truth for all app state.

### simulation/
Circuit-to-netlist compilation and boolean evaluation. Runs on every input toggle. Supports recursive evaluation of custom components.

### types/
TypeScript interfaces and type definitions. Branded types for type-safe IDs.

### components/
React UI components - Layout shell and gate Palette sidebar.

### hooks/
Custom React hooks including `useSimulation` for circuit evaluation.

### utils/
Utility functions for custom component creation.
- `validation.ts` - validates circuits before saving as components
- `pinLayout.ts` - computes dimensions and pin positions for custom components:
  - Width: 60-120px based on name length, rounded to nearest 20px
  - Height: `max(inputs, outputs) * 20 + 20` (matches NAND behavior)
  - Pins distributed evenly within available height
- `componentDependencies.ts` - builds dependency trees for custom component dialogs

## Data Flow
1. User interacts with canvas (mouse events)
2. `hitTest()` determines what was clicked
3. Store actions update circuit/UI state
4. Wire paths recalculate when components/boards move (L-shape waypoint adjustment)
5. Canvas re-renders via `requestAnimationFrame` loop
6. Simulation recomputes on structural changes
