import type { Circuit, Component, Wire, CustomComponentId, CustomComponentDefinition } from '../types'
import type { UIState } from '../types'
import type { SimulationResult } from '../hooks/useSimulation'
import { drawGrid, worldToScreen } from './grid'
import { isPrimitiveGate } from '../types'
import { getComponentDefinition } from '../simulation'

// Board layout constants (must match hitTest)
const BOARD_WIDTH = 100
const BOARD_HEADER_HEIGHT = 40
const PIN_SPACING = 40
const PIN_START_Y = 40 // Distance from board center to first pin (grid-aligned)

const COLORS = {
  gate: '#1e3a5f',
  gateSelected: '#2563eb',
  gateBorder: '#3b82f6',
  gateSelectedBorder: '#60a5fa',
  gateText: '#e2e8f0',
  // Custom component colors (purple tint)
  customGate: '#4a1e5f',
  customGateSelected: '#7c3aed',
  customGateBorder: '#9333ea',
  customGateSelectedBorder: '#a855f7',
  pinInput: '#f59e0b',
  pinOutput: '#22c55e',
  pinHovered: '#ffffff',
  wireOff: '#64748b',
  wireOn: '#22c55e',
  wireSelected: '#f59e0b',
  boardPin: '#3b82f6',
  boardBg: '#1e293b',
  boardBorder: '#334155',
  toggleOff: '#374151',
  toggleOn: '#22c55e',
  toggleOffHover: '#4b5563',
  toggleOnHover: '#4ade80',
  addButton: '#475569',
  addButtonHover: '#64748b',
  removeButton: '#dc2626',
  removeButtonHover: '#ef4444',
  text: '#e2e8f0',
  textMuted: '#94a3b8',
}

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  circuit: Circuit,
  ui: UIState,
  width: number,
  height: number,
  simulation: SimulationResult,
  customComponents?: Map<CustomComponentId, CustomComponentDefinition>
) {
  const dpr = window.devicePixelRatio
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  // Clear canvas
  ctx.fillStyle = '#0f172a'
  ctx.fillRect(0, 0, width / dpr, height / dpr)

  // Draw grid
  drawGrid(ctx, ui.viewport, width / dpr, height / dpr)

  // Draw input board (left)
  drawInputBoard(ctx, circuit, ui, ui.hoveredButton)

  // Draw output board (right)
  drawOutputBoard(ctx, circuit, ui, simulation.outputValues, ui.hoveredButton)

  // Draw wires
  for (const wire of circuit.wires) {
    const signalValue = simulation.wireValues.get(wire.id) ?? false
    drawWire(ctx, wire, circuit, ui, signalValue, customComponents)
  }

  // Draw wiring preview
  if (ui.wiring.active && ui.wiring.startPin) {
    drawWiringPreview(ctx, ui, circuit, customComponents)
  }

  // Draw components
  for (const component of circuit.components) {
    const selected = ui.selection.components.has(component.id)
    drawComponent(ctx, component, selected, ui, customComponents)
  }

  // Draw marquee selection
  if (ui.drag.type === 'marquee') {
    drawMarquee(ctx, ui)
  }
}

