import type {
  Circuit,
  Wire,
  WireId,
  WireSource,
  WireTarget,
  CustomComponentId,
  CustomComponentDefinition,
  Point,
} from '../types'
import { getComponentDefinition } from '../simulation'

// Constants
const GRID_STEP = 10 // Half of GRID_SIZE for smoother routing
const PIN_EXIT_DISTANCE = 20 // Distance to extend straight out from pins before routing
const BOARD_WIDTH = 100
const PIN_SPACING = 40
const PIN_START_Y = 40

// Re-export Point for backwards compatibility
export type { Point }

// Path cache - stores computed paths per wire
const pathCache = new Map<WireId, Point[]>()

export function clearPathCache() {
  pathCache.clear()
}

export function clearWirePath(wireId: WireId) {
  pathCache.delete(wireId)
}

// Clear paths for all wires connected to a specific component
export function clearPathsForComponent(componentId: number, circuit: Circuit) {
  for (const wire of circuit.wires) {
    if (
      (wire.source.type === 'component' && wire.source.componentId === componentId) ||
      (wire.target.type === 'component' && wire.target.componentId === componentId)
    ) {
      pathCache.delete(wire.id)
    }
  }
}

// Clear paths for all wires connected to input board
export function clearPathsForInputBoard(circuit: Circuit) {
  for (const wire of circuit.wires) {
    if (wire.source.type === 'input') {
      pathCache.delete(wire.id)
    }
  }
}

// Clear paths for all wires connected to output board
export function clearPathsForOutputBoard(circuit: Circuit) {
  for (const wire of circuit.wires) {
    if (wire.target.type === 'output') {
      pathCache.delete(wire.id)
    }
  }
}

/**
 * Get a wire's path, computing if not cached.
 */
export function computeWirePath(
  wire: Wire,
  circuit: Circuit,
  customComponents?: Map<CustomComponentId, CustomComponentDefinition>
): Point[] {
  // Check cache first
  const cached = pathCache.get(wire.id)
  if (cached) {
    return cached
  }

  // Compute path for this wire
  const path = computeSingleWirePath(wire, circuit, customComponents)
  pathCache.set(wire.id, path)
  return path
}

/**
 * Compute a single wire's path using L-shape routing.
 * If the wire has custom waypoints, use those instead of auto-routing.
 */
function computeSingleWirePath(
  wire: Wire,
  circuit: Circuit,
  customComponents: Map<CustomComponentId, CustomComponentDefinition> | undefined
): Point[] {
  // Get start and end points in world coordinates
  const start = getWireEndpointWorld(wire.source, circuit, customComponents)
  const end = getWireEndpointWorld(wire.target, circuit, customComponents)

  if (!start || !end) {
    return []
  }

  // If the wire has custom waypoints, use those
  if (wire.waypoints && wire.waypoints.length > 0) {
    // Waypoints include everything between (and including) the exit/entry points
    // We just need to add the actual pin positions at start and end
    return [start, ...wire.waypoints, end]
  }

  // Calculate exit/entry points - go straight out from pins
  const startExit = getExitPoint(start)
  const endEntry = getEntryPoint(end)

  // Create L-shape path
  const lShapePath = createLShapePath(startExit, endEntry)

  return simplifyPath([start, startExit, ...lShapePath.slice(1, -1), endEntry, end])
}

// Get the point where wire exits from a source pin (going right)
function getExitPoint(pinPos: Point): Point {
  return { x: pinPos.x + PIN_EXIT_DISTANCE, y: pinPos.y }
}

// Get the point where wire enters a target pin (coming from the left)
function getEntryPoint(pinPos: Point): Point {
  return { x: pinPos.x - PIN_EXIT_DISTANCE, y: pinPos.y }
}

export function computePreviewPath(
  start: Point,
  end: Point,
  _circuit: Circuit,
  _customComponents?: Map<CustomComponentId, CustomComponentDefinition>,
  isSourcePin: boolean = true
): Point[] {
  // Calculate exit point from start pin
  const startExit = isSourcePin
    ? { x: start.x + PIN_EXIT_DISTANCE, y: start.y }
    : { x: start.x - PIN_EXIT_DISTANCE, y: start.y }

  // Create L-shape path
  const lShapePath = createLShapePath(startExit, end)

  return simplifyPath([start, startExit, ...lShapePath.slice(1)])
}

function createLShapePath(start: Point, end: Point): Point[] {
  // Snap midX to grid for clean paths
  const midX = Math.round((start.x + end.x) / 2 / GRID_STEP) * GRID_STEP
  return [
    start,
    { x: midX, y: start.y },
    { x: midX, y: end.y },
    end,
  ]
}

function getWireEndpointWorld(
  endpoint: WireSource | WireTarget,
  circuit: Circuit,
  customComponents?: Map<CustomComponentId, CustomComponentDefinition>
): Point | null {
  if (endpoint.type === 'component') {
    const component = circuit.components.find((c) => c.id === endpoint.componentId)
    if (!component) return null

    const def = getComponentDefinition(component.type, customComponents)
    if (!def) return null

    const pin = def.pins.find((p) => p.index === endpoint.pinIndex)
    if (!pin) return null

    return {
      x: component.x + pin.offsetX,
      y: component.y + pin.offsetY,
    }
  } else if (endpoint.type === 'input') {
    const input = circuit.inputs.find((i) => i.id === endpoint.inputId)
    if (!input) return null

    const { x: boardX, y: boardY } = circuit.inputBoard
    return {
      x: boardX + BOARD_WIDTH / 2,
      y: boardY + PIN_START_Y + input.order * PIN_SPACING,
    }
  } else if (endpoint.type === 'output') {
    const output = circuit.outputs.find((o) => o.id === endpoint.outputId)
    if (!output) return null

    const { x: boardX, y: boardY } = circuit.outputBoard
    return {
      x: boardX - BOARD_WIDTH / 2,
      y: boardY + PIN_START_Y + output.order * PIN_SPACING,
    }
  }

  return null
}

function simplifyPath(path: Point[]): Point[] {
  if (path.length <= 2) return path

  const firstPoint = path[0]
  const lastPoint = path[path.length - 1]
  if (!firstPoint || !lastPoint) return path

  const simplified: Point[] = [firstPoint]

  for (let i = 1; i < path.length - 1; i++) {
    const prev = simplified[simplified.length - 1]
    const curr = path[i]
    const next = path[i + 1]

    if (!prev || !curr || !next) continue

    // Check if prev, curr, next are collinear
    const dx1 = curr.x - prev.x
    const dy1 = curr.y - prev.y
    const dx2 = next.x - curr.x
    const dy2 = next.y - curr.y

    // Not collinear if direction changes
    const sameDirection =
      (dx1 === 0 && dx2 === 0) || // Both vertical
      (dy1 === 0 && dy2 === 0) // Both horizontal

    if (!sameDirection) {
      simplified.push(curr)
    }
  }

  simplified.push(lastPoint)
  return simplified
}

// Export utilities for use in renderer and interactions
export { getWireEndpointWorld, getExitPoint, getEntryPoint, PIN_EXIT_DISTANCE, GRID_STEP }
