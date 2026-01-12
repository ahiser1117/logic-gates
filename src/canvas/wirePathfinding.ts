import type {
  Circuit,
  Wire,
  WireId,
  WireSource,
  WireTarget,
  CustomComponentId,
  CustomComponentDefinition,
  ComponentId,
} from '../types'
import { getComponentDefinition } from '../simulation'

// Constants
const GRID_STEP = 10 // Half of GRID_SIZE for smoother routing
const OBSTACLE_PADDING = 15 // Padding around obstacles
const TURN_PENALTY = 5 // Extra cost for changing direction
const PIN_EXIT_DISTANCE = 20 // Distance to extend straight out from pins before pathfinding (2 half-grid units)
const BOARD_WIDTH = 100
const BOARD_HEADER_HEIGHT = 40
const PIN_SPACING = 40
const PIN_START_Y = 40

export interface Point {
  x: number
  y: number
}

interface Rectangle {
  x: number
  y: number
  width: number
  height: number
}

interface AStarNode {
  x: number
  y: number
  g: number // Cost from start
  f: number // g + heuristic
  parent: AStarNode | null
  direction: number | null // 0=right, 1=down, 2=left, 3=up, null=start
}

// Path cache - keyed only by wireId so paths persist after placement
const pathCache = new Map<WireId, Point[]>()

export function clearPathCache() {
  pathCache.clear()
}

export function clearWirePath(wireId: WireId) {
  pathCache.delete(wireId)
}

