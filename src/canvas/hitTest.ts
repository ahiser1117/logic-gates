import type { Circuit, ComponentId, WireId, InputId, OutputId, CustomComponentId, CustomComponentDefinition, Point } from '../types'
import type { Viewport } from '../types'
import { screenToWorld } from './grid'
import { getComponentDefinition } from '../simulation'
import { computeWirePath } from './wirePathfinding'
import {
  getInputBoardWidth,
  getOutputBoardWidth,
  BOARD_HEADER_HEIGHT,
  PIN_SPACING,
  PIN_START_Y,
  HEADER_BUTTON_OFFSET,
  BASE_BOARD_WIDTH,
  getMultiRowDisplayHeight,
} from './boardLayout'

const PIN_HIT_RADIUS = 12
const WIRE_HIT_RADIUS = 6
const BUTTON_RADIUS = 10
const TOGGLE_RADIUS = 10
export const HANDLE_SIZE = { width: 16, height: 8 } // Capsule dimensions in world units

// Minimum width for value display elements
const MIN_VALUE_DISPLAY_WIDTH = 28
const PIXELS_PER_BIT = 7
const VALUE_DISPLAY_PADDING = 12
const BITS_PER_ROW = 8

// Calculate value display width based on bit width (capped at BITS_PER_ROW for multi-row)
function getValueDisplayWidth(bitWidth: number): number {
  if (bitWidth <= 4) return MIN_VALUE_DISPLAY_WIDTH
  // Cap at BITS_PER_ROW for multi-row display
  const effectiveBits = Math.min(bitWidth, BITS_PER_ROW)
  return effectiveBits * PIXELS_PER_BIT + VALUE_DISPLAY_PADDING
}

export interface HitResult {
  type:
    | 'none'
    | 'component'
    | 'pin'
    | 'wire'
    | 'wireHandle'
    | 'input-board'
    | 'output-board'
    | 'input-add-button'
    | 'input-remove-button'
    | 'output-add-button'
    | 'output-remove-button'
    | 'input-toggle'
    | 'input-label'
    | 'output-label'
  componentId?: ComponentId
  wireId?: WireId
  pinIndex?: number
  pinType?: 'input' | 'output' | 'input-board' | 'output-board'
  inputId?: InputId
  outputId?: OutputId
  handleIndex?: number  // Which segment's handle (0 = first segment)
}

