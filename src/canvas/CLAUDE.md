# canvas/ - Canvas Rendering & Interaction

All circuit visualization and mouse interaction happens here.

## Files

### CanvasWorkspace.tsx
Main React component wrapping the canvas element. Handles:
- Mouse events (down/move/up/wheel)
- Drag-and-drop from palette
- Keyboard shortcuts (Delete, Escape)
- Viewport centering on init
- Marquee selection (drag on empty space to select multiple components)
- Double-click on board pin labels to edit them
- Label edit textbox scales with zoom and tracks world position

Key refs:
- `dragStartPositions` - tracks component positions during drag
- `boardDragStart` - tracks board position during board drag

### renderer.ts
Pure drawing functions. Called every frame via `requestAnimationFrame`.

Key functions:
- `renderFrame()` - main entry, draws everything
- `drawComponent()` - gate body, label, pins (receives simulation data for pin activation)
- `drawWire()` - L-shaped wire routing
- `drawInputBoard()` / `drawOutputBoard()` - board with header buttons, supports hover states

Layout constants (must match hitTest.ts):
- `BOARD_WIDTH = 100`
- `BOARD_HEADER_HEIGHT = 40`
- `PIN_SPACING = 40`
- `PIN_START_Y = 40`

Pin styling:
- All pins use uniform blue color (`boardPin`), turn green when active
- Pins are 8px radius (10px when hovered) with hover ring
- Board pins positioned at board edges (±BOARD_WIDTH/2)
- Component pins show activation state based on connected wire values

Button hover colors defined in `COLORS` object (e.g., `addButtonHover`, `removeButtonHover`, `toggleOnHover`).

### hitTest.ts
Determines what the user clicked. Returns `HitResult` with type and IDs.

Hit types: `none`, `component`, `pin`, `wire`, `input-board`, `output-board`, `input-add-button`, `input-remove-button`, `output-add-button`, `output-remove-button`, `input-toggle`, `input-label`, `output-label`

**Important**: Board button hitboxes use fixed world coordinates (not scaled by zoom) to match their visual size at any zoom level.

### grid.ts
Coordinate transforms and grid drawing.
- `worldToScreen(x, y, viewport)` - world to screen coords
- `screenToWorld(x, y, viewport)` - screen to world coords
- `snapToGrid(value, gridSize)` - snap to grid
- `drawGrid()` - background grid with minor lines every `GRID_SIZE` (20) and major lines every 5th line

Grid uses integer grid indices (not floating-point modulo) to reliably detect major lines.

## Coordinate System
- World coords: logical circuit positions
- Screen coords: CSS pixels on canvas
- Viewport: `{ panX, panY, zoom }` - transforms world to screen

The canvas uses `devicePixelRatio` for sharp rendering but mouse events use CSS pixels.