// Clear paths for all wires connected to a specific component
export function clearPathsForComponent(componentId: ComponentId, circuit: Circuit) {
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

export function computeWirePath(
  wire: Wire,
  circuit: Circuit,
  customComponents?: Map<CustomComponentId, CustomComponentDefinition>
): Point[] {
  // Check cache first - paths are computed once and stored permanently
  const cached = pathCache.get(wire.id)
  if (cached) return cached

  // Get start and end points in world coordinates
  const start = getWireEndpointWorld(wire.source, circuit, customComponents)
  const end = getWireEndpointWorld(wire.target, circuit, customComponents)

  if (!start || !end) {
    return []
  }

  // Calculate exit/entry points - go straight out from pins to clear obstacles
  const startExit = getExitPoint(wire.source, start)
  const endEntry = getEntryPoint(wire.target, end)

  // Get all obstacles (including connected components - wire must not pass through them)
  const obstacles = getAllObstacles(circuit, customComponents)

  // Try simple L-shape between exit and entry points first
  const lShapePath = createLShapePath(startExit, endEntry)
  const lShapeBlocked = doesPathIntersectObstacles(lShapePath, obstacles, startExit, endEntry)

  let middlePath: Point[]
  if (!lShapeBlocked) {
    middlePath = lShapePath
  } else {
    // L-shape blocked, use A* pathfinding between exit and entry points
    middlePath = aStarPathfind(startExit, endEntry, obstacles)
  }

  // Combine: start -> startExit -> middlePath -> endEntry -> end
  // Remove duplicates at connection points
  const path: Point[] = [start]

  if (startExit.x !== start.x || startExit.y !== start.y) {
    path.push(startExit)
  }

  // Add middle path (skip first point if it matches startExit)
  for (let i = 0; i < middlePath.length; i++) {
    const pt = middlePath[i]
    if (!pt) continue
    const lastPt = path[path.length - 1]
    if (lastPt && (pt.x !== lastPt.x || pt.y !== lastPt.y)) {
      path.push(pt)
    }
  }

  // Add end entry and end point
  const lastPt = path[path.length - 1]
  if (lastPt && (endEntry.x !== lastPt.x || endEntry.y !== lastPt.y)) {
    path.push(endEntry)
  }
  if (end.x !== endEntry.x || end.y !== endEntry.y) {
    path.push(end)
  }

  // Simplify to remove collinear points
  const simplifiedPath = simplifyPath(path)

  // Cache the result
  pathCache.set(wire.id, simplifiedPath)

  return simplifiedPath
}

// Get the point where wire exits from a source pin (going right for outputs)
function getExitPoint(_source: WireSource, pinPos: Point): Point {
  // Sources are either component output pins or input board pins
  // Both exit to the right (+x direction)
  return { x: pinPos.x + PIN_EXIT_DISTANCE, y: pinPos.y }
}

// Get the point where wire enters a target pin (coming from the left for inputs)
function getEntryPoint(_target: WireTarget, pinPos: Point): Point {
  // Targets are either component input pins or output board pins
  // Both enter from the left (-x direction)
  return { x: pinPos.x - PIN_EXIT_DISTANCE, y: pinPos.y }
}

export function computePreviewPath(
  start: Point,
  end: Point,
  circuit: Circuit,
  customComponents?: Map<CustomComponentId, CustomComponentDefinition>,
  isSourcePin: boolean = true // true if start is a source (output) pin, false if it's a target (input) pin
): Point[] {
  // Calculate exit point from start pin
  // If starting from a source pin (output), exit to the right
  // If starting from a target pin (input), exit to the left
  const startExit = isSourcePin
    ? { x: start.x + PIN_EXIT_DISTANCE, y: start.y }
    : { x: start.x - PIN_EXIT_DISTANCE, y: start.y }

  // Get all obstacles
  const obstacles = getAllObstacles(circuit, customComponents)

  // Try simple L-shape from exit to end
  const lShapePath = createLShapePath(startExit, end)
  const lShapeBlocked = doesPathIntersectObstacles(lShapePath, obstacles, startExit, end)

  let middlePath: Point[]
  if (!lShapeBlocked) {
    middlePath = lShapePath
  } else {
    middlePath = aStarPathfind(startExit, end, obstacles)
  }

  // Combine: start -> startExit -> middlePath -> end
  const path: Point[] = [start, startExit]

  for (let i = 0; i < middlePath.length; i++) {
    const pt = middlePath[i]
    if (!pt) continue
    const lastPt = path[path.length - 1]
    if (lastPt && (pt.x !== lastPt.x || pt.y !== lastPt.y)) {
      path.push(pt)
    }
  }

  return simplifyPath(path)
}

function createLShapePath(start: Point, end: Point): Point[] {
  const midX = (start.x + end.x) / 2
  return [
    start,
    { x: midX, y: start.y },
    { x: midX, y: end.y },
    end,
  ]
}

function doesPathIntersectObstacles(
  path: Point[],
  obstacles: Rectangle[],
  _start: Point,
  _end: Point
): boolean {
  for (let i = 0; i < path.length - 1; i++) {
    const p1 = path[i]
    const p2 = path[i + 1]
    if (!p1 || !p2) continue

    // First segment starts at the source pin, last segment ends at target pin
    // These are allowed to touch the component at the pin
    const isFirstSegment = (i === 0)
    const isLastSegment = (i === path.length - 2)

    if (doesSegmentIntersectObstacles(p1.x, p1.y, p2.x, p2.y, obstacles, isFirstSegment, isLastSegment)) {
      return true
    }
  }
  return false
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

function getAllObstacles(
  circuit: Circuit,
  customComponents?: Map<CustomComponentId, CustomComponentDefinition>
): Rectangle[] {
  const obstacles: Rectangle[] = []

  // Add all component obstacles
  for (const component of circuit.components) {
    const def = getComponentDefinition(component.type, customComponents)
    if (!def) continue

    obstacles.push({
      x: component.x - def.width / 2 - OBSTACLE_PADDING,
      y: component.y - def.height / 2 - OBSTACLE_PADDING,
      width: def.width + OBSTACLE_PADDING * 2,
      height: def.height + OBSTACLE_PADDING * 2,
    })
  }

  // Add input board obstacle
  const inputCount = circuit.inputs.length
  const inputPinsHeight = Math.max(0, inputCount * PIN_SPACING)
  const inputBoardHeight = BOARD_HEADER_HEIGHT + inputPinsHeight

  obstacles.push({
    x: circuit.inputBoard.x - BOARD_WIDTH / 2 - OBSTACLE_PADDING,
    y: circuit.inputBoard.y - BOARD_HEADER_HEIGHT / 2 - OBSTACLE_PADDING,
    width: BOARD_WIDTH + OBSTACLE_PADDING * 2,
    height: inputBoardHeight + OBSTACLE_PADDING * 2,
  })

  // Add output board obstacle
  const outputCount = circuit.outputs.length
  const outputPinsHeight = Math.max(0, outputCount * PIN_SPACING)
  const outputBoardHeight = BOARD_HEADER_HEIGHT + outputPinsHeight

  obstacles.push({
    x: circuit.outputBoard.x - BOARD_WIDTH / 2 - OBSTACLE_PADDING,
    y: circuit.outputBoard.y - BOARD_HEADER_HEIGHT / 2 - OBSTACLE_PADDING,
    width: BOARD_WIDTH + OBSTACLE_PADDING * 2,
    height: outputBoardHeight + OBSTACLE_PADDING * 2,
  })

  return obstacles
}

function aStarPathfind(start: Point, end: Point, obstacles: Rectangle[]): Point[] {
  // Snap start and end to grid for pathfinding, but keep original for final path
  const startGrid = { x: Math.round(start.x / GRID_STEP) * GRID_STEP, y: Math.round(start.y / GRID_STEP) * GRID_STEP }
  const endGrid = { x: Math.round(end.x / GRID_STEP) * GRID_STEP, y: Math.round(end.y / GRID_STEP) * GRID_STEP }

  // If start equals end, return direct path
  if (startGrid.x === endGrid.x && startGrid.y === endGrid.y) {
    return [start, end]
  }

  // Direction vectors: right, down, left, up
  const dx = [GRID_STEP, 0, -GRID_STEP, 0]
  const dy = [0, GRID_STEP, 0, -GRID_STEP]

  const openSet: AStarNode[] = []
  const closedSet = new Set<string>()

  const startNode: AStarNode = {
    x: startGrid.x,
    y: startGrid.y,
    g: 0,
    f: manhattan(startGrid, endGrid),
    parent: null,
    direction: null,
  }

  openSet.push(startNode)

  // Limit iterations to prevent infinite loops
  const maxIterations = 10000
  let iterations = 0

  while (openSet.length > 0 && iterations < maxIterations) {
    iterations++

    // Find node with lowest f score
    let lowestIdx = 0
    for (let i = 1; i < openSet.length; i++) {
      const node = openSet[i]
      const lowestNode = openSet[lowestIdx]
      if (node && lowestNode && node.f < lowestNode.f) {
        lowestIdx = i
      }
    }

    const current = openSet.splice(lowestIdx, 1)[0]
    if (!current) break

    const currentKey = `${current.x},${current.y}`

    // Check if we reached the goal
    if (current.x === endGrid.x && current.y === endGrid.y) {
      return reconstructPath(current, start, end)
    }

    closedSet.add(currentKey)

    // Explore neighbors
    for (let dir = 0; dir < 4; dir++) {
      const dxDir = dx[dir]
      const dyDir = dy[dir]
      if (dxDir === undefined || dyDir === undefined) continue

      const nx = current.x + dxDir
      const ny = current.y + dyDir
      const neighborKey = `${nx},${ny}`

      if (closedSet.has(neighborKey)) continue

      const isEndPoint = nx === endGrid.x && ny === endGrid.y

      // Check if neighbor is inside an obstacle (allow if it's the end point - it's at a pin)
      if (!isEndPoint && isPointInObstacles(nx, ny, obstacles)) continue

      // Check if the path to neighbor crosses an obstacle
      // Allow segment to end point (it's going to the pin)
      if (doesSegmentIntersectObstacles(current.x, current.y, nx, ny, obstacles, false, isEndPoint)) continue

      // Calculate cost
      let moveCost = GRID_STEP
      if (current.direction !== null && current.direction !== dir) {
        moveCost += TURN_PENALTY // Turn penalty
      }

      const tentativeG = current.g + moveCost

      // Check if this node is already in open set
      const existingIdx = openSet.findIndex((n) => n.x === nx && n.y === ny)
      if (existingIdx !== -1) {
        const existing = openSet[existingIdx]
        if (existing && tentativeG < existing.g) {
          existing.g = tentativeG
          existing.f = tentativeG + manhattan({ x: nx, y: ny }, endGrid)
          existing.parent = current
          existing.direction = dir
        }
      } else {
        openSet.push({
          x: nx,
          y: ny,
          g: tentativeG,
          f: tentativeG + manhattan({ x: nx, y: ny }, endGrid),
          parent: current,
          direction: dir,
        })
      }
    }
  }

  // No path found - fall back to simple L-shape
  return fallbackPath(start, end)
}

function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

function isPointInObstacles(x: number, y: number, obstacles: Rectangle[]): boolean {
  for (const obs of obstacles) {
    if (x >= obs.x && x <= obs.x + obs.width && y >= obs.y && y <= obs.y + obs.height) {
      return true
    }
  }
  return false
}

function doesSegmentIntersectObstacles(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  obstacles: Rectangle[],
  isFirstSegment: boolean = false,
  isLastSegment: boolean = false
): boolean {
  for (const obs of obstacles) {
    if (segmentIntersectsRect(x1, y1, x2, y2, obs, isFirstSegment, isLastSegment)) {
      return true
    }
  }
  return false
}

function segmentIntersectsRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rect: Rectangle,
  isFirstSegment: boolean = false,
  isLastSegment: boolean = false
): boolean {
  const rectLeft = rect.x
  const rectRight = rect.x + rect.width
  const rectTop = rect.y
  const rectBottom = rect.y + rect.height

  // Check if segment endpoints are inside rect
  const inside1 = x1 >= rectLeft && x1 <= rectRight && y1 >= rectTop && y1 <= rectBottom
  const inside2 = x2 >= rectLeft && x2 <= rectRight && y2 >= rectTop && y2 <= rectBottom

  // For first segment, p1 (start pin) can be inside - but p2 cannot
  // For last segment, p2 (end pin) can be inside - but p1 cannot
  // For middle segments, neither can be inside
  if (inside1 && !isFirstSegment) return true
  if (inside2 && !isLastSegment) return true

  // Now check if the segment passes through the rectangle
  // (even if neither endpoint is inside)
  if (x1 === x2) {
    // Vertical segment
    if (x1 < rectLeft || x1 > rectRight) return false
    const minY = Math.min(y1, y2)
    const maxY = Math.max(y1, y2)
    // Check if segment spans across the rectangle
    if (minY < rectTop && maxY > rectBottom) return true
    if (minY < rectBottom && maxY > rectTop) {
      // Segment overlaps with rect vertically
      // This is only OK if it's just the allowed endpoint touching
      if (isFirstSegment && inside1) return false // p1 touching is OK
      if (isLastSegment && inside2) return false // p2 touching is OK
      return true
    }
  } else if (y1 === y2) {
    // Horizontal segment
    if (y1 < rectTop || y1 > rectBottom) return false
    const minX = Math.min(x1, x2)
    const maxX = Math.max(x1, x2)
    // Check if segment spans across the rectangle
    if (minX < rectLeft && maxX > rectRight) return true
    if (minX < rectRight && maxX > rectLeft) {
      // Segment overlaps with rect horizontally
      if (isFirstSegment && inside1) return false
      if (isLastSegment && inside2) return false
      return true
    }
  }

  return false
}

function reconstructPath(endNode: AStarNode, originalStart: Point, originalEnd: Point): Point[] {
  const rawPath: Point[] = []
  let current: AStarNode | null = endNode

  while (current) {
    rawPath.unshift({ x: current.x, y: current.y })
    current = current.parent
  }

  // Replace first and last with original coordinates
  if (rawPath.length > 0) {
    rawPath[0] = originalStart
    rawPath[rawPath.length - 1] = originalEnd
  }

  // Simplify path by removing collinear points
  return simplifyPath(rawPath)
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

function fallbackPath(start: Point, end: Point): Point[] {
  // Simple L-shaped fallback
  const midX = (start.x + end.x) / 2
  return [
    start,
    { x: midX, y: start.y },
    { x: midX, y: end.y },
    end,
  ]
}

// Export getWireEndpointWorld for use in renderer
export { getWireEndpointWorld }
