import { useRef, useEffect, useCallback, useState } from 'react'
import { useStore, type InitialWireState } from '../store'
import { useSimulation } from '../hooks/useSimulation'
import { renderFrame } from './renderer'
import { hitTest } from './hitTest'
import { screenToWorld, worldToScreen, snapToGrid } from './grid'
import { getComponentDefinition } from '../simulation'
import type { ComponentType, ComponentId, InputId, OutputId, WireId, Point } from '../types'
import { computeWirePath, getWireEndpointWorld, GRID_STEP } from './wirePathfinding'
import { BitWidthContextMenu } from '../components/BitWidthContextMenu'
import { getInputBoardWidth, PIN_START_Y, PIN_SPACING } from './boardLayout'
import './CanvasWorkspace.css'

const GRID_SIZE = 20
const WAYPOINT_HIT_RADIUS = 12 // World units for detecting clicks on waypoints

/**
 * Simplify a path by removing collinear points and duplicate points.
 * Keeps only the corner points where direction changes.
 * Works on the full path (including pin positions).
 */
function simplifyPath(path: Point[]): Point[] {
  if (path.length <= 2) return path

  const firstPoint = path[0]
  if (!firstPoint) return path

  const simplified: Point[] = [firstPoint]

  for (let i = 1; i < path.length - 1; i++) {
    const prev = simplified[simplified.length - 1]
    const curr = path[i]
    const next = path[i + 1]

    if (!prev || !curr || !next) continue

    // Skip if current point is same as previous (duplicate)
    if (prev.x === curr.x && prev.y === curr.y) continue

    // Check if prev, curr, next are collinear
    const dx1 = curr.x - prev.x
    const dy1 = curr.y - prev.y
    const dx2 = next.x - curr.x
    const dy2 = next.y - curr.y

    // Points are collinear if both segments are in the same direction
    // (both horizontal or both vertical)
    const prevToCurrentHorizontal = dy1 === 0
    const currentToNextHorizontal = dy2 === 0
    const prevToCurrentVertical = dx1 === 0
    const currentToNextVertical = dx2 === 0

    const isCollinear =
      (prevToCurrentHorizontal && currentToNextHorizontal) ||
      (prevToCurrentVertical && currentToNextVertical)

    // Keep the point if it's a corner (not collinear)
    if (!isCollinear) {
      simplified.push(curr)
    }
  }

  // Always add the last point
  const lastPoint = path[path.length - 1]
  if (lastPoint) {
    const lastSimplified = simplified[simplified.length - 1]
    // Don't add if it's a duplicate
    if (!lastSimplified || lastSimplified.x !== lastPoint.x || lastSimplified.y !== lastPoint.y) {
      simplified.push(lastPoint)
    }
  }

  return simplified
}

/**
 * Extract waypoints from a full path by removing the first and last points (pins).
 */
function pathToWaypoints(path: Point[]): Point[] {
  if (path.length <= 2) return []
  return path.slice(1, -1)
}

interface LabelEdit {
  type: 'input' | 'output'
  id: InputId | OutputId
  label: string
  worldX: number
  worldY: number
}

// Separate component to ensure proper re-rendering
function MultiBitInputOverlay({
  multiBitEdit,
  viewport,
  inputRef,
  onChange,
  onComplete,
  onCancel,
}: {
  multiBitEdit: MultiBitEdit
  viewport: { panX: number; panY: number; zoom: number }
  inputRef: React.RefObject<HTMLInputElement>
  onChange: (value: string) => void
  onComplete: () => void
  onCancel: () => void
}) {
  const screen = worldToScreen(multiBitEdit.worldX, multiBitEdit.worldY, viewport)
  const scale = viewport.zoom
  const inputWidth = Math.max(40, multiBitEdit.bitWidth * 10) * scale
  const inputHeight = 20 * scale
  // Position at the toggle location (left side of input board row)
  // Toggle offset is halfBoardWidth - 16
  const toggleOffset = multiBitEdit.boardHalfWidth - 16
  const inputX = screen.x - toggleOffset * scale - inputWidth / 2
  const inputY = screen.y - inputHeight / 2

  return (
    <input
      ref={inputRef}
      type="text"
      className="multi-bit-input"
      value={multiBitEdit.value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          onComplete()
        } else if (e.key === 'Escape') {
          onCancel()
        }
      }}
      onBlur={onComplete}
      style={{
        position: 'absolute',
        left: `${inputX}px`,
        top: `${inputY}px`,
        width: `${inputWidth}px`,
        height: `${inputHeight}px`,
        fontSize: `${10 * scale}px`,
      }}
    />
  )
}

interface MultiBitEdit {
  inputId: InputId
  value: string
  worldX: number
  worldY: number
  bitWidth: number
  boardHalfWidth: number
}

