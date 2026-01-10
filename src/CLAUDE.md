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
- `pinLayout.ts` - computes pin positions for custom component rendering

## Data Flow
1. User interacts with canvas (mouse events)
2. `hitTest()` determines what was clicked
3. Store actions update circuit/UI state
4. Canvas re-renders via `requestAnimationFrame` loop
5. Simulation recomputes on structural changes
