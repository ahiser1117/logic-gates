import type { Circuit, Component, Wire, CustomComponentId, CustomComponentDefinition } from '../types'
import type { UIState } from '../types'
import type { SimulationResult } from '../hooks/useSimulation'
import { drawGrid, worldToScreen } from './grid'
import { isPrimitiveGate } from '../types'
import { getComponentDefinition } from '../simulation'
import { computeWirePath, computePreviewPath, type Point } from './wirePathfinding'

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
  wireOffBorder: '#334155',
  wireOn: '#22c55e',
  wireOnBorder: '#166534',
  wireSelected: '#f59e0b',
  wireSelectedBorder: '#92400e',
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
  // Wire handle colors
  handleFill: '#ffffff',
  handleBorder: '#f59e0b',
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

  // Draw input board background (left) - without pins
  drawInputBoard(ctx, circuit, ui, ui.hoveredButton, false)

  // Draw output board background (right) - without pins
  drawOutputBoard(ctx, circuit, ui, simulation.outputValues, ui.hoveredButton, false)

  // Draw wires
  for (const wire of circuit.wires) {
    const signalValue = simulation.wireValues.get(wire.id) ?? false
    drawWire(ctx, wire, circuit, ui, signalValue, customComponents)
  }

  // Draw wiring preview
  if (ui.wiring.active && ui.wiring.startPin) {
    drawWiringPreview(ctx, ui, circuit, customComponents)
  }

  // Draw wire handles for selected wires
  drawWireHandles(ctx, circuit, ui, customComponents)

  // Draw board pins on top of wires
  drawInputBoard(ctx, circuit, ui, ui.hoveredButton, true)
  drawOutputBoard(ctx, circuit, ui, simulation.outputValues, ui.hoveredButton, true)

  // Draw components
  for (const component of circuit.components) {
    const selected = ui.selection.components.has(component.id)
    drawComponent(ctx, component, selected, ui, simulation, customComponents)
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
  simulation: SimulationResult,
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

  // Wrap text if too long for component width (account for pin radii on each side)
  const pinRadius = 8 * scale
  const maxWidth = w - 2 * pinRadius - 4 * scale // subtract pins and padding
  const lines = wrapText(ctx, label, maxWidth)
  const lineHeight = 14 * scale
  const totalHeight = lines.length * lineHeight
  const startY = screen.y - totalHeight / 2 + lineHeight / 2

  lines.forEach((line, i) => {
    ctx.fillText(line, screen.x, startY + i * lineHeight)
  })

  // Draw pins
  for (const pin of def.pins) {
    const pinX = screen.x + pin.offsetX * scale
    const pinY = screen.y + pin.offsetY * scale
    const isHovered =
      ui.hoveredComponentId === component.id && ui.hoveredPinIndex === pin.index

    // Get pin value from simulation (works even without connected wires)
    const componentPins = simulation.componentPinValues.get(component.id)
    const pinActive = componentPins?.get(pin.index) ?? false

    const pinRadius = 8 * scale
    ctx.beginPath()
    ctx.arc(pinX, pinY, pinRadius, 0, Math.PI * 2)
    ctx.fillStyle = pinActive ? COLORS.toggleOn : COLORS.boardPin
    ctx.fill()

    // Draw hover outline
    if (isHovered) {
      ctx.strokeStyle = COLORS.pinHovered
      ctx.lineWidth = 2
      ctx.stroke()
    }

    // Draw pin label tooltip for custom components on hover
    if (isCustom && isHovered) {
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
  // Compute path using A* pathfinding
  const path = computeWirePath(wire, circuit, customComponents)
  if (path.length < 2) return

  const firstPoint = path[0]
  if (!firstPoint) return

  const selected = ui.selection.wires.has(wire.id)
  const zoom = ui.viewport.zoom

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // Build the path once
  const buildPath = () => {
    ctx.beginPath()
    const startScreen = worldToScreen(firstPoint.x, firstPoint.y, ui.viewport)
    ctx.moveTo(startScreen.x, startScreen.y)
    for (let i = 1; i < path.length; i++) {
      const pt = path[i]
      if (!pt) continue
      const screen = worldToScreen(pt.x, pt.y, ui.viewport)
      ctx.lineTo(screen.x, screen.y)
    }
  }

  // Draw border (thicker, darker) - constant world size
  ctx.strokeStyle = selected
    ? COLORS.wireSelectedBorder
    : signalValue
      ? COLORS.wireOnBorder
      : COLORS.wireOffBorder
  ctx.lineWidth = (selected ? 6 : 5) * zoom
  buildPath()
  ctx.stroke()

  // Draw main wire on top - constant world size
  ctx.strokeStyle = selected ? COLORS.wireSelected : signalValue ? COLORS.wireOn : COLORS.wireOff
  ctx.lineWidth = (selected ? 4 : 3) * zoom
  buildPath()
  ctx.stroke()
}

// Handle dimensions in world units (from hitTest.ts)
const HANDLE_WIDTH = 16
const HANDLE_HEIGHT = 8

function drawWireHandles(
  ctx: CanvasRenderingContext2D,
  circuit: Circuit,
  ui: UIState,
  customComponents?: Map<CustomComponentId, CustomComponentDefinition>
) {
  const zoom = ui.viewport.zoom

  // Only draw handles for selected wires
  for (const wire of circuit.wires) {
    if (!ui.selection.wires.has(wire.id)) continue

    const path = computeWirePath(wire, circuit, customComponents)
    if (path.length < 2) continue

    // Draw handle at midpoint of each segment
    for (let i = 0; i < path.length - 1; i++) {
      const p1 = path[i]
      const p2 = path[i + 1]
      if (!p1 || !p2) continue

      // Calculate midpoint
      const midX = (p1.x + p2.x) / 2
      const midY = (p1.y + p2.y) / 2

      // Determine if segment is horizontal or vertical
      const isHorizontal = Math.abs(p2.y - p1.y) < Math.abs(p2.x - p1.x)

      // Handle dimensions based on orientation
      const handleW = (isHorizontal ? HANDLE_WIDTH : HANDLE_HEIGHT) * zoom
      const handleH = (isHorizontal ? HANDLE_HEIGHT : HANDLE_WIDTH) * zoom

      // Convert to screen coordinates
      const screen = worldToScreen(midX, midY, ui.viewport)

      // Draw capsule (rounded rectangle)
      ctx.fillStyle = COLORS.handleFill
      ctx.strokeStyle = COLORS.handleBorder
      ctx.lineWidth = 2

      ctx.beginPath()
      ctx.roundRect(
        screen.x - handleW / 2,
        screen.y - handleH / 2,
        handleW,
        handleH,
        Math.min(handleW, handleH) / 2 // Full radius for capsule shape
      )
      ctx.fill()
      ctx.stroke()
    }
  }
}

function drawWiringPreview(
  ctx: CanvasRenderingContext2D,
  ui: UIState,
  circuit: Circuit,
  customComponents?: Map<CustomComponentId, CustomComponentDefinition>
) {
  const startPin = ui.wiring.startPin
  if (!startPin) return

  // Get start point in world coordinates and determine if it's a source pin
  let startWorld: Point | null = null
  let isSourcePin = true // Sources exit to the right, targets exit to the left

  if (startPin.type === 'component') {
    const component = circuit.components.find((c) => c.id === startPin.componentId)
    if (component) {
      const def = getComponentDefinition(component.type, customComponents)
      if (def) {
        const pin = def.pins.find((p) => p.index === startPin.pinIndex)
        if (pin) {
          startWorld = {
            x: component.x + pin.offsetX,
            y: component.y + pin.offsetY,
          }
          // Output pins are sources, input pins are targets
          isSourcePin = pin.direction === 'output'
        }
      }
    }
  } else if (startPin.type === 'input') {
    // Input board pins are sources (they provide values)
    const input = circuit.inputs.find((i) => i.id === startPin.inputId)
    if (input) {
      const { x: boardX, y: boardY } = circuit.inputBoard
      startWorld = {
        x: boardX + BOARD_WIDTH / 2,
        y: boardY + PIN_START_Y + input.order * PIN_SPACING,
      }
      isSourcePin = true
    }
  } else if (startPin.type === 'output') {
    // Output board pins are targets (they receive values)
    const output = circuit.outputs.find((o) => o.id === startPin.outputId)
    if (output) {
      const { x: boardX, y: boardY } = circuit.outputBoard
      startWorld = {
        x: boardX - BOARD_WIDTH / 2,
        y: boardY + PIN_START_Y + output.order * PIN_SPACING,
      }
      isSourcePin = false
    }
  }

  if (!startWorld) return

  // Convert mouse position to world coordinates
  const endWorld = {
    x: (ui.drag.currentX - ui.viewport.panX) / ui.viewport.zoom,
    y: (ui.drag.currentY - ui.viewport.panY) / ui.viewport.zoom,
  }

  // Compute path using pathfinding
  const path = computePreviewPath(startWorld, endWorld, circuit, customComponents, isSourcePin)

  if (path.length < 2) return

  const firstPoint = path[0]
  if (!firstPoint) return

  const zoom = ui.viewport.zoom

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // Build the path once
  const buildPath = () => {
    ctx.beginPath()
    const startScreen = worldToScreen(firstPoint.x, firstPoint.y, ui.viewport)
    ctx.moveTo(startScreen.x, startScreen.y)
    for (let i = 1; i < path.length; i++) {
      const pt = path[i]
      if (!pt) continue
      const screen = worldToScreen(pt.x, pt.y, ui.viewport)
      ctx.lineTo(screen.x, screen.y)
    }
  }

  // Draw border - constant world size
  ctx.strokeStyle = '#1e3a5f'
  ctx.lineWidth = 5 * zoom
  ctx.setLineDash([])
  buildPath()
  ctx.stroke()

  // Draw main preview line (dashed) - constant world size
  ctx.strokeStyle = '#60a5fa'
  ctx.lineWidth = 3 * zoom
  ctx.setLineDash([5 * zoom, 5 * zoom])
  buildPath()
  ctx.stroke()

  ctx.setLineDash([])
}

function drawInputBoard(ctx: CanvasRenderingContext2D, circuit: Circuit, ui: UIState, hoveredButton: UIState['hoveredButton'], pinsOnly: boolean = false) {
  const { x: boardX, y: boardY } = circuit.inputBoard
  const inputCount = circuit.inputs.length
  const scale = ui.viewport.zoom

  // Get screen position (board position is the center of the header)
  const boardScreen = worldToScreen(boardX, boardY, ui.viewport)

  if (!pinsOnly) {
    // Calculate board dimensions
    const boardWidth = BOARD_WIDTH * scale
    const pinsHeight = Math.max(0, inputCount * PIN_SPACING)
    const boardHeight = (BOARD_HEADER_HEIGHT + pinsHeight) * scale

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
    const minusBtnX = boardScreen.x - 34 * scale
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
    const plusBtnX = boardScreen.x + 34 * scale
    ctx.beginPath()
    ctx.arc(plusBtnX, headerY, 10 * scale, 0, Math.PI * 2)
    ctx.fillStyle = isAddHovered ? COLORS.addButtonHover : COLORS.addButton
    ctx.fill()
    ctx.fillStyle = COLORS.text
    ctx.font = `bold ${14 * scale}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('+', plusBtnX, headerY)

    // Draw each input row (toggle, label) but not pins
    for (const input of circuit.inputs) {
      const pinWorldY = boardY + PIN_START_Y + input.order * PIN_SPACING
      const screen = worldToScreen(boardX, pinWorldY, ui.viewport)
      const isToggleHovered = typeof hoveredButton === 'object' && hoveredButton?.type === 'input-toggle' && hoveredButton.inputId === input.id

      // Draw toggle button (left side)
      const toggleX = screen.x - 34 * scale
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

      // Draw label box outline and label (between toggle and pin, left-justified)
      const labelBoxX = screen.x - 20 * scale
      const labelBoxWidth = 52 * scale
      const labelBoxHeight = 14 * scale
      ctx.strokeStyle = 'rgba(71, 85, 105, 0.5)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.roundRect(labelBoxX, screen.y - labelBoxHeight / 2, labelBoxWidth, labelBoxHeight, 2 * scale)
      ctx.stroke()

      // Clip text to label box
      ctx.save()
      ctx.beginPath()
      ctx.rect(labelBoxX, screen.y - labelBoxHeight / 2, labelBoxWidth, labelBoxHeight)
      ctx.clip()

      ctx.fillStyle = COLORS.textMuted
      ctx.font = `${9 * scale}px sans-serif`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(input.label, labelBoxX + 3 * scale, screen.y)

      ctx.restore()
    }
  } else {
    // Draw only the pins (after wires)
    for (const input of circuit.inputs) {
      const pinWorldY = boardY + PIN_START_Y + input.order * PIN_SPACING
      const screen = worldToScreen(boardX, pinWorldY, ui.viewport)
      const isHovered = ui.hoveredInputId === input.id

      // Draw pin (right side, for wiring)
      const pinX = screen.x + (BOARD_WIDTH / 2) * scale
      const pinRadius = 8 * scale
      ctx.beginPath()
      ctx.arc(pinX, screen.y, pinRadius, 0, Math.PI * 2)
      ctx.fillStyle = input.value ? COLORS.toggleOn : COLORS.boardPin
      ctx.fill()

      // Draw hover outline
      if (isHovered) {
        ctx.strokeStyle = COLORS.pinHovered
        ctx.lineWidth = 2
        ctx.stroke()
      }
    }
  }
}

function drawOutputBoard(
  ctx: CanvasRenderingContext2D,
  circuit: Circuit,
  ui: UIState,
  outputValues: Map<import('../types').OutputId, boolean>,
  hoveredButton: UIState['hoveredButton'],
  pinsOnly: boolean = false
) {
  const { x: boardX, y: boardY } = circuit.outputBoard
  const outputCount = circuit.outputs.length
  const scale = ui.viewport.zoom

  // Get screen position (board position is the center of the header)
  const boardScreen = worldToScreen(boardX, boardY, ui.viewport)

  if (!pinsOnly) {
    // Calculate board dimensions
    const boardWidth = BOARD_WIDTH * scale
    const pinsHeight = Math.max(0, outputCount * PIN_SPACING)
    const boardHeight = (BOARD_HEADER_HEIGHT + pinsHeight) * scale

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
    const minusBtnX = boardScreen.x - 34 * scale
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
    const plusBtnX = boardScreen.x + 34 * scale
    ctx.beginPath()
    ctx.arc(plusBtnX, headerY, 10 * scale, 0, Math.PI * 2)
    ctx.fillStyle = isAddHovered ? COLORS.addButtonHover : COLORS.addButton
    ctx.fill()
    ctx.fillStyle = COLORS.text
    ctx.font = `bold ${14 * scale}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('+', plusBtnX, headerY)

    // Draw each output row (label, indicator) but not pins
    for (const output of circuit.outputs) {
      const pinWorldY = boardY + PIN_START_Y + output.order * PIN_SPACING
      const screen = worldToScreen(boardX, pinWorldY, ui.viewport)
      const value = outputValues.get(output.id) ?? false

      // Draw label box outline and label (between pin and indicator, right-justified)
      const labelBoxWidth = 52 * scale
      const labelBoxHeight = 14 * scale
      const labelBoxX = screen.x - 32 * scale
      ctx.strokeStyle = 'rgba(71, 85, 105, 0.5)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.roundRect(labelBoxX, screen.y - labelBoxHeight / 2, labelBoxWidth, labelBoxHeight, 2 * scale)
      ctx.stroke()

      // Clip text to label box
      ctx.save()
      ctx.beginPath()
      ctx.rect(labelBoxX, screen.y - labelBoxHeight / 2, labelBoxWidth, labelBoxHeight)
      ctx.clip()

      ctx.fillStyle = COLORS.textMuted
      ctx.font = `${9 * scale}px sans-serif`
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillText(output.label, labelBoxX + labelBoxWidth - 3 * scale, screen.y)

      ctx.restore()

      // Draw value indicator (right side)
      const indicatorX = screen.x + 34 * scale
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
  } else {
    // Draw only the pins (after wires)
    for (const output of circuit.outputs) {
      const pinWorldY = boardY + PIN_START_Y + output.order * PIN_SPACING
      const screen = worldToScreen(boardX, pinWorldY, ui.viewport)
      const value = outputValues.get(output.id) ?? false
      const isHovered = ui.hoveredOutputId === output.id

      // Draw pin (left side, for wiring)
      const pinX = screen.x - (BOARD_WIDTH / 2) * scale
      const pinRadius = 8 * scale
      ctx.beginPath()
      ctx.arc(pinX, screen.y, pinRadius, 0, Math.PI * 2)
      ctx.fillStyle = value ? COLORS.toggleOn : COLORS.boardPin
      ctx.fill()

      // Draw hover outline
      if (isHovered) {
        ctx.strokeStyle = COLORS.pinHovered
        ctx.lineWidth = 2
        ctx.stroke()
      }
    }
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

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  // If text fits, return as single line
  if (ctx.measureText(text).width <= maxWidth) {
    return [text]
  }

  const words = text.split(/\s+/)
  const lines: string[] = []
  let currentLine = ''

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word
    if (ctx.measureText(testLine).width <= maxWidth) {
      currentLine = testLine
    } else {
      if (currentLine) {
        lines.push(currentLine)
      }
      // If single word is too long, split by character
      if (ctx.measureText(word).width > maxWidth) {
        let remaining = word
        while (remaining) {
          let i = remaining.length
          while (i > 1 && ctx.measureText(remaining.slice(0, i)).width > maxWidth) {
            i--
          }
          lines.push(remaining.slice(0, i))
          remaining = remaining.slice(i)
        }
        currentLine = ''
      } else {
        currentLine = word
      }
    }
  }

  if (currentLine) {
    lines.push(currentLine)
  }

  return lines.length > 0 ? lines : [text]
}
