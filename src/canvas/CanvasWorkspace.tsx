import { useRef, useEffect, useCallback, useState } from 'react'
import { useStore } from '../store'
import { useSimulation } from '../hooks/useSimulation'
import { renderFrame } from './renderer'
import { hitTest } from './hitTest'
import { screenToWorld, worldToScreen, snapToGrid } from './grid'
import { getComponentDefinition } from '../simulation'
import type { ComponentType, ComponentId, InputId, OutputId } from '../types'
import './CanvasWorkspace.css'

const GRID_SIZE = 20
const PIN_START_Y = 40
const PIN_SPACING = 40

interface LabelEdit {
  type: 'input' | 'output'
  id: InputId | OutputId
  label: string
  screenX: number
  screenY: number
}

export function CanvasWorkspace() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragStartPositions = useRef<Map<ComponentId, { x: number; y: number }>>(new Map())
  const boardDragStart = useRef<{ board: 'input' | 'output'; x: number; y: number } | null>(null)
  const [labelEdit, setLabelEdit] = useState<LabelEdit | null>(null)
  const labelInputRef = useRef<HTMLInputElement>(null)

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

  // Focus label input when editing starts
  useEffect(() => {
    if (labelEdit && labelInputRef.current) {
      labelInputRef.current.focus()
      labelInputRef.current.select()
    }
  }, [labelEdit?.id])

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
        const hit = hitTest(x, y, circuit, ui.viewport, customComponents)

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

        // Handle input toggle
        if (hit.type === 'input-toggle' && hit.inputId !== undefined) {
          toggleInput(hit.inputId)
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

          const world = screenToWorld(x, y, ui.viewport)
          setDrag({
            type: 'component',
            startX: world.x,
            startY: world.y,
            currentX: world.x,
            currentY: world.y,
          })
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
      const hit = hitTest(x, y, circuit, ui.viewport, customComponents)
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
            moveInputBoard(newX, newY)
          } else {
            moveOutputBoard(newX, newY)
          }
        } else {
          // Move all selected components relative to their start positions
          for (const [id, startPos] of dragStartPositions.current) {
            const newX = snapToGrid(startPos.x + dx, GRID_SIZE)
            const newY = snapToGrid(startPos.y + dy, GRID_SIZE)
            moveComponent(id, newX, newY)
          }
        }
        setDrag({ currentX: world.x, currentY: world.y })
      } else if (ui.drag.type === 'marquee') {
        setDrag({ currentX: x, currentY: y })
      } else if (ui.wiring.active) {
        setDrag({ currentX: x, currentY: y })
      }
    },
    [getScreenCoords, circuit, customComponents, ui.viewport, ui.drag, ui.wiring.active, pan, setDrag, setHoveredPin, setHoveredBoardPin, setHoveredButton, moveComponent, moveInputBoard, moveOutputBoard]
  )

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      const { x, y } = getScreenCoords(e)

      if (ui.wiring.active) {
        const hit = hitTest(x, y, circuit, ui.viewport, customComponents)
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

      dragStartPositions.current.clear()
      boardDragStart.current = null
      resetDrag()
    },
    [getScreenCoords, circuit, customComponents, ui.viewport, ui.drag, ui.wiring.active, completeWiring, cancelWiring, resetDrag, selectComponent]
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
      const hit = hitTest(x, y, circuit, ui.viewport, customComponents)

      if (hit.type === 'input-label' && hit.inputId !== undefined) {
        const input = circuit.inputs.find((i) => i.id === hit.inputId)
        if (input) {
          // Calculate screen position of the label
          const pinWorldY = circuit.inputBoard.y + PIN_START_Y + input.order * PIN_SPACING
          const screen = worldToScreen(circuit.inputBoard.x, pinWorldY, ui.viewport)
          setLabelEdit({
            type: 'input',
            id: hit.inputId,
            label: input.label,
            screenX: screen.x,
            screenY: screen.y,
          })
        }
      } else if (hit.type === 'output-label' && hit.outputId !== undefined) {
        const output = circuit.outputs.find((o) => o.id === hit.outputId)
        if (output) {
          // Calculate screen position of the label
          const pinWorldY = circuit.outputBoard.y + PIN_START_Y + output.order * PIN_SPACING
          const screen = worldToScreen(circuit.outputBoard.x, pinWorldY, ui.viewport)
          setLabelEdit({
            type: 'output',
            id: hit.outputId,
            label: output.label,
            screenX: screen.x,
            screenY: screen.y,
          })
        }
      }
    },
    [getScreenCoords, circuit, customComponents, ui.viewport]
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
        onContextMenu={(e) => e.preventDefault()}
      />
      {labelEdit && (
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
            left: labelEdit.screenX,
            top: labelEdit.screenY,
          }}
        />
      )}
    </div>
  )
}