export function hitTest(
  screenX: number,
  screenY: number,
  circuit: Circuit,
  viewport: Viewport,
  customComponents?: Map<CustomComponentId, CustomComponentDefinition>,
  selectedWires?: Set<WireId>
): HitResult {
  const world = screenToWorld(screenX, screenY, viewport)
  const scale = viewport.zoom

  // Check wire handles first (only for selected wires)
  if (selectedWires && selectedWires.size > 0) {
    const handleResult = hitTestWireHandles(world.x, world.y, circuit, scale, selectedWires, customComponents)
    if (handleResult.type !== 'none') return handleResult
  }

  // Check input board elements (left side)
  const inputResult = hitTestInputBoard(world.x, world.y, circuit, scale)
  if (inputResult.type !== 'none') return inputResult

  // Check output board elements (right side)
  const outputResult = hitTestOutputBoard(world.x, world.y, circuit, scale)
  if (outputResult.type !== 'none') return outputResult

  // Check components - use distance-based approach for pin vs body
  for (const component of circuit.components) {
    const def = getComponentDefinition(component.type, customComponents)
    if (!def) continue

    const halfW = def.width / 2
    const halfH = def.height / 2

    // First check if we're within component bounds at all
    const inBounds =
      world.x >= component.x - halfW - PIN_HIT_RADIUS &&
      world.x <= component.x + halfW + PIN_HIT_RADIUS &&
      world.y >= component.y - halfH - PIN_HIT_RADIUS &&
      world.y <= component.y + halfH + PIN_HIT_RADIUS

    if (!inBounds) continue

    // Find the closest pin and its distance
    let closestPinDist = Infinity
    let closestPinIndex = -1
    let closestPinDirection: 'input' | 'output' = 'input'

    for (const pin of def.pins) {
      const pinX = component.x + pin.offsetX
      const pinY = component.y + pin.offsetY
      const dist = distance(world.x, world.y, pinX, pinY)
      if (dist < closestPinDist) {
        closestPinDist = dist
        closestPinIndex = pin.index
        closestPinDirection = pin.direction
      }
    }

    // If very close to a pin (within PIN_HIT_RADIUS in screen pixels), it's a pin hit
    const pinHitThreshold = PIN_HIT_RADIUS / scale
    if (closestPinDist < pinHitThreshold) {
      return {
        type: 'pin',
        componentId: component.id,
        pinIndex: closestPinIndex,
        pinType: closestPinDirection,
      }
    }

    // Otherwise, if within component bounds, it's a component hit
    if (
      world.x >= component.x - halfW &&
      world.x <= component.x + halfW &&
      world.y >= component.y - halfH &&
      world.y <= component.y + halfH
    ) {
      return {
        type: 'component',
        componentId: component.id,
      }
    }
  }

  // Check wires
  for (const wire of circuit.wires) {
    // Get the computed path for this wire
    const path = computeWirePath(wire, circuit, customComponents)
    if (path.length < 2) continue

    // Check distance to each segment in the path
    for (let i = 0; i < path.length - 1; i++) {
      const p1 = path[i]
      const p2 = path[i + 1]
      if (!p1 || !p2) continue
      if (distanceToSegment(world.x, world.y, p1.x, p1.y, p2.x, p2.y) < WIRE_HIT_RADIUS / scale) {
        return { type: 'wire', wireId: wire.id }
      }
    }
  }

  return { type: 'none' }
}

function hitTestInputBoard(worldX: number, worldY: number, circuit: Circuit, scale: number): HitResult {
  const { x: boardX, y: boardY } = circuit.inputBoard
  const inputCount = circuit.inputs.length

  // Calculate dynamic board width
  const boardWidth = getInputBoardWidth(circuit)
  const halfWidth = boardWidth / 2

  // Input board expands to the LEFT (pins on right stay fixed)
  // Visual center shifts left as width increases
  const widthDelta = boardWidth - BASE_BOARD_WIDTH
  const visualCenterX = boardX - widthDelta / 2

  // Pin X stays fixed at boardX + BASE_BOARD_WIDTH/2
  const pinX = boardX + BASE_BOARD_WIDTH / 2

  // Calculate board bounds based on visual center
  const pinsHeight = Math.max(0, inputCount * PIN_SPACING)
  const boardTop = boardY - BOARD_HEADER_HEIGHT / 2
  const boardBottom = boardY + BOARD_HEADER_HEIGHT / 2 + pinsHeight
  const boardLeft = visualCenterX - halfWidth
  const boardRight = visualCenterX + halfWidth

  // Check if within board area at all
  const inBoardArea =
    worldX >= boardLeft - 10 &&
    worldX <= boardRight + 10 &&
    worldY >= boardTop - 10 &&
    worldY <= boardBottom + 10

  if (!inBoardArea) return { type: 'none' }

  // Check header buttons first (fixed offset from visual center)
  // "-" button (left of label)
  const minusBtnX = visualCenterX - HEADER_BUTTON_OFFSET
  if (distance(worldX, worldY, minusBtnX, boardY) < BUTTON_RADIUS) {
    return { type: 'input-remove-button' }
  }

  // "+" button (right of label)
  const plusBtnX = visualCenterX + HEADER_BUTTON_OFFSET
  if (distance(worldX, worldY, plusBtnX, boardY) < BUTTON_RADIUS) {
    return { type: 'input-add-button' }
  }

  // Check each input pin
  // Pin fixed on right, label fixed size relative to pin, toggle anchored to left of label
  for (const input of circuit.inputs) {
    const pinY = boardY + PIN_START_Y + input.order * PIN_SPACING
    const bitWidth = input.bitWidth ?? 1
    const isMultiBit = bitWidth > 1

    // Label box: fixed size, fixed position relative to pin
    const labelBoxWidth = 52
    const labelBoxHeight = 14
    const labelBoxEndX = pinX - 18  // Fixed gap before pin
    const labelBoxX = labelBoxEndX - labelBoxWidth

    // Toggle: right edge anchored at fixed offset from label left
    const toggleRightEdge = labelBoxX - 6

    if (isMultiBit) {
      // Multi-bit: rectangular display area (slightly larger hit area for easier clicking)
      const displayWidth = getValueDisplayWidth(bitWidth) + 4  // Extra padding for hit area
      const displayHeight = getMultiRowDisplayHeight(bitWidth) + 4  // Use multi-row height + padding for hit area
      // Right edge fixed, expands left
      if (
        worldX >= toggleRightEdge - displayWidth &&
        worldX <= toggleRightEdge &&
        worldY >= pinY - displayHeight / 2 &&
        worldY <= pinY + displayHeight / 2
      ) {
        return { type: 'input-toggle', inputId: input.id }
      }
    } else {
      // Single-bit: circular toggle, right edge at toggleRightEdge
      const toggleX = toggleRightEdge - TOGGLE_RADIUS
      if (distance(worldX, worldY, toggleX, pinY) < TOGGLE_RADIUS) {
        return { type: 'input-toggle', inputId: input.id }
      }
    }

    // Check pin (right side, for wiring) - at fixed position
    if (distance(worldX, worldY, pinX, pinY) < PIN_HIT_RADIUS / scale) {
      return { type: 'pin', pinType: 'input-board', inputId: input.id }
    }

    // Check label area (between toggle and pin)
    if (
      worldX >= labelBoxX &&
      worldX <= labelBoxX + labelBoxWidth &&
      worldY >= pinY - labelBoxHeight / 2 &&
      worldY <= pinY + labelBoxHeight / 2
    ) {
      return { type: 'input-label', inputId: input.id }
    }
  }

  // If within board bounds but didn't hit anything specific, it's a board drag
  if (
    worldX >= boardLeft &&
    worldX <= boardRight &&
    worldY >= boardTop &&
    worldY <= boardBottom
  ) {
    return { type: 'input-board' }
  }

  return { type: 'none' }
}

