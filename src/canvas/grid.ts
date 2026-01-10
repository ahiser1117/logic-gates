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

  // Calculate visible area in world coordinates
  const startX = Math.floor(-panX / scaledGridSize) * scaledGridSize + (panX % scaledGridSize)
  const startY = Math.floor(-panY / scaledGridSize) * scaledGridSize + (panY % scaledGridSize)

  // Draw vertical lines
  for (let x = startX; x < width; x += scaledGridSize) {
    const worldX = (x - panX) / zoom
    const isMajor = Math.abs(worldX % (GRID_SIZE * 5)) < 1

    ctx.strokeStyle = isMajor ? GRID_COLOR_MAJOR : GRID_COLOR
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
    ctx.stroke()
  }

  // Draw horizontal lines
  for (let y = startY; y < height; y += scaledGridSize) {
    const worldY = (y - panY) / zoom
    const isMajor = Math.abs(worldY % (GRID_SIZE * 5)) < 1

    ctx.strokeStyle = isMajor ? GRID_COLOR_MAJOR : GRID_COLOR
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
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
