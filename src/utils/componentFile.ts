import { isPrimitiveGate } from '../types'
import type {
  CustomComponentDefinition,
  CustomComponentId,
  ComponentFileFormat,
} from '../types'

/**
 * Collect all transitive custom-component dependencies of the given IDs
 * in topological order (post-order DFS — dependencies before dependents).
 */
export function collectDependencies(
  ids: CustomComponentId[],
  customComponents: Map<CustomComponentId, CustomComponentDefinition>
): CustomComponentId[] {
  const ordered: CustomComponentId[] = []
  const visited = new Set<CustomComponentId>()

  const visit = (id: CustomComponentId) => {
    if (visited.has(id)) return
    visited.add(id)

    const def = customComponents.get(id)
    if (!def) return

    // Visit dependencies first (post-order)
    for (const comp of def.circuit.components) {
      if (!isPrimitiveGate(comp.type)) {
        visit(comp.type as CustomComponentId)
      }
    }

    ordered.push(id)
  }

  for (const id of ids) {
    visit(id)
  }

  return ordered
}

/**
 * Build an export payload for the given component IDs,
 * automatically including all transitive dependencies.
 */
export function buildExportPayload(
  ids: CustomComponentId[],
  customComponents: Map<CustomComponentId, CustomComponentDefinition>
): ComponentFileFormat {
  const orderedIds = collectDependencies(ids, customComponents)
  const components: CustomComponentDefinition[] = []

  for (const id of orderedIds) {
    const def = customComponents.get(id)
    if (def) {
      components.push(def)
    }
  }

  return {
    format: 'logic-gate-components',
    version: 1,
    exportedAt: Date.now(),
    components,
  }
}

/**
 * Trigger a browser download of the payload as a .lgc file.
 */
export function downloadComponentFile(payload: ComponentFileFormat, filename: string): void {
  const json = JSON.stringify(payload, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.lgc') ? filename : `${filename}.lgc`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Read and validate a .lgc File object. Returns the parsed payload or throws.
 */
export async function readComponentFile(file: File): Promise<ComponentFileFormat> {
  const text = await file.text()

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('File is not valid JSON')
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('File does not contain a valid object')
  }

  const obj = parsed as Record<string, unknown>

  if (obj.format !== 'logic-gate-components') {
    throw new Error('File is not a Logic Gate component file (missing or invalid format field)')
  }

  if (obj.version !== 1) {
    throw new Error(`Unsupported file version: ${obj.version}`)
  }

  if (!Array.isArray(obj.components) || obj.components.length === 0) {
    throw new Error('File contains no components')
  }

  // Validate each component has required fields
  for (const comp of obj.components) {
    if (typeof comp !== 'object' || comp === null) {
      throw new Error('File contains an invalid component entry')
    }
    const c = comp as Record<string, unknown>
    if (typeof c.id !== 'string' || !c.id) {
      throw new Error('Component is missing a valid id')
    }
    if (typeof c.name !== 'string' || !c.name) {
      throw new Error(`Component "${c.id}" is missing a valid name`)
    }
    if (typeof c.circuit !== 'object' || c.circuit === null) {
      throw new Error(`Component "${c.name}" is missing circuit data`)
    }
    if (!Array.isArray(c.pins)) {
      throw new Error(`Component "${c.name}" is missing pin definitions`)
    }
  }

  return parsed as ComponentFileFormat
}

export interface NameConflict {
  incoming: CustomComponentDefinition
  existingId: CustomComponentId
}

export interface ImportResolution {
  newComponents: CustomComponentDefinition[]
  skippedCount: number
  skippedNames: string[]
  nameConflicts: NameConflict[]
}

/**
 * Compare payload components against the existing library.
 * - Same ID already exists → skipped (identical component)
 * - Same name but different ID → name conflict (user must choose skip or replace)
 * - Otherwise → new component to import
 */
export function resolveImportComponents(
  payload: ComponentFileFormat,
  existingComponents: Map<CustomComponentId, CustomComponentDefinition>
): ImportResolution {
  const newComponents: CustomComponentDefinition[] = []
  const skippedNames: string[] = []
  const nameConflicts: NameConflict[] = []

  // Build name→id lookup for existing components
  const existingByName = new Map<string, CustomComponentId>()
  for (const [id, def] of existingComponents) {
    existingByName.set(def.name.toLowerCase(), id)
  }

  for (const def of payload.components) {
    if (existingComponents.has(def.id)) {
      // Exact same ID already in library — skip
      skippedNames.push(def.name)
    } else {
      const existingId = existingByName.get(def.name.toLowerCase())
      if (existingId) {
        // Same name, different ID — conflict
        nameConflicts.push({ incoming: def, existingId })
      } else {
        newComponents.push(def)
      }
    }
  }

  return {
    newComponents,
    skippedCount: skippedNames.length,
    skippedNames,
    nameConflicts,
  }
}

// === Import plan preparation ===

export type ConflictChoice = 'skip' | 'replace'

export interface ImportPlan {
  toInsert: CustomComponentDefinition[]
  toRemove: CustomComponentId[]
  toUpdate: CustomComponentDefinition[]
}

/**
 * Remap custom-component references inside a definition's circuit.
 * Returns the original object unchanged if no remapping occurred.
 */
function remapDefinitionReferences(
  def: CustomComponentDefinition,
  idRemap: Map<CustomComponentId, CustomComponentId>
): CustomComponentDefinition {
  let changed = false
  const newComponents = def.circuit.components.map((comp) => {
    if (!isPrimitiveGate(comp.type) && idRemap.has(comp.type as CustomComponentId)) {
      changed = true
      return { ...comp, type: idRemap.get(comp.type as CustomComponentId)! }
    }
    return comp
  })

  if (!changed) return def

  return {
    ...def,
    circuit: {
      ...def.circuit,
      components: newComponents,
    },
  }
}

/**
 * Given the resolution and user choices for each name conflict,
 * compute the final import plan with proper ID remapping so that
 * both imported and existing components keep valid references.
 */
export function prepareImport(
  resolution: ImportResolution,
  conflictChoices: Map<CustomComponentId, ConflictChoice>,
  existingComponents: Map<CustomComponentId, CustomComponentDefinition>
): ImportPlan {
  const idRemap = new Map<CustomComponentId, CustomComponentId>()
  const toRemove: CustomComponentId[] = []
  const extraInserts: CustomComponentDefinition[] = []

  for (const conflict of resolution.nameConflicts) {
    const choice = conflictChoices.get(conflict.incoming.id) ?? 'skip'
    if (choice === 'skip') {
      // Don't import; remap other imported references to the existing ID
      idRemap.set(conflict.incoming.id, conflict.existingId)
    } else {
      // Replace: remove old, import new; remap existing references
      idRemap.set(conflict.existingId, conflict.incoming.id)
      toRemove.push(conflict.existingId)
      extraInserts.push(conflict.incoming)
    }
  }

  // Apply remapping to all components being imported
  const toInsert = [...resolution.newComponents, ...extraInserts].map((def) =>
    remapDefinitionReferences(def, idRemap)
  )

  // For the replace case, update existing library components whose
  // circuits reference an old ID that was just replaced
  const toUpdate: CustomComponentDefinition[] = []
  if (toRemove.length > 0) {
    for (const [id, def] of existingComponents) {
      if (toRemove.includes(id)) continue
      const remapped = remapDefinitionReferences(def, idRemap)
      if (remapped !== def) {
        toUpdate.push(remapped)
      }
    }
  }

  return { toInsert, toRemove, toUpdate }
}
