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
- `wireHandleDragStart` - tracks wire handle drag (wireId, handleIndex, originalPath)

Wire path editing:
- Dragging segment handles creates L-shaped connectors to maintain pin connections
- Path simplification removes collinear points on drag end (components, boards, or handles)

### renderer.ts
Pure drawing functions. Called every frame via `requestAnimationFrame`.

Key functions:
- `renderFrame()` - main entry, draws everything in order: grid → board backgrounds → wires → board pins → components → marquee
- `drawComponent()` - gate body, label, pins (receives simulation data for pin activation)
- `drawWire()` - draws wire with border effect (darker outline + main color), thickness scales with zoom
- `drawWiringPreview()` - live preview during wire creation with dashed line
- `drawInputBoard()` / `drawOutputBoard()` - board with header buttons, supports `pinsOnly` param for layered rendering

Render order ensures wires appear behind board pins but in front of board backgrounds.

Wire styling:
- Border (5px) + main line (3px), scales with zoom for constant world size
- Colors: off (gray), on (green), selected (orange) with darker border variants

### wirePathfinding.ts
Wire routing with optional custom waypoints.

Key functions:
- `computeWirePath(wire, circuit, customComponents)` - returns path points for a wire (uses custom waypoints if present, otherwise auto L-shape)
- `computePreviewPath(start, end, circuit, customComponents, isSourcePin)` - for live preview
- `getWireEndpointWorld(endpoint, circuit, customComponents)` - get world position of wire source/target
- `clearPathCache()` / `clearWirePath(wireId)` - cache management
- `clearPathsForComponent(componentId, circuit)` - invalidate on component move
- `clearPathsForInputBoard(circuit)` / `clearPathsForOutputBoard(circuit)` - invalidate on board move

Algorithm:
- If `wire.waypoints` exists: use custom waypoints with pin entry/exit segments
- Otherwise: L-shaped path (horizontal from source → vertical at midpoint → horizontal to target)
- Wires exit straight from source pins (20 units right) and enter straight to target pins (20 units left)
- Paths cached by wireId, invalidated when connected components/boards move
- `GRID_STEP = 10` exported for half-grid snapping

Layout constants (must match hitTest.ts):
- `BOARD_WIDTH = 100`
- `BOARD_HEADER_HEIGHT = 40`
- `PIN_SPACING = 40`
- `PIN_START_Y = 40`

Pin styling:
- All pins use uniform blue color (`boardPin`), turn green when active
- Pins are 8px radius with white outline on hover (no size change)
- Board pins positioned at board edges (±BOARD_WIDTH/2)
- Component pins show activation state from simulation (works even without wires)

Custom component labels:
- Text wraps if too long for component width
- Width accounts for pin radii (8px each side) plus padding

Button hover colors defined in `COLORS` object (e.g., `addButtonHover`, `removeButtonHover`, `toggleOnHover`).

### hitTest.ts
Determines what the user clicked. Returns `HitResult` with type and IDs.

Hit types: `none`, `component`, `pin`, `wire`, `wireHandle`, `input-board`, `output-board`, `input-add-button`, `input-remove-button`, `output-add-button`, `output-remove-button`, `input-toggle`, `input-label`, `output-label`

Wire handle hit testing:
- `wireHandle` type includes `wireId` and `handleIndex` (segment index)
- Handles are capsule-shaped (16x8 world units) at segment midpoints
- Only tested for selected wires

**Important**: Board button hitboxes use fixed world coordinates (not scaled by zoom) to match their visual size at any zoom level.

### grid.ts
Coordinate transforms and grid drawing.
- `worldToScreen(x, y, viewport)` - world to screen coords
- `screenToWorld(x, y, viewport)` - screen to world coords
- `snapToGrid(value, gridSize)` - snap to grid
- `drawGrid()` - background grid with minor lines every `GRID_SIZE` (20) and major lines every 6th line (120px)

Grid uses integer grid indices (not floating-point modulo) to reliably detect major lines.

## Coordinate System
- World coords: logical circuit positions
- Screen coords: CSS pixels on canvas
- Viewport: `{ panX, panY, zoom }` - transforms world to screen

The canvas uses `devicePixelRatio` for sharp rendering but mouse events use CSS pixels.