function hitTestOutputBoard(worldX: number, worldY: number, circuit: Circuit, scale: number): HitResult {
  const { x: boardX, y: boardY } = circuit.outputBoard
  const outputCount = circuit.outputs.length

  // Calculate dynamic board width
  const boardWidth = getOutputBoardWidth(circuit)
  const halfWidth = boardWidth / 2

  // Output board expands to the RIGHT (pins on left stay fixed)
  // Visual center shifts right as width increases
  const widthDelta = boardWidth - BASE_BOARD_WIDTH
  const visualCenterX = boardX + widthDelta / 2

  // Pin X stays fixed at boardX - BASE_BOARD_WIDTH/2
  const pinX = boardX - BASE_BOARD_WIDTH / 2

  // Calculate board bounds based on visual center
  const pinsHeight = Math.max(0, outputCount * PIN_SPACING)
  const boardTop = boardY - BOARD_HEADER_HEIGHT / 2
  const boardBottom = boardY + BOARD_HEADER_HEIGHT / 2 + pinsHeight
  const boardLeft = visualCenterX - halfWidth
  const boardRight = visualCenterX + halfWidth

  // Check if within board area at all
  const inBoardArea =
    worldX >= boardLeft - 10 &&
    worldX <= boardRight + 10 &&
    worldY >= boardTop - 10 &&
    worldY <= boardBottom + 10

  if (!inBoardArea) return { type: 'none' }

  // Check header buttons first (fixed offset from visual center)
  // "-" button (left of label)
  const minusBtnX = visualCenterX - HEADER_BUTTON_OFFSET
  if (distance(worldX, worldY, minusBtnX, boardY) < BUTTON_RADIUS) {
    return { type: 'output-remove-button' }
  }

  // "+" button (right of label)
  const plusBtnX = visualCenterX + HEADER_BUTTON_OFFSET
  if (distance(worldX, worldY, plusBtnX, boardY) < BUTTON_RADIUS) {
    return { type: 'output-add-button' }
  }

  // Check each output pin (left side, for wiring) - at fixed position
  // Pin fixed on left, label fixed size relative to pin, indicator anchored to right of label
  for (const output of circuit.outputs) {
    const pinY = boardY + PIN_START_Y + output.order * PIN_SPACING

    if (distance(worldX, worldY, pinX, pinY) < PIN_HIT_RADIUS / scale) {
      return { type: 'pin', pinType: 'output-board', outputId: output.id }
    }

    // Label box: fixed size, fixed position relative to pin
    const labelBoxWidth = 52
    const labelBoxHeight = 14
    const labelBoxX = pinX + 18  // Fixed gap after pin

    // Check label area (between pin and value display)
    if (
      worldX >= labelBoxX &&
      worldX <= labelBoxX + labelBoxWidth &&
      worldY >= pinY - labelBoxHeight / 2 &&
      worldY <= pinY + labelBoxHeight / 2
    ) {
      return { type: 'output-label', outputId: output.id }
    }
  }

  // If within board bounds but didn't hit anything specific, it's a board drag
  if (
    worldX >= boardLeft &&
    worldX <= boardRight &&
    worldY >= boardTop &&
    worldY <= boardBottom
  ) {
    return { type: 'output-board' }
  }

  return { type: 'none' }
}

