import type { PinDefinition, SplitMergeConfig } from '../types'

const MIN_WIDTH = 60
const MAX_WIDTH = 120
const GRID_SIZE = 20
const PIN_SPACING = GRID_SIZE * 2 // 40px - double grid spacing

export interface PinLayoutResult {
  width: number
  height: number
  pins: PinDefinition[]
}

function calculateSplitMergeHeight(partitionCount: number): number {
  // Height based on partition count (BUS pin is centered vertically)
  // Height = pin span + half-grid padding, minimum 2*GRID_SIZE
  const partitions = Math.max(1, partitionCount)
  const pinSpan = (partitions - 1) * PIN_SPACING
  return Math.max(GRID_SIZE * 2, pinSpan + GRID_SIZE)
}

function calculateSplitMergeWidth(): number {
  return 3 * GRID_SIZE
}

export function computeSplitMergePinLayout(config: SplitMergeConfig): PinLayoutResult {
  const partitions = config.partitions.length
  const height = calculateSplitMergeHeight(partitions)
  const width = calculateSplitMergeWidth()

  // Center-aligned pin positioning with double grid spacing
  const partitionStartY = -((partitions - 1) * PIN_SPACING) / 2

  const pins: PinDefinition[] = []

  // BUS pin centered vertically
  pins.push({
    index: 0,
    name: 'BUS',
    direction: config.mode === 'merge' ? 'output' : 'input',
    offsetX: config.mode === 'merge' ? width / 2 : -width / 2,
    offsetY: 0,
    bitWidth: config.partitions.reduce((sum, size) => sum + size, 0),
  })

  // Partition pins center-aligned
  for (let i = 0; i < partitions; i++) {
    pins.push({
      index: i + 1,
      name: `P${i}`,
      direction: config.mode === 'merge' ? 'input' : 'output',
      offsetX: config.mode === 'merge' ? -width / 2 : width / 2,
      offsetY: partitionStartY + i * PIN_SPACING,
      bitWidth: config.partitions[i],
    })
  }

  return { width, height, pins }
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

  // Height: pin span + half-grid padding, minimum 2*GRID_SIZE
  const maxPins = Math.max(inputCount, outputCount, 1)
  const pinSpan = (maxPins - 1) * PIN_SPACING
  const height = Math.max(GRID_SIZE * 2, pinSpan + GRID_SIZE)

  // Center-aligned pin positioning with double grid spacing
  const inputStartY = -((inputCount - 1) * PIN_SPACING) / 2
  const outputStartY = -((outputCount - 1) * PIN_SPACING) / 2

  const pins: PinDefinition[] = []

  // Input pins on left (center-aligned)
  for (let i = 0; i < inputCount; i++) {
    pins.push({
      index: i,
      name: inputLabels?.[i] ?? `I${i}`,
      direction: 'input',
      offsetX: -width / 2,
      offsetY: inputStartY + i * PIN_SPACING,
    })
  }

  // Output pins on right (center-aligned)
  for (let i = 0; i < outputCount; i++) {
    pins.push({
      index: inputCount + i,
      name: outputLabels?.[i] ?? `O${i}`,
      direction: 'output',
      offsetX: width / 2,
      offsetY: outputStartY + i * PIN_SPACING,
    })
  }

  return { width, height, pins }
}