function drawComponent(
  ctx: CanvasRenderingContext2D,
  component: Component,
  selected: boolean,
  ui: UIState,
  customComponents?: Map<CustomComponentId, CustomComponentDefinition>
) {
  const def = getComponentDefinition(component.type, customComponents)
  if (!def) return

  const isCustom = !isPrimitiveGate(component.type)
  const screen = worldToScreen(component.x, component.y, ui.viewport)
  const scale = ui.viewport.zoom

  const w = def.width * scale
  const h = def.height * scale

  // Draw body with different colors for custom components
  if (isCustom) {
    ctx.fillStyle = selected ? COLORS.customGateSelected : COLORS.customGate
    ctx.strokeStyle = selected ? COLORS.customGateSelectedBorder : COLORS.customGateBorder
  } else {
    ctx.fillStyle = selected ? COLORS.gateSelected : COLORS.gate
    ctx.strokeStyle = selected ? COLORS.gateSelectedBorder : COLORS.gateBorder
  }
  ctx.lineWidth = 2

  ctx.beginPath()
  ctx.roundRect(screen.x - w / 2, screen.y - h / 2, w, h, 4 * scale)
  ctx.fill()
  ctx.stroke()

  // Draw label (use custom component name if available)
  ctx.fillStyle = COLORS.gateText
  ctx.font = `bold ${12 * scale}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  let label: string
  if (isCustom) {
    const customDef = customComponents?.get(component.type as CustomComponentId)
    label = customDef?.name ?? '?'
  } else {
    label = component.type
  }
  ctx.fillText(label, screen.x, screen.y)

  // Draw pins
  for (const pin of def.pins) {
    const pinX = screen.x + pin.offsetX * scale
    const pinY = screen.y + pin.offsetY * scale
    const isHovered =
      ui.hoveredComponentId === component.id && ui.hoveredPinIndex === pin.index

    ctx.beginPath()
    ctx.arc(pinX, pinY, 5 * scale, 0, Math.PI * 2)
    ctx.fillStyle = isHovered
      ? COLORS.pinHovered
      : pin.direction === 'input'
      ? COLORS.pinInput
      : COLORS.pinOutput
    ctx.fill()

    // Draw pin labels
    if (!isCustom) {
      // Primitive gates: always show small labels next to pins
      ctx.fillStyle = COLORS.textMuted
      ctx.font = `${8 * scale}px sans-serif`
      ctx.textBaseline = 'middle'
      if (pin.direction === 'input') {
        ctx.textAlign = 'left'
        ctx.fillText(pin.name, pinX + 8 * scale, pinY)
      } else {
        ctx.textAlign = 'right'
        ctx.fillText(pin.name, pinX - 8 * scale, pinY)
      }
    } else if (isHovered) {
      // Custom components: show label tooltip on hover
      ctx.fillStyle = '#1e293b'
      ctx.strokeStyle = COLORS.customGateBorder
      ctx.lineWidth = 1

      const labelText = pin.name
      ctx.font = `${10 * scale}px sans-serif`
      const textWidth = ctx.measureText(labelText).width
      const padding = 4 * scale
      const tooltipWidth = textWidth + padding * 2
      const tooltipHeight = 16 * scale

      // Position tooltip above the pin
      const tooltipX = pinX - tooltipWidth / 2
      const tooltipY = pinY - 20 * scale

      ctx.beginPath()
      ctx.roundRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight, 3 * scale)
      ctx.fill()
      ctx.stroke()

      ctx.fillStyle = COLORS.text
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(labelText, pinX, tooltipY + tooltipHeight / 2)
    }
  }
}

function drawWire(
  ctx: CanvasRenderingContext2D,
  wire: Wire,
  circuit: Circuit,
  ui: UIState,
  signalValue: boolean,
  customComponents?: Map<CustomComponentId, CustomComponentDefinition>
) {
  const start = getWireEndpoint(wire.source, circuit, ui, customComponents)
  const end = getWireEndpoint(wire.target, circuit, ui, customComponents)

  if (!start || !end) return

  const selected = ui.selection.wires.has(wire.id)

  ctx.strokeStyle = selected ? COLORS.wireSelected : signalValue ? COLORS.wireOn : COLORS.wireOff
  ctx.lineWidth = selected ? 3 : 2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // Draw L-shaped wire
  const midX = (start.x + end.x) / 2

  ctx.beginPath()
  ctx.moveTo(start.x, start.y)
  ctx.lineTo(midX, start.y)
  ctx.lineTo(midX, end.y)
  ctx.lineTo(end.x, end.y)
  ctx.stroke()
}

function getWireEndpoint(
  endpoint: Wire['source'] | Wire['target'],
  circuit: Circuit,
  ui: UIState,
  customComponents?: Map<CustomComponentId, CustomComponentDefinition>
): { x: number; y: number } | null {
  if (endpoint.type === 'component') {
    const component = circuit.components.find((c) => c.id === endpoint.componentId)
    if (!component) return null

    const def = getComponentDefinition(component.type, customComponents)
    if (!def) return null

    const pin = def.pins.find((p) => p.index === endpoint.pinIndex)
    if (!pin) return null

    const screen = worldToScreen(component.x, component.y, ui.viewport)
    return {
      x: screen.x + pin.offsetX * ui.viewport.zoom,
      y: screen.y + pin.offsetY * ui.viewport.zoom,
    }
  } else if (endpoint.type === 'input') {
    const input = circuit.inputs.find((i) => i.id === endpoint.inputId)
    if (!input) return null

    const { x: boardX, y: boardY } = circuit.inputBoard
    const pinY = boardY + PIN_START_Y + input.order * PIN_SPACING
    // Pin is on right side of input board at +35 from center
    return worldToScreen(boardX + 35, pinY, ui.viewport)
  } else if (endpoint.type === 'output') {
    const output = circuit.outputs.find((o) => o.id === endpoint.outputId)
    if (!output) return null

    const { x: boardX, y: boardY } = circuit.outputBoard
    const pinY = boardY + PIN_START_Y + output.order * PIN_SPACING
    // Pin is on left side of output board at -35 from center
    return worldToScreen(boardX - 35, pinY, ui.viewport)
  }

  return null
}

function drawWiringPreview(
  ctx: CanvasRenderingContext2D,
  ui: UIState,
  circuit: Circuit,
  customComponents?: Map<CustomComponentId, CustomComponentDefinition>
) {
  const startPin = ui.wiring.startPin
  if (!startPin) return

  let start: { x: number; y: number } | null = null

  if (startPin.type === 'component') {
    const component = circuit.components.find((c) => c.id === startPin.componentId)
    if (component) {
      const def = getComponentDefinition(component.type, customComponents)
      if (def) {
        const pin = def.pins.find((p) => p.index === startPin.pinIndex)
        if (pin) {
          const screen = worldToScreen(component.x, component.y, ui.viewport)
          start = {
            x: screen.x + pin.offsetX * ui.viewport.zoom,
            y: screen.y + pin.offsetY * ui.viewport.zoom,
          }
        }
      }
    }
  } else if (startPin.type === 'input') {
    const input = circuit.inputs.find((i) => i.id === startPin.inputId)
    if (input) {
      const { x: boardX, y: boardY } = circuit.inputBoard
      const pinY = boardY + PIN_START_Y + input.order * PIN_SPACING
      start = worldToScreen(boardX + 35, pinY, ui.viewport)
    }
  } else if (startPin.type === 'output') {
    const output = circuit.outputs.find((o) => o.id === startPin.outputId)
    if (output) {
      const { x: boardX, y: boardY } = circuit.outputBoard
      const pinY = boardY + PIN_START_Y + output.order * PIN_SPACING
      start = worldToScreen(boardX - 35, pinY, ui.viewport)
    }
  }

  if (!start) return

  const endX = ui.drag.currentX
  const endY = ui.drag.currentY

  ctx.strokeStyle = '#60a5fa'
  ctx.lineWidth = 2
  ctx.setLineDash([5, 5])

  const midX = (start.x + endX) / 2

  ctx.beginPath()
  ctx.moveTo(start.x, start.y)
  ctx.lineTo(midX, start.y)
  ctx.lineTo(midX, endY)
  ctx.lineTo(endX, endY)
  ctx.stroke()

  ctx.setLineDash([])
}

function drawInputBoard(ctx: CanvasRenderingContext2D, circuit: Circuit, ui: UIState, hoveredButton: UIState['hoveredButton']) {
  const { x: boardX, y: boardY } = circuit.inputBoard
  const inputCount = circuit.inputs.length
  const scale = ui.viewport.zoom

  // Calculate board dimensions
  const boardWidth = BOARD_WIDTH * scale
  const pinsHeight = Math.max(0, inputCount * PIN_SPACING)
  const boardHeight = (BOARD_HEADER_HEIGHT + pinsHeight) * scale

  // Get screen position (board position is the center of the header)
  const boardScreen = worldToScreen(boardX, boardY, ui.viewport)

  // Draw board background
  ctx.fillStyle = COLORS.boardBg
  ctx.strokeStyle = COLORS.boardBorder
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(
    boardScreen.x - boardWidth / 2,
    boardScreen.y - (BOARD_HEADER_HEIGHT * scale) / 2,
    boardWidth,
    boardHeight,
    8 * scale
  )
  ctx.fill()
  ctx.stroke()

  // Draw header with label and +/- buttons
  const headerY = boardScreen.y
  const isRemoveHovered = hoveredButton === 'input-remove'
  const isAddHovered = hoveredButton === 'input-add'

  // Draw "-" button (left)
  const minusBtnX = boardScreen.x - 30 * scale
  ctx.beginPath()
  ctx.arc(minusBtnX, headerY, 10 * scale, 0, Math.PI * 2)
  ctx.fillStyle = isRemoveHovered ? COLORS.removeButtonHover : COLORS.removeButton
  ctx.fill()
  ctx.fillStyle = COLORS.text
  ctx.font = `bold ${14 * scale}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('−', minusBtnX, headerY)

  // Draw "INPUTS" label (center)
  ctx.fillStyle = COLORS.text
  ctx.font = `bold ${10 * scale}px sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText('INPUTS', boardScreen.x, headerY)

  // Draw "+" button (right)
  const plusBtnX = boardScreen.x + 30 * scale
  ctx.beginPath()
  ctx.arc(plusBtnX, headerY, 10 * scale, 0, Math.PI * 2)
  ctx.fillStyle = isAddHovered ? COLORS.addButtonHover : COLORS.addButton
  ctx.fill()
  ctx.fillStyle = COLORS.text
  ctx.font = `bold ${14 * scale}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('+', plusBtnX, headerY)

  // Draw each input pin
  for (const input of circuit.inputs) {
    const pinWorldY = boardY + PIN_START_Y + input.order * PIN_SPACING
    const screen = worldToScreen(boardX, pinWorldY, ui.viewport)
    const isHovered = ui.hoveredInputId === input.id
    const isToggleHovered = typeof hoveredButton === 'object' && hoveredButton?.type === 'input-toggle' && hoveredButton.inputId === input.id

    // Draw toggle button (left side)
    const toggleX = screen.x - 20 * scale
    ctx.beginPath()
    ctx.arc(toggleX, screen.y, 10 * scale, 0, Math.PI * 2)
    if (isToggleHovered) {
      ctx.fillStyle = input.value ? COLORS.toggleOnHover : COLORS.toggleOffHover
    } else {
      ctx.fillStyle = input.value ? COLORS.toggleOn : COLORS.toggleOff
    }
    ctx.fill()

    // Draw toggle value
    ctx.fillStyle = COLORS.text
    ctx.font = `bold ${9 * scale}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(input.value ? '1' : '0', toggleX, screen.y)

    // Draw label (center)
    ctx.fillStyle = COLORS.textMuted
    ctx.font = `${9 * scale}px sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText(input.label, screen.x, screen.y)

    // Draw pin (right side, for wiring)
    const pinX = screen.x + 35 * scale
    const pinRadius = isHovered ? 7 * scale : 5 * scale
    ctx.beginPath()
    ctx.arc(pinX, screen.y, pinRadius, 0, Math.PI * 2)
    ctx.fillStyle = isHovered ? COLORS.pinHovered : input.value ? COLORS.toggleOn : COLORS.boardPin
    ctx.fill()

    // Draw hover ring
    if (isHovered) {
      ctx.strokeStyle = COLORS.pinHovered
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(pinX, screen.y, 10 * scale, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
}

function drawOutputBoard(
  ctx: CanvasRenderingContext2D,
  circuit: Circuit,
  ui: UIState,
  outputValues: Map<import('../types').OutputId, boolean>,
  hoveredButton: UIState['hoveredButton']
) {
  const { x: boardX, y: boardY } = circuit.outputBoard
  const outputCount = circuit.outputs.length
  const scale = ui.viewport.zoom

  // Calculate board dimensions
  const boardWidth = BOARD_WIDTH * scale
  const pinsHeight = Math.max(0, outputCount * PIN_SPACING)
  const boardHeight = (BOARD_HEADER_HEIGHT + pinsHeight) * scale

  // Get screen position (board position is the center of the header)
  const boardScreen = worldToScreen(boardX, boardY, ui.viewport)

  // Draw board background
  ctx.fillStyle = COLORS.boardBg
  ctx.strokeStyle = COLORS.boardBorder
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(
    boardScreen.x - boardWidth / 2,
    boardScreen.y - (BOARD_HEADER_HEIGHT * scale) / 2,
    boardWidth,
    boardHeight,
    8 * scale
  )
  ctx.fill()
  ctx.stroke()

  // Draw header with label and +/- buttons
  const headerY = boardScreen.y
  const isRemoveHovered = hoveredButton === 'output-remove'
  const isAddHovered = hoveredButton === 'output-add'

  // Draw "-" button (left)
  const minusBtnX = boardScreen.x - 30 * scale
  ctx.beginPath()
  ctx.arc(minusBtnX, headerY, 10 * scale, 0, Math.PI * 2)
  ctx.fillStyle = isRemoveHovered ? COLORS.removeButtonHover : COLORS.removeButton
  ctx.fill()
  ctx.fillStyle = COLORS.text
  ctx.font = `bold ${14 * scale}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('−', minusBtnX, headerY)

  // Draw "OUTPUTS" label (center)
  ctx.fillStyle = COLORS.text
  ctx.font = `bold ${9 * scale}px sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText('OUTPUTS', boardScreen.x, headerY)

  // Draw "+" button (right)
  const plusBtnX = boardScreen.x + 30 * scale
  ctx.beginPath()
  ctx.arc(plusBtnX, headerY, 10 * scale, 0, Math.PI * 2)
  ctx.fillStyle = isAddHovered ? COLORS.addButtonHover : COLORS.addButton
  ctx.fill()
  ctx.fillStyle = COLORS.text
  ctx.font = `bold ${14 * scale}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('+', plusBtnX, headerY)

  // Draw each output pin
  for (const output of circuit.outputs) {
    const pinWorldY = boardY + PIN_START_Y + output.order * PIN_SPACING
    const screen = worldToScreen(boardX, pinWorldY, ui.viewport)
    const value = outputValues.get(output.id) ?? false
    const isHovered = ui.hoveredOutputId === output.id

    // Draw pin (left side, for wiring)
    const pinX = screen.x - 35 * scale
    const pinRadius = isHovered ? 7 * scale : 5 * scale
    ctx.beginPath()
    ctx.arc(pinX, screen.y, pinRadius, 0, Math.PI * 2)
    ctx.fillStyle = isHovered ? COLORS.pinHovered : value ? COLORS.toggleOn : COLORS.boardPin
    ctx.fill()

    // Draw hover ring
    if (isHovered) {
      ctx.strokeStyle = COLORS.pinHovered
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(pinX, screen.y, 10 * scale, 0, Math.PI * 2)
      ctx.stroke()
    }

    // Draw label (center)
    ctx.fillStyle = COLORS.textMuted
    ctx.font = `${9 * scale}px sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText(output.label, screen.x, screen.y)

    // Draw value indicator (right side)
    const indicatorX = screen.x + 20 * scale
    ctx.beginPath()
    ctx.arc(indicatorX, screen.y, 10 * scale, 0, Math.PI * 2)
    ctx.fillStyle = value ? COLORS.toggleOn : COLORS.toggleOff
    ctx.fill()

    // Draw value
    ctx.fillStyle = COLORS.text
    ctx.font = `bold ${9 * scale}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(value ? '1' : '0', indicatorX, screen.y)
  }
}

function drawMarquee(ctx: CanvasRenderingContext2D, ui: UIState) {
  const x1 = ui.drag.startX
  const y1 = ui.drag.startY
  const x2 = ui.drag.currentX
  const y2 = ui.drag.currentY

  const left = Math.min(x1, x2)
  const top = Math.min(y1, y2)
  const width = Math.abs(x2 - x1)
  const height = Math.abs(y2 - y1)

  ctx.fillStyle = 'rgba(59, 130, 246, 0.1)'
  ctx.strokeStyle = '#3b82f6'
  ctx.lineWidth = 1
  ctx.setLineDash([5, 5])

  ctx.fillRect(left, top, width, height)
  ctx.strokeRect(left, top, width, height)

  ctx.setLineDash([])
}
