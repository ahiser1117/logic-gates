import type { PinDefinition } from '../types'

const MIN_WIDTH = 60
const MAX_WIDTH = 120
const GRID_SIZE = 20

export interface PinLayoutResult {
  width: number
  height: number
  pins: PinDefinition[]
}

function computeWidth(name: string): number {
  // Estimate text width: bold 12px sans-serif is roughly 7-8px per character
  // Add pin radius (8px) on each side plus padding (4px total)
  const charWidth = 7.5
  const textWidth = name.length * charWidth
  const requiredWidth = textWidth + 2 * 8 + 4 // text + pins + padding

  // Round up to nearest grid size, clamp to min/max
  const rounded = Math.ceil(requiredWidth / GRID_SIZE) * GRID_SIZE
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, rounded))
}

export function computePinLayout(
  inputCount: number,
  outputCount: number,
  inputLabels?: string[],
  outputLabels?: string[],
  componentName?: string
): PinLayoutResult {
  const width = componentName ? computeWidth(componentName) : MIN_WIDTH

  // Height formula: max(n_inputs, n_outputs) * 20 + 20 (matches NAND behavior)
  const maxPins = Math.max(inputCount, outputCount, 1)
  const height = maxPins * 20 + 20

  // Distribute pins evenly within available height (leaving 10px padding top/bottom)
  const availableHeight = height - 20
  const inputSpacing = inputCount > 1 ? availableHeight / (inputCount - 1) : 0
  const outputSpacing = outputCount > 1 ? availableHeight / (outputCount - 1) : 0

  const inputStartY = -((inputCount - 1) * inputSpacing) / 2
  const outputStartY = -((outputCount - 1) * outputSpacing) / 2

  const pins: PinDefinition[] = []

  // Input pins on left
  for (let i = 0; i < inputCount; i++) {
    pins.push({
      index: i,
      name: inputLabels?.[i] ?? `I${i}`,
      direction: 'input',
      offsetX: -width / 2,
      offsetY: inputStartY + i * inputSpacing,
    })
  }

  // Output pins on right
  for (let i = 0; i < outputCount; i++) {
    pins.push({
      index: inputCount + i,
      name: outputLabels?.[i] ?? `O${i}`,
      direction: 'output',
      offsetX: width / 2,
      offsetY: outputStartY + i * outputSpacing,
    })
  }

  return { width, height, pins }
}