function hitTestWireHandles(
  worldX: number,
  worldY: number,
  circuit: Circuit,
  _scale: number,
  selectedWires: Set<WireId>,
  customComponents?: Map<CustomComponentId, CustomComponentDefinition>
): HitResult {
  // Check handles for each selected wire
  for (const wire of circuit.wires) {
    if (!selectedWires.has(wire.id)) continue

    const path = computeWirePath(wire, circuit, customComponents)
    if (path.length < 2) continue

    // Check each segment's handle
    for (let i = 0; i < path.length - 1; i++) {
      const p1 = path[i]
      const p2 = path[i + 1]
      if (!p1 || !p2) continue

      // Calculate midpoint of segment
      const midX = (p1.x + p2.x) / 2
      const midY = (p1.y + p2.y) / 2

      // Determine if segment is horizontal or vertical
      const isHorizontal = Math.abs(p2.y - p1.y) < Math.abs(p2.x - p1.x)

      // Hit test as a capsule/pill shape oriented along segment
      // Use half-width and half-height for the hit area
      const halfW = (isHorizontal ? HANDLE_SIZE.width : HANDLE_SIZE.height) / 2
      const halfH = (isHorizontal ? HANDLE_SIZE.height : HANDLE_SIZE.width) / 2

      // Simple rectangle hit test (capsule approximation)
      if (
        worldX >= midX - halfW &&
        worldX <= midX + halfW &&
        worldY >= midY - halfH &&
        worldY <= midY + halfH
      ) {
        return { type: 'wireHandle', wireId: wire.id, handleIndex: i }
      }
    }
  }

  return { type: 'none' }
}

/**
 * Get the midpoint of a wire segment for handle positioning
 */
export function getSegmentMidpoint(p1: Point, p2: Point): Point {
  return {
    x: (p1.x + p2.x) / 2,
    y: (p1.y + p2.y) / 2,
  }
}

/**
 * Determine if a segment is horizontal (vs vertical)
 */
export function isSegmentHorizontal(p1: Point, p2: Point): boolean {
  return Math.abs(p2.y - p1.y) < Math.abs(p2.x - p1.x)
}

function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
}

function distanceToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const lengthSq = dx * dx + dy * dy

  if (lengthSq === 0) {
    return distance(px, py, x1, y1)
  }

  let t = ((px - x1) * dx + (py - y1) * dy) / lengthSq
  t = Math.max(0, Math.min(1, t))

  const closestX = x1 + t * dx
  const closestY = y1 + t * dy

  return distance(px, py, closestX, closestY)
}