export function CanvasWorkspace() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragStartPositions = useRef<Map<ComponentId, { x: number; y: number }>>(new Map())
  const initialWireState = useRef<InitialWireState[]>([])
  const boardDragStart = useRef<{ board: 'input' | 'output'; x: number; y: number } | null>(null)
  const boardInitialWireState = useRef<InitialWireState[]>([])
  const wireHandleDragStart = useRef<{ wireId: WireId; handleIndex: number; originalPath: Point[] } | null>(null)
  const [labelEdit, setLabelEdit] = useState<LabelEdit | null>(null)
  const [multiBitEdit, setMultiBitEdit] = useState<MultiBitEdit | null>(null)
  const labelInputRef = useRef<HTMLInputElement>(null)
  const multiBitInputRef = useRef<HTMLInputElement>(null)

  const circuit = useStore((s) => s.circuit)
  const ui = useStore((s) => s.ui)
  const customComponents = useStore((s) => s.customComponents)
  const simulation = useSimulation()
  const addComponent = useStore((s) => s.addComponent)
  const moveComponent = useStore((s) => s.moveComponent)
  const selectComponent = useStore((s) => s.selectComponent)
  const selectWire = useStore((s) => s.selectWire)
  const clearSelection = useStore((s) => s.clearSelection)
  const deleteSelected = useStore((s) => s.deleteSelected)
  const pan = useStore((s) => s.pan)
  const zoom = useStore((s) => s.zoom)
  const setDrag = useStore((s) => s.setDrag)
  const resetDrag = useStore((s) => s.resetDrag)
  const startWiring = useStore((s) => s.startWiring)
  const completeWiring = useStore((s) => s.completeWiring)
  const cancelWiring = useStore((s) => s.cancelWiring)
  const addWiringWaypoint = useStore((s) => s.addWiringWaypoint)
  const removeWiringWaypoint = useStore((s) => s.removeWiringWaypoint)
  const wiringWaypoints = useStore((s) => s.ui.wiring.waypoints)
  const setHoveredPin = useStore((s) => s.setHoveredPin)
  const setHoveredBoardPin = useStore((s) => s.setHoveredBoardPin)
  const addInput = useStore((s) => s.addInput)
  const addOutput = useStore((s) => s.addOutput)
  const toggleInput = useStore((s) => s.toggleInput)
  const removeInput = useStore((s) => s.removeInput)
  const removeOutput = useStore((s) => s.removeOutput)
  const renameInput = useStore((s) => s.renameInput)
  const renameOutput = useStore((s) => s.renameOutput)
  const moveInputBoard = useStore((s) => s.moveInputBoard)
  const moveOutputBoard = useStore((s) => s.moveOutputBoard)
  const setHoveredButton = useStore((s) => s.setHoveredButton)
  const updateWireWaypoints = useStore((s) => s.updateWireWaypoints)
  const contextMenu = useStore((s) => s.ui.contextMenu)
  const showContextMenu = useStore((s) => s.showContextMenu)
  const hideContextMenu = useStore((s) => s.hideContextMenu)
  const setInputValue = useStore((s) => s.setInputValue)

  // Focus label input when editing starts
  useEffect(() => {
    if (labelEdit && labelInputRef.current) {
      labelInputRef.current.focus()
      labelInputRef.current.select()
    }
  }, [labelEdit?.id])

  // Focus multi-bit input when editing starts
  useEffect(() => {
    if (multiBitEdit && multiBitInputRef.current) {
      // Small delay to ensure proper mounting before focus
      const timer = setTimeout(() => {
        if (multiBitInputRef.current) {
          multiBitInputRef.current.focus()
          multiBitInputRef.current.select()
        }
      }, 10)
      return () => clearTimeout(timer)
    }
  }, [multiBitEdit?.inputId])

  // Handle canvas resize and center viewport initially
  const hasInitialized = useRef(false)
  const setViewport = useStore((s) => s.setViewport)

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        const { width, height } = entry.contentRect
        canvas.width = width * window.devicePixelRatio
        canvas.height = height * window.devicePixelRatio
        canvas.style.width = `${width}px`
        canvas.style.height = `${height}px`

        // Center viewport on first load
        if (!hasInitialized.current) {
          hasInitialized.current = true
          setViewport({ panX: width / 2, panY: height / 2 })
        }
      }
    })

    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [setViewport])

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationId: number

    const frame = () => {
      renderFrame(ctx, circuit, ui, canvas.width, canvas.height, simulation, customComponents)
      animationId = requestAnimationFrame(frame)
    }

    animationId = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(animationId)
  }, [circuit, ui, simulation, customComponents])

  // Get screen coordinates from mouse event (in CSS pixels)
  const getScreenCoords = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    }
  }, [])

  // Mouse event handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const { x, y } = getScreenCoords(e)

      // Middle mouse or ctrl+left for panning
      if (e.button === 1 || (e.button === 0 && e.ctrlKey)) {
        e.preventDefault()
        setDrag({
          type: 'pan',
          startX: x,
          startY: y,
          currentX: x,
          currentY: y,
        })
        return
      }

      // Left click
      if (e.button === 0) {
        const hit = hitTest(x, y, circuit, ui.viewport, customComponents, ui.selection.wires)

        // Handle input board "add" button
        if (hit.type === 'input-add-button') {
          addInput()
          return
        }

        // Handle output board "add" button
        if (hit.type === 'output-add-button') {
          addOutput()
          return
        }

        // Handle input toggle (single-bit) or multi-bit input edit
        if (hit.type === 'input-toggle' && hit.inputId !== undefined) {
          const input = circuit.inputs.find((i) => i.id === hit.inputId)
          if (input) {
            const bitWidth = input.bitWidth ?? 1
            if (bitWidth > 1) {
              // Multi-bit: open text editor
              const pinWorldY = circuit.inputBoard.y + PIN_START_Y + input.order * PIN_SPACING
              const valueStr = Array.isArray(input.value)
                ? input.value.map(b => b ? '1' : '0').reverse().join('')
                : (input.value ? '1' : '0')
              const boardHalfWidth = getInputBoardWidth(circuit) / 2
              setMultiBitEdit({
                inputId: hit.inputId,
                value: valueStr,
                worldX: circuit.inputBoard.x,
                worldY: pinWorldY,
                bitWidth: bitWidth,
                boardHalfWidth: boardHalfWidth,
              })
              return
            }
            toggleInput(hit.inputId)
          }
          return
        }

        // Handle remove buttons
        if (hit.type === 'input-remove-button') {
          // Remove the last input if there are any
          const lastInput = circuit.inputs[circuit.inputs.length - 1]
          if (lastInput) {
            removeInput(lastInput.id)
          }
          return
        }

        if (hit.type === 'output-remove-button') {
          // Remove the last output if there are any
          const lastOutput = circuit.outputs[circuit.outputs.length - 1]
          if (lastOutput) {
            removeOutput(lastOutput.id)
          }
          return
        }

        // Handle board dragging
        if (hit.type === 'input-board') {
          const world = screenToWorld(x, y, ui.viewport)
          boardDragStart.current = {
            board: 'input',
            x: circuit.inputBoard.x,
            y: circuit.inputBoard.y,
          }
          // Capture initial wire state for wires connected to input board
          boardInitialWireState.current = []
          for (const wire of circuit.wires) {
            if (wire.source.type !== 'input') continue

            const sourcePos = getWireEndpointWorld(wire.source, circuit, customComponents)
            const targetPos = getWireEndpointWorld(wire.target, circuit, customComponents)
            if (!sourcePos || !targetPos) continue

            // Get current waypoints - if none, compute auto L-shape and extract bends
            let waypoints = wire.waypoints || []
            if (waypoints.length === 0) {
              const path = computeWirePath(wire, circuit, customComponents)
              if (path.length >= 4) {
                waypoints = path.slice(1, -1)
              } else if (path.length === 3) {
                waypoints = [path[1]!, path[1]!]
              } else {
                const midX = (sourcePos.x + targetPos.x) / 2
                waypoints = [
                  { x: midX, y: sourcePos.y },
                  { x: midX, y: targetPos.y }
                ]
              }
            }

            // Input board pins are always sources, so isSourceEnd = true
            const anchor = waypoints.length > 2
              ? waypoints[2]!
              : targetPos
            const bendX = waypoints[0]?.x ?? sourcePos.x
            const denom = anchor.x - sourcePos.x
            const xRatio = denom !== 0 ? (bendX - sourcePos.x) / denom : 0.5

            boardInitialWireState.current.push({
              wireId: wire.id,
              xRatio: isFinite(xRatio) ? xRatio : 0.5,
              anchorX: anchor.x,
              anchorY: anchor.y,
              isSourceEnd: true,
              remainingWaypoints: waypoints.slice(2)
            })
          }
          setDrag({
            type: 'component', // Reuse component drag type for boards
            startX: world.x,
            startY: world.y,
            currentX: world.x,
            currentY: world.y,
          })
          return
        }

        if (hit.type === 'output-board') {
          const world = screenToWorld(x, y, ui.viewport)
          boardDragStart.current = {
            board: 'output',
            x: circuit.outputBoard.x,
            y: circuit.outputBoard.y,
          }
          // Capture initial wire state for wires connected to output board
          boardInitialWireState.current = []
          for (const wire of circuit.wires) {
            if (wire.target.type !== 'output') continue

            const sourcePos = getWireEndpointWorld(wire.source, circuit, customComponents)
            const targetPos = getWireEndpointWorld(wire.target, circuit, customComponents)
            if (!sourcePos || !targetPos) continue

            // Get current waypoints - if none, compute auto L-shape and extract bends
            let waypoints = wire.waypoints || []
            if (waypoints.length === 0) {
              const path = computeWirePath(wire, circuit, customComponents)
              if (path.length >= 4) {
                waypoints = path.slice(1, -1)
              } else if (path.length === 3) {
                waypoints = [path[1]!, path[1]!]
              } else {
                const midX = (sourcePos.x + targetPos.x) / 2
                waypoints = [
                  { x: midX, y: sourcePos.y },
                  { x: midX, y: targetPos.y }
                ]
              }
            }

            // Output board pins are always targets, so isSourceEnd = false
            const wpLen = waypoints.length
            const anchor = wpLen > 2
              ? waypoints[wpLen - 3]!
              : sourcePos
            const bendX = waypoints[wpLen - 1]?.x ?? targetPos.x
            const denom = anchor.x - targetPos.x
            const xRatio = denom !== 0 ? (bendX - targetPos.x) / denom : 0.5

            boardInitialWireState.current.push({
              wireId: wire.id,
              xRatio: isFinite(xRatio) ? xRatio : 0.5,
              anchorX: anchor.x,
              anchorY: anchor.y,
              isSourceEnd: false,
              remainingWaypoints: waypoints.slice(0, -2)
            })
          }
          setDrag({
            type: 'component', // Reuse component drag type for boards
            startX: world.x,
            startY: world.y,
            currentX: world.x,
            currentY: world.y,
          })
          return
        }

        if (hit.type === 'pin') {
          // Start wiring
          if (hit.pinType === 'input-board') {
            startWiring({ type: 'input', inputId: hit.inputId! })
          } else if (hit.pinType === 'output-board') {
            startWiring({ type: 'output', outputId: hit.outputId! })
          } else {
            startWiring({
              type: 'component',
              componentId: hit.componentId!,
              pinIndex: hit.pinIndex!,
              pinType: hit.pinType as 'input' | 'output',
            })
          }
          setDrag({
            type: 'none',
            startX: x,
            startY: y,
            currentX: x,
            currentY: y,
          })
        } else if (hit.type === 'component') {
          const componentId = hit.componentId!
          const isSelected = ui.selection.components.has(componentId)

          // Handle selection changes
          if (e.shiftKey) {
            // Shift-click: toggle this component in selection
            selectComponent(componentId, true)
          } else if (!isSelected) {
            // Click on unselected component: clear selection and select this one
            clearSelection()
            selectComponent(componentId, true)
          }
          // If clicking on already-selected component without shift, don't change selection
          // This preserves multi-selection for dragging

          // Store initial positions of components to move
          dragStartPositions.current.clear()

          let componentsToMove: Set<ComponentId>
          if (!isSelected && !e.shiftKey) {
            // Fresh click on unselected component - only move this one
            componentsToMove = new Set([componentId])
          } else {
            // Clicking already selected or shift-click - move all selected + this one
            componentsToMove = new Set(ui.selection.components)
            componentsToMove.add(componentId)
          }

          for (const id of componentsToMove) {
            const comp = circuit.components.find((c) => c.id === id)
            if (comp) {
              dragStartPositions.current.set(id, { x: comp.x, y: comp.y })
            }
          }

          // Capture initial wire state for all wires connected to components being moved
          initialWireState.current = []
          for (const wire of circuit.wires) {
            const isSourceMoving = wire.source.type === 'component' && componentsToMove.has(wire.source.componentId)
            const isTargetMoving = wire.target.type === 'component' && componentsToMove.has(wire.target.componentId)
            if (!isSourceMoving && !isTargetMoving) continue

            const sourcePos = getWireEndpointWorld(wire.source, circuit, customComponents)
            const targetPos = getWireEndpointWorld(wire.target, circuit, customComponents)
            if (!sourcePos || !targetPos) continue

            // Get current waypoints - if none, compute auto L-shape and extract bends
            let waypoints = wire.waypoints || []
            if (waypoints.length === 0) {
              // Compute auto L-shape path and extract the 2 bend points
              const path = computeWirePath(wire, circuit, customComponents)
              // Path is typically [pin, bend1, bend2, pin] after simplification
              // Extract middle points as waypoints
              if (path.length >= 4) {
                waypoints = path.slice(1, -1)
              } else if (path.length === 3) {
                // Single bend case - use it as both bends for L-shape
                waypoints = [path[1]!, path[1]!]
              } else {
                // Direct connection - create default L-shape
                const midX = (sourcePos.x + targetPos.x) / 2
                waypoints = [
                  { x: midX, y: sourcePos.y },
                  { x: midX, y: targetPos.y }
                ]
              }
            }

            // When BOTH ends are moving, use translation mode
            if (isSourceMoving && isTargetMoving) {
              initialWireState.current.push({
                wireId: wire.id,
                bothEndsMoving: true,
                originalWaypoints: waypoints.map(wp => ({ ...wp })),
                // Store original source position to compute delta later
                anchorX: sourcePos.x,
                anchorY: sourcePos.y,
                // These fields are required but unused in translation mode
                xRatio: 0,
                isSourceEnd: true,
                remainingWaypoints: []
              })
              continue
            }

            // Determine which end is moving
            const isSourceEnd = isSourceMoving

            if (isSourceEnd) {
              // L-shape is first 2 waypoints, anchor is 3rd waypoint or target
              const anchor = waypoints.length > 2
                ? waypoints[2]!
                : targetPos
              const bendX = waypoints[0]?.x ?? sourcePos.x
              const denom = anchor.x - sourcePos.x
              const xRatio = denom !== 0 ? (bendX - sourcePos.x) / denom : 0.5

              initialWireState.current.push({
                wireId: wire.id,
                xRatio: isFinite(xRatio) ? xRatio : 0.5,
                anchorX: anchor.x,
                anchorY: anchor.y,
                isSourceEnd: true,
                remainingWaypoints: waypoints.slice(2)
              })
            } else {
              // L-shape is last 2 waypoints, anchor is 3rd-from-last or source
              const wpLen = waypoints.length
              const anchor = wpLen > 2
                ? waypoints[wpLen - 3]!
                : sourcePos
              const bendX = waypoints[wpLen - 1]?.x ?? targetPos.x
              const denom = anchor.x - targetPos.x
              const xRatio = denom !== 0 ? (bendX - targetPos.x) / denom : 0.5

              initialWireState.current.push({
                wireId: wire.id,
                xRatio: isFinite(xRatio) ? xRatio : 0.5,
                anchorX: anchor.x,
                anchorY: anchor.y,
                isSourceEnd: false,
                remainingWaypoints: waypoints.slice(0, -2)
              })
            }
          }

          const world = screenToWorld(x, y, ui.viewport)
          setDrag({
            type: 'component',
            startX: world.x,
            startY: world.y,
            currentX: world.x,
            currentY: world.y,
          })
        } else if (hit.type === 'wireHandle') {
          // Start dragging a wire handle
          const wire = circuit.wires.find((w) => w.id === hit.wireId)
          if (wire) {
            // Get the current path (either from waypoints or auto-computed)
            // Store the FULL original path including pin positions
            const originalPath = computeWirePath(wire, circuit, customComponents)

            wireHandleDragStart.current = {
              wireId: hit.wireId!,
              handleIndex: hit.handleIndex!,
              originalPath: originalPath,
            }

            const world = screenToWorld(x, y, ui.viewport)
            setDrag({
              type: 'wireHandle',
              startX: world.x,
              startY: world.y,
              currentX: world.x,
              currentY: world.y,
              payload: {
                wireId: hit.wireId,
                handleIndex: hit.handleIndex,
              },
            })
          }
        } else if (hit.type === 'wire') {
          if (!e.shiftKey) {
            clearSelection()
          }
          selectWire(hit.wireId!, e.shiftKey)
        } else {
          // Click on empty space
          if (!e.shiftKey) {
            clearSelection()
          }
          setDrag({
            type: 'marquee',
            startX: x,
            startY: y,
            currentX: x,
            currentY: y,
          })
        }
      }
    },
    [
      getScreenCoords,
      circuit,
      customComponents,
      ui.viewport,
      ui.selection.components,
      ui.selection.wires,
      clearSelection,
      selectComponent,
      selectWire,
      setDrag,
      startWiring,
      addInput,
      addOutput,
      toggleInput,
      removeInput,
      removeOutput,
    ]
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const { x, y } = getScreenCoords(e)

      // Update hover state
      const hit = hitTest(x, y, circuit, ui.viewport, customComponents, ui.selection.wires)
      if (hit.type === 'pin' && hit.componentId !== undefined) {
        setHoveredPin(hit.componentId, hit.pinIndex!)
        setHoveredBoardPin(null, null)
        setHoveredButton(null)
      } else if (hit.type === 'pin' && hit.pinType === 'input-board') {
        setHoveredPin(null, null)
        setHoveredBoardPin(hit.inputId!, null)
        setHoveredButton(null)
      } else if (hit.type === 'pin' && hit.pinType === 'output-board') {
        setHoveredPin(null, null)
        setHoveredBoardPin(null, hit.outputId!)
        setHoveredButton(null)
      } else if (hit.type === 'input-add-button') {
        setHoveredPin(null, null)
        setHoveredBoardPin(null, null)
        setHoveredButton('input-add')
      } else if (hit.type === 'input-remove-button') {
        setHoveredPin(null, null)
        setHoveredBoardPin(null, null)
        setHoveredButton('input-remove')
      } else if (hit.type === 'output-add-button') {
        setHoveredPin(null, null)
        setHoveredBoardPin(null, null)
        setHoveredButton('output-add')
      } else if (hit.type === 'output-remove-button') {
        setHoveredPin(null, null)
        setHoveredBoardPin(null, null)
        setHoveredButton('output-remove')
      } else if (hit.type === 'input-toggle' && hit.inputId !== undefined) {
        setHoveredPin(null, null)
        setHoveredBoardPin(null, null)
        setHoveredButton({ type: 'input-toggle', inputId: hit.inputId })
      } else {
        setHoveredPin(null, null)
        setHoveredBoardPin(null, null)
        setHoveredButton(null)
      }

      // Handle drag
      if (ui.drag.type === 'pan') {
        const dx = x - ui.drag.currentX
        const dy = y - ui.drag.currentY
        pan(dx, dy)
        setDrag({ currentX: x, currentY: y })
      } else if (ui.drag.type === 'component') {
        const world = screenToWorld(x, y, ui.viewport)
        const dx = world.x - ui.drag.startX
        const dy = world.y - ui.drag.startY

        // Check if dragging a board
        if (boardDragStart.current) {
          const newX = snapToGrid(boardDragStart.current.x + dx, GRID_SIZE)
          const newY = snapToGrid(boardDragStart.current.y + dy, GRID_SIZE)
          if (boardDragStart.current.board === 'input') {
            moveInputBoard(newX, newY, boardInitialWireState.current)
          } else {
            moveOutputBoard(newX, newY, boardInitialWireState.current)
          }
        } else {
          // Move all selected components relative to their start positions
          for (const [id, startPos] of dragStartPositions.current) {
            const newX = snapToGrid(startPos.x + dx, GRID_SIZE)
            const newY = snapToGrid(startPos.y + dy, GRID_SIZE)
            moveComponent(id, newX, newY, initialWireState.current)
          }
        }
        setDrag({ currentX: world.x, currentY: world.y })
      } else if (ui.drag.type === 'wireHandle' && wireHandleDragStart.current) {
        const world = screenToWorld(x, y, ui.viewport)
        const dy = world.y - ui.drag.startY
        const dx = world.x - ui.drag.startX

        const { wireId, handleIndex, originalPath } = wireHandleDragStart.current

        // Use the ORIGINAL path stored at drag start, not the current path
        // This ensures consistent segment identification throughout the drag
        if (originalPath.length < 2) return

        // The segment being dragged is between originalPath[handleIndex] and originalPath[handleIndex + 1]
        const p1 = originalPath[handleIndex]
        const p2 = originalPath[handleIndex + 1]
        if (!p1 || !p2) return

        // Determine if segment is horizontal or vertical
        const isHorizontal = Math.abs(p2.y - p1.y) < Math.abs(p2.x - p1.x)

        // Snap the movement to half-grid
        const snappedDelta = isHorizontal
          ? snapToGrid(dy, GRID_STEP)  // Horizontal segments move vertically
          : snapToGrid(dx, GRID_STEP)  // Vertical segments move horizontally

        // Check if endpoints are pins (first and last points in path are always pins)
        const p1IsSourcePin = handleIndex === 0
        const p2IsTargetPin = handleIndex === originalPath.length - 2

        // Original waypoints are all path points except first (source pin) and last (target pin)
        const originalWaypoints = originalPath.slice(1, -1)

        // Build new waypoints based on the three cases
        let newWaypoints: Point[] = []

        if (!p1IsSourcePin && !p2IsTargetPin) {
          // Case 1: Neither endpoint is a pin - move both waypoint endpoints
          const wp1Idx = handleIndex - 1
          const wp2Idx = handleIndex
          newWaypoints = originalWaypoints.map((wp, idx) => {
            if (idx === wp1Idx || idx === wp2Idx) {
              return isHorizontal
                ? { x: wp.x, y: wp.y + snappedDelta }
                : { x: wp.x + snappedDelta, y: wp.y }
            }
            return { ...wp }
          })
        } else if (p1IsSourcePin && p2IsTargetPin) {
          // Case 3: Both endpoints are pins (direct pin-to-pin segment)
          // Insert 4 new points to create a movable segment in the middle
          const sourcePin = originalPath[0]
          const targetPin = originalPath[originalPath.length - 1]
          if (!sourcePin || !targetPin) return

          if (isHorizontal) {
            // Create vertical connectors at 1/3 and 2/3 along the segment
            const x1 = snapToGrid(sourcePin.x + (targetPin.x - sourcePin.x) / 3, GRID_STEP)
            const x2 = snapToGrid(sourcePin.x + (targetPin.x - sourcePin.x) * 2 / 3, GRID_STEP)
            const newY = sourcePin.y + snappedDelta
            newWaypoints = [
              { x: x1, y: sourcePin.y },  // Corner 1: start of vertical at source side
              { x: x1, y: newY },          // Corner 2: end of vertical, start of moved segment
              { x: x2, y: newY },          // Corner 3: end of moved segment, start of vertical
              { x: x2, y: targetPin.y },  // Corner 4: end of vertical at target side
            ]
          } else {
            const y1 = snapToGrid(sourcePin.y + (targetPin.y - sourcePin.y) / 3, GRID_STEP)
            const y2 = snapToGrid(sourcePin.y + (targetPin.y - sourcePin.y) * 2 / 3, GRID_STEP)
            const newX = sourcePin.x + snappedDelta
            newWaypoints = [
              { x: sourcePin.x, y: y1 },
              { x: newX, y: y1 },
              { x: newX, y: y2 },
              { x: targetPin.x, y: y2 },
            ]
          }
        } else if (p1IsSourcePin) {
          // Case 2a: Source pin connected, target is a waypoint
          // Insert 2 new points at 1/3 of segment length from pin to create vertical connector
          const sourcePin = originalPath[0]
          const wp0 = originalWaypoints[0]
          if (!sourcePin || !wp0) return

          if (isHorizontal) {
            const newY = sourcePin.y + snappedDelta
            // Connector at 1/3 of the way from sourcePin to wp0
            const connectorX = snapToGrid(sourcePin.x + (wp0.x - sourcePin.x) / 3, GRID_STEP)

            newWaypoints = [
              { x: connectorX, y: sourcePin.y },  // Corner at pin's Y (end of stub)
              { x: connectorX, y: newY },          // Corner at new Y (start of moved segment)
              // Move wp0 to new Y (rest of first segment)
              { x: wp0.x, y: newY },
              // Keep remaining waypoints unchanged (may create diagonal with wp1)
              ...originalWaypoints.slice(1).map(wp => ({ ...wp })),
            ]
          } else {
            const newX = sourcePin.x + snappedDelta
            // Connector at 1/3 of the way from sourcePin to wp0
            const connectorY = snapToGrid(sourcePin.y + (wp0.y - sourcePin.y) / 3, GRID_STEP)

            newWaypoints = [
              { x: sourcePin.x, y: connectorY },
              { x: newX, y: connectorY },
              { x: newX, y: wp0.y },
              ...originalWaypoints.slice(1).map(wp => ({ ...wp })),
            ]
          }
        } else {
          // Case 2b: Target pin connected, source is a waypoint
          // Insert 2 new points at 1/3 of segment length from pin to create vertical connector
          const targetPin = originalPath[originalPath.length - 1]
          const wpLast = originalWaypoints[originalWaypoints.length - 1]
          if (!targetPin || !wpLast) return

          if (isHorizontal) {
            const newY = targetPin.y + snappedDelta
            // Connector at 1/3 of the way from targetPin back toward wpLast
            const connectorX = snapToGrid(targetPin.x - (targetPin.x - wpLast.x) / 3, GRID_STEP)

            newWaypoints = [
              // Keep all waypoints except last unchanged (may create diagonal with wpLast)
              ...originalWaypoints.slice(0, -1).map(wp => ({ ...wp })),
              // Move wpLast to new Y
              { x: wpLast.x, y: newY },
              // Vertical connector near target
              { x: connectorX, y: newY },
              { x: connectorX, y: targetPin.y },
            ]
          } else {
            const newX = targetPin.x + snappedDelta
            // Connector at 1/3 of the way from targetPin back toward wpLast
            const connectorY = snapToGrid(targetPin.y - (targetPin.y - wpLast.y) / 3, GRID_STEP)

            newWaypoints = [
              ...originalWaypoints.slice(0, -1).map(wp => ({ ...wp })),
              { x: newX, y: wpLast.y },
              { x: newX, y: connectorY },
              { x: targetPin.x, y: connectorY },
            ]
          }
        }

        updateWireWaypoints(wireId, newWaypoints)
        setDrag({ currentX: world.x, currentY: world.y })
      } else if (ui.drag.type === 'marquee') {
        setDrag({ currentX: x, currentY: y })
      } else if (ui.wiring.active) {
        setDrag({ currentX: x, currentY: y })
      }
    },
    [getScreenCoords, circuit, customComponents, ui.viewport, ui.drag, ui.wiring.active, ui.selection.wires, pan, setDrag, setHoveredPin, setHoveredBoardPin, setHoveredButton, moveComponent, moveInputBoard, moveOutputBoard, updateWireWaypoints]
  )

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      const { x, y } = getScreenCoords(e)

      // Only handle wiring on left-click (button 0), not right-click (button 2)
      if (ui.wiring.active && e.button === 0) {
        const hit = hitTest(x, y, circuit, ui.viewport, customComponents, ui.selection.wires)
        if (hit.type === 'pin') {
          if (hit.pinType === 'input-board') {
            completeWiring({ type: 'input', inputId: hit.inputId! })
          } else if (hit.pinType === 'output-board') {
            completeWiring({ type: 'output', outputId: hit.outputId! })
          } else {
            completeWiring({
              type: 'component',
              componentId: hit.componentId!,
              pinIndex: hit.pinIndex!,
              pinType: hit.pinType as 'input' | 'output',
            })
          }
        } else {
          cancelWiring()
        }
      }

      // Handle marquee selection
      if (ui.drag.type === 'marquee') {
        // Convert marquee bounds from screen to world coordinates
        const start = screenToWorld(ui.drag.startX, ui.drag.startY, ui.viewport)
        const end = screenToWorld(ui.drag.currentX, ui.drag.currentY, ui.viewport)

        // Calculate bounding box (handle drag in any direction)
        const minX = Math.min(start.x, end.x)
        const maxX = Math.max(start.x, end.x)
        const minY = Math.min(start.y, end.y)
        const maxY = Math.max(start.y, end.y)

        // Select all components that intersect with the marquee
        for (const component of circuit.components) {
          const def = getComponentDefinition(component.type, customComponents)
          if (!def) continue

          const halfW = def.width / 2
          const halfH = def.height / 2

          // Check if component bounds intersect with marquee bounds
          const compMinX = component.x - halfW
          const compMaxX = component.x + halfW
          const compMinY = component.y - halfH
          const compMaxY = component.y + halfH

          const intersects =
            compMinX <= maxX &&
            compMaxX >= minX &&
            compMinY <= maxY &&
            compMaxY >= minY

          if (intersects) {
            selectComponent(component.id, true)
          }
        }
      }

      // Simplify wire path on mouse up after handle drag
      if (ui.drag.type === 'wireHandle' && wireHandleDragStart.current) {
        const { wireId } = wireHandleDragStart.current
        const wire = circuit.wires.find((w) => w.id === wireId)
        if (wire) {
          // Get the full path (including pin positions)
          const fullPath = computeWirePath(wire, circuit, customComponents)
          // Simplify the full path to remove collinear points
          const simplifiedPath = simplifyPath(fullPath)
          // Extract waypoints (remove first and last which are pin positions)
          const newWaypoints = pathToWaypoints(simplifiedPath)

          // Update if waypoints changed
          const currentWaypoints = wire.waypoints || []
          if (newWaypoints.length !== currentWaypoints.length ||
              newWaypoints.some((wp, i) =>
                wp.x !== currentWaypoints[i]?.x || wp.y !== currentWaypoints[i]?.y)) {
            updateWireWaypoints(wireId, newWaypoints)
          }
        }
      }

      // Simplify wire paths after component drag
      if (ui.drag.type === 'component' && dragStartPositions.current.size > 0) {
        // Find all wires connected to dragged components that have custom waypoints
        const draggedComponentIds = new Set(dragStartPositions.current.keys())
        for (const wire of circuit.wires) {
          if (!wire.waypoints || wire.waypoints.length === 0) continue

          const isSourceConnected = wire.source.type === 'component' && draggedComponentIds.has(wire.source.componentId)
          const isTargetConnected = wire.target.type === 'component' && draggedComponentIds.has(wire.target.componentId)

          if (isSourceConnected || isTargetConnected) {
            const fullPath = computeWirePath(wire, circuit, customComponents)
            const simplifiedPath = simplifyPath(fullPath)
            const newWaypoints = pathToWaypoints(simplifiedPath)

            const currentWaypoints = wire.waypoints || []
            if (newWaypoints.length !== currentWaypoints.length ||
                newWaypoints.some((wp, i) =>
                  wp.x !== currentWaypoints[i]?.x || wp.y !== currentWaypoints[i]?.y)) {
              updateWireWaypoints(wire.id, newWaypoints)
            }
          }
        }
      }

      // Simplify wire paths after board drag
      if (ui.drag.type === 'component' && boardDragStart.current) {
        const boardType = boardDragStart.current.board
        for (const wire of circuit.wires) {
          if (!wire.waypoints || wire.waypoints.length === 0) continue

          const isConnected =
            (boardType === 'input' && wire.source.type === 'input') ||
            (boardType === 'output' && wire.target.type === 'output')

          if (isConnected) {
            const fullPath = computeWirePath(wire, circuit, customComponents)
            const simplifiedPath = simplifyPath(fullPath)
            const newWaypoints = pathToWaypoints(simplifiedPath)

            const currentWaypoints = wire.waypoints || []
            if (newWaypoints.length !== currentWaypoints.length ||
                newWaypoints.some((wp, i) =>
                  wp.x !== currentWaypoints[i]?.x || wp.y !== currentWaypoints[i]?.y)) {
              updateWireWaypoints(wire.id, newWaypoints)
            }
          }
        }
      }

      // Only reset drag state on left-click or when not wiring
      // Right-click during wiring should preserve preview coordinates
      if (e.button === 0 || !ui.wiring.active) {
        dragStartPositions.current.clear()
        boardDragStart.current = null
        wireHandleDragStart.current = null
        resetDrag()
      }
    },
    [getScreenCoords, circuit, customComponents, ui.viewport, ui.drag, ui.wiring.active, ui.selection.wires, completeWiring, cancelWiring, resetDrag, selectComponent, updateWireWaypoints]
  )

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault()
      const { x, y } = getScreenCoords(e)
      const factor = e.deltaY > 0 ? 0.9 : 1.1
      zoom(factor, x, y)
    },
    [getScreenCoords, zoom]
  )

  // Handle double-click for label editing
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const { x, y } = getScreenCoords(e)
      const hit = hitTest(x, y, circuit, ui.viewport, customComponents, ui.selection.wires)

      if (hit.type === 'input-label' && hit.inputId !== undefined) {
        const input = circuit.inputs.find((i) => i.id === hit.inputId)
        if (input) {
          // Store world position of the label
          const pinWorldY = circuit.inputBoard.y + PIN_START_Y + input.order * PIN_SPACING
          setLabelEdit({
            type: 'input',
            id: hit.inputId,
            label: input.label,
            worldX: circuit.inputBoard.x,
            worldY: pinWorldY,
          })
        }
      } else if (hit.type === 'output-label' && hit.outputId !== undefined) {
        const output = circuit.outputs.find((o) => o.id === hit.outputId)
        if (output) {
          // Store world position of the label
          const pinWorldY = circuit.outputBoard.y + PIN_START_Y + output.order * PIN_SPACING
          setLabelEdit({
            type: 'output',
            id: hit.outputId,
            label: output.label,
            worldX: circuit.outputBoard.x,
            worldY: pinWorldY,
          })
        }
      }
    },
    [getScreenCoords, circuit, customComponents, ui.viewport, ui.selection.wires]
  )

  // Handle label edit completion
  const handleLabelEditComplete = useCallback(() => {
    if (!labelEdit) return
    const trimmedLabel = labelEdit.label.trim()
    if (trimmedLabel) {
      if (labelEdit.type === 'input') {
        renameInput(labelEdit.id as InputId, trimmedLabel)
      } else {
        renameOutput(labelEdit.id as OutputId, trimmedLabel)
      }
    }
    setLabelEdit(null)
  }, [labelEdit, renameInput, renameOutput])

  // Handle label edit cancellation
  const handleLabelEditCancel = useCallback(() => {
    setLabelEdit(null)
  }, [])

  // Handle multi-bit value edit completion
  const handleMultiBitEditComplete = useCallback(() => {
    if (!multiBitEdit) return
    const valueStr = multiBitEdit.value.replace(/[^01]/g, '') // Only allow 0 and 1
    const boolArray: boolean[] = []
    // Parse binary string (MSB first in input) to boolean array (LSB at index 0)
    for (let i = valueStr.length - 1; i >= 0; i--) {
      boolArray.push(valueStr[i] === '1')
    }
    // Pad or truncate to match bit width
    while (boolArray.length < multiBitEdit.bitWidth) {
      boolArray.push(false)
    }
    if (boolArray.length > multiBitEdit.bitWidth) {
      boolArray.length = multiBitEdit.bitWidth
    }
    setInputValue(multiBitEdit.inputId, boolArray)
    setMultiBitEdit(null)
  }, [multiBitEdit, setInputValue])

  // Handle multi-bit value edit cancellation
  const handleMultiBitEditCancel = useCallback(() => {
    setMultiBitEdit(null)
  }, [])

  // Handle context menu (right-click) for adding/removing waypoints during wire creation
  // or for showing bit width menu on input pins
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const { x, y } = getScreenCoords(e)

      // If not wiring, check if right-clicking on an input pin to show bit width menu
      if (!ui.wiring.active) {
        const hit = hitTest(x, y, circuit, ui.viewport, customComponents, ui.selection.wires)
        if (hit.type === 'pin' && hit.pinType === 'input-board' && hit.inputId !== undefined) {
          showContextMenu({
            type: 'input-bitwidth',
            inputId: hit.inputId,
            screenX: e.clientX,
            screenY: e.clientY,
          })
          return
        }
        return
      }

      const world = screenToWorld(x, y, ui.viewport)

      // Update drag coordinates so the preview uses the correct end position
      setDrag({ currentX: x, currentY: y })

      // Check if click is near an existing waypoint
      for (let i = 0; i < wiringWaypoints.length; i++) {
        const wp = wiringWaypoints[i]
        if (!wp) continue
        const dx = world.x - wp.x
        const dy = world.y - wp.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist <= WAYPOINT_HIT_RADIUS) {
          // Remove this waypoint
          removeWiringWaypoint(i)
          return
        }
      }

      // No waypoint hit - add new waypoint (snapped to grid)
      const snappedX = snapToGrid(world.x, GRID_SIZE)
      const snappedY = snapToGrid(world.y, GRID_SIZE)
      addWiringWaypoint({ x: snappedX, y: snappedY })
    },
    [ui.wiring.active, ui.viewport, ui.selection.wires, circuit, customComponents, getScreenCoords, wiringWaypoints, addWiringWaypoint, removeWiringWaypoint, setDrag, showContextMenu]
  )

  // Handle drop from palette
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const canvas = canvasRef.current
      if (!canvas) return

      // Try new format first, fall back to old format for backwards compatibility
      const componentType = (e.dataTransfer.getData('componentType') ||
        e.dataTransfer.getData('gateType')) as ComponentType
      if (!componentType) return

      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      const world = screenToWorld(x, y, ui.viewport)
      const snappedX = snapToGrid(world.x, GRID_SIZE)
      const snappedY = snapToGrid(world.y, GRID_SIZE)

      addComponent(componentType, snappedX, snappedY)
      resetDrag()
    },
    [ui.viewport, addComponent, resetDrag]
  )

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  // Keyboard handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (document.activeElement?.tagName !== 'INPUT') {
          e.preventDefault()
          deleteSelected()
        }
      } else if (e.key === 'Escape') {
        cancelWiring()
        clearSelection()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [deleteSelected, cancelWiring, clearSelection])

  return (
    <div
      ref={containerRef}
      className="canvas-container"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
      />
      {labelEdit && (() => {
        const screen = worldToScreen(labelEdit.worldX, labelEdit.worldY, ui.viewport)
        const scale = ui.viewport.zoom
        const labelBoxWidth = 52 * scale
        const labelBoxHeight = 14 * scale
        const isInput = labelEdit.type === 'input'
        // Input: box starts at screen.x - 20, Output: box starts at screen.x - 32
        const labelBoxX = isInput ? screen.x - 20 * scale : screen.x - 32 * scale
        return (
          <input
            ref={labelInputRef}
            type="text"
            className="label-edit-input"
            value={labelEdit.label}
            onChange={(e) => setLabelEdit({ ...labelEdit, label: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleLabelEditComplete()
              } else if (e.key === 'Escape') {
                handleLabelEditCancel()
              }
            }}
            onBlur={handleLabelEditComplete}
            style={{
              left: labelBoxX,
              top: screen.y - labelBoxHeight / 2,
              transform: 'none',
              width: `${labelBoxWidth}px`,
              height: `${labelBoxHeight}px`,
              fontSize: `${9 * scale}px`,
              padding: `0 ${3 * scale}px`,
              borderRadius: `${2 * scale}px`,
              textAlign: isInput ? 'left' : 'right',
            }}
          />
        )
      })()}
      {multiBitEdit && (
        <MultiBitInputOverlay
          multiBitEdit={multiBitEdit}
          viewport={ui.viewport}
          inputRef={multiBitInputRef}
          onChange={(value) => setMultiBitEdit({ ...multiBitEdit, value })}
          onComplete={handleMultiBitEditComplete}
          onCancel={handleMultiBitEditCancel}
        />
      )}
      {contextMenu && contextMenu.type === 'input-bitwidth' && (() => {
        const input = circuit.inputs.find((i) => i.id === contextMenu.inputId)
        if (!input) return null
        return (
          <BitWidthContextMenu
            inputId={contextMenu.inputId}
            screenX={contextMenu.screenX}
            screenY={contextMenu.screenY}
            initialBitWidth={input.bitWidth}
            onClose={hideContextMenu}
          />
        )
      })()}
    </div>
  )
}
