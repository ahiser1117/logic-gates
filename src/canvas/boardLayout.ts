import type { Circuit } from '../types'

// Grid size for snapping board width
const GRID_SIZE = 20

// Base board width (for 1-4 bit values)
// This is also the reference width for board position - pins are at boardX +/- BASE_BOARD_WIDTH/2
export const BASE_BOARD_WIDTH = 100

// Minimum width needed per bit in binary display (monospace font)
const PIXELS_PER_BIT = 7

// Padding for the value display
const VALUE_DISPLAY_PADDING = 12

// Fixed layout positions relative to board center
export const BOARD_HEADER_HEIGHT = 40
export const PIN_SPACING = 40
export const PIN_START_Y = 40

// Header button offset from center
export const HEADER_BUTTON_OFFSET = 34

// Multi-row display constants (for bitWidth > 8)
export const BITS_PER_ROW = 8
export const BIT_ROW_HEIGHT = 10  // Vertical spacing between row centers
export const MULTI_ROW_PADDING = 2  // Top/bottom padding inside multi-row container

/**
 * Get the number of rows needed for a given bit width
 */
export function getRowCount(bitWidth: number): number {
  if (bitWidth <= BITS_PER_ROW) return 1
  return Math.ceil(bitWidth / BITS_PER_ROW)
}

/**
 * Get the height of a multi-row display
 * Single row (1-8 bits): 14px
 * Multi-row: rowCount * BIT_ROW_HEIGHT + 2 * MULTI_ROW_PADDING
 */
export function getMultiRowDisplayHeight(bitWidth: number): number {
  const rowCount = getRowCount(bitWidth)
  if (rowCount <= 1) return 14
  return rowCount * BIT_ROW_HEIGHT + 2 * MULTI_ROW_PADDING
}

/**
 * Get the width of a multi-row display (capped at BITS_PER_ROW bits)
 */
export function getMultiRowDisplayWidth(bitWidth: number): number {
  const bitsInWidestRow = Math.min(bitWidth, BITS_PER_ROW)
  return bitsInWidestRow * PIXELS_PER_BIT + VALUE_DISPLAY_PADDING
}

/**
 * Calculate the width needed for a multi-bit value display
 * Now caps at BITS_PER_ROW bits for multi-row support
 */
function getValueDisplayWidth(bitWidth: number): number {
  if (bitWidth <= 1) return 28 // Single-bit toggle size
  // Cap at BITS_PER_ROW bits - wider values wrap to multiple rows
  const effectiveBits = Math.min(bitWidth, BITS_PER_ROW)
  return effectiveBits * PIXELS_PER_BIT + VALUE_DISPLAY_PADDING
}

/**
 * Calculate the board width based on maximum bit width.
 * Returns width rounded to grid size.
 * For bitWidth > 8, width is capped at 8-bit width (uses multi-row display).
 */
export function calculateBoardWidth(maxBitWidth: number): number {
  if (maxBitWidth <= 4) {
    return BASE_BOARD_WIDTH
  }

  // Cap at BITS_PER_ROW - wider values use multi-row display
  const effectiveBitWidth = Math.min(maxBitWidth, BITS_PER_ROW)

  // For larger bit widths, we need more space
  // Layout: [pin] [label ~52px] [gap] [value display] [edge]
  // The value display is at 34px from center, so we need:
  // halfWidth = 34 + displayWidth/2 + some padding
  const displayWidth = getValueDisplayWidth(effectiveBitWidth)
  const neededHalfWidth = HEADER_BUTTON_OFFSET + displayWidth / 2 + 10

  // Full width, rounded up to grid size
  const fullWidth = neededHalfWidth * 2
  return Math.ceil(fullWidth / GRID_SIZE) * GRID_SIZE
}

/**
 * Get the maximum bit width among all inputs in a circuit
 */
export function getMaxInputBitWidth(circuit: Circuit): number {
  if (circuit.inputs.length === 0) return 1
  return Math.max(...circuit.inputs.map(input => input.bitWidth ?? 1))
}

/**
 * Get the maximum bit width among all outputs in a circuit
 */
export function getMaxOutputBitWidth(circuit: Circuit): number {
  if (circuit.outputs.length === 0) return 1
  return Math.max(...circuit.outputs.map(output => output.bitWidth ?? 1))
}

/**
 * Get the input board width for a circuit
 */
export function getInputBoardWidth(circuit: Circuit): number {
  return calculateBoardWidth(getMaxInputBitWidth(circuit))
}

/**
 * Get the output board width for a circuit
 */
export function getOutputBoardWidth(circuit: Circuit): number {
  return calculateBoardWidth(getMaxOutputBitWidth(circuit))
}

/**
 * Get layout positions for elements within a board.
 * All positions are relative to board center (boardX, boardY).
 */
export function getBoardLayout(boardWidth: number) {
  const halfWidth = boardWidth / 2

  return {
    // Pin position (at board edge)
    pinOffset: halfWidth,

    // Toggle/value display offset from center
    // For wider boards, move it further out to maintain spacing
    toggleOffset: Math.max(34, halfWidth - 16),

    // Label area (between center and pin)
    labelStart: -20,
    labelWidth: Math.max(52, halfWidth - 30),

    // Header buttons (scale with board width for wider boards)
    headerButtonOffset: Math.min(34, halfWidth - 16),
  }
}
