import type { PinDefinition } from '../types'

const PIN_SPACING = 40
const MIN_HEIGHT = 60
const PADDING = 20
const WIDTH = 80

export interface PinLayoutResult {
  width: number
  height: number
  pins: PinDefinition[]
}

export function computePinLayout(
  inputCount: number,
  outputCount: number,
  inputLabels?: string[],
  outputLabels?: string[]
): PinLayoutResult {
  const maxPins = Math.max(inputCount, outputCount, 1)
  const height = Math.max(MIN_HEIGHT, (maxPins - 1) * PIN_SPACING + PADDING * 2)

  const inputStartY = -((inputCount - 1) * PIN_SPACING) / 2
  const outputStartY = -((outputCount - 1) * PIN_SPACING) / 2

  const pins: PinDefinition[] = []

  // Input pins on left
  for (let i = 0; i < inputCount; i++) {
    pins.push({
      index: i,
      name: inputLabels?.[i] ?? `I${i}`,
      direction: 'input',
      offsetX: -WIDTH / 2,
      offsetY: inputStartY + i * PIN_SPACING,
    })
  }

  // Output pins on right
  for (let i = 0; i < outputCount; i++) {
    pins.push({
      index: inputCount + i,
      name: outputLabels?.[i] ?? `O${i}`,
      direction: 'output',
      offsetX: WIDTH / 2,
      offsetY: outputStartY + i * PIN_SPACING,
    })
  }

  return { width: WIDTH, height, pins }
}
