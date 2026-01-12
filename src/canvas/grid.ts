import type { Viewport } from '../types'

export const GRID_SIZE = 20
export const GRID_COLOR = '#1e293b'
export const GRID_COLOR_MAJOR = '#334155'

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  width: number,
  height: number
) {
  const { panX, panY, zoom } = viewport
  const scaledGridSize = GRID_SIZE * zoom

  // Don't draw grid if too zoomed out
  if (scaledGridSize < 5) return

  ctx.strokeStyle = GRID_COLOR
  ctx.lineWidth = 1

  // Calculate visible area in screen coordinates
  const startX = Math.floor(-panX / scaledGridSize) * scaledGridSize + (panX % scaledGridSize)
  const startY = Math.floor(-panY / scaledGridSize) * scaledGridSize + (panY % scaledGridSize)

  // Calculate the starting grid line index based on where startX/startY actually are
  const startGridX = Math.round((startX - panX) / zoom / GRID_SIZE)
  const startGridY = Math.round((startY - panY) / zoom / GRID_SIZE)

  // Draw vertical lines
  let gridIndexX = startGridX
  for (let x = startX; x < width; x += scaledGridSize) {
    const isMajor = gridIndexX % 5 === 0

    ctx.strokeStyle = isMajor ? GRID_COLOR_MAJOR : GRID_COLOR
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
    ctx.stroke()
    gridIndexX++
  }

  // Draw horizontal lines
  let gridIndexY = startGridY
  for (let y = startY; y < height; y += scaledGridSize) {
    const isMajor = gridIndexY % 5 === 0

    ctx.strokeStyle = isMajor ? GRID_COLOR_MAJOR : GRID_COLOR
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
    gridIndexY++
  }
}

export function screenToWorld(
  screenX: number,
  screenY: number,
  viewport: Viewport
): { x: number; y: number } {
  return {
    x: (screenX - viewport.panX) / viewport.zoom,
    y: (screenY - viewport.panY) / viewport.zoom,
  }
}

export function worldToScreen(
  worldX: number,
  worldY: number,
  viewport: Viewport
): { x: number; y: number } {
  return {
    x: worldX * viewport.zoom + viewport.panX,
    y: worldY * viewport.zoom + viewport.panY,
  }
}

export function snapToGrid(value: number, gridSize: number = GRID_SIZE): number {
  return Math.round(value / gridSize) * gridSize
}
