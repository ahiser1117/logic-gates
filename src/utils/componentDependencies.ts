import { isPrimitiveGate } from '../types'
import type { CustomComponentDefinition, CustomComponentId } from '../types'

export interface DependencyLine {
  prefix: string
  name: string
  isTarget: boolean
  note?: string
}

export interface DependencyInfo {
  lines: DependencyLine[]
  total: number
}

interface TreeNode {
  id: CustomComponentId
  name: string
  children: TreeNode[]
  isTarget: boolean
  note?: string
}

export const buildDependencyTree = (
  componentId: CustomComponentId,
  customComponents: Map<CustomComponentId, CustomComponentDefinition>
): DependencyInfo => {
  const dependencyMap = new Map<CustomComponentId, CustomComponentId[]>()

  for (const def of customComponents.values()) {
    const deps = new Set<CustomComponentId>()
    for (const comp of def.circuit.components) {
      if (!isPrimitiveGate(comp.type)) {
        deps.add(comp.type as CustomComponentId)
      }
    }
    dependencyMap.set(def.id, [...deps])
  }

  const targetName = customComponents.get(componentId)?.name ?? 'Unknown'
  if (!targetName) {
    return { lines: [], total: 0 }
  }

  const memo = new Map<CustomComponentId, boolean>()
  const inStack = new Set<CustomComponentId>()

  const dependsOnTarget = (id: CustomComponentId): boolean => {
    if (memo.has(id)) return memo.get(id) ?? false
    if (inStack.has(id)) return false
    inStack.add(id)

    const deps = dependencyMap.get(id) ?? []
    let result = deps.some((dep) => dep === componentId)

    if (!result) {
      result = deps.some((dep) => dependsOnTarget(dep))
    }

    inStack.delete(id)
    memo.set(id, result)
    return result
  }

  const dependents = new Set<CustomComponentId>()
  for (const id of dependencyMap.keys()) {
    if (dependsOnTarget(id)) {
      dependents.add(id)
    }
  }

  const usedByDependents = new Set<CustomComponentId>()
  for (const id of dependents) {
    const deps = dependencyMap.get(id) ?? []
    for (const dep of deps) {
      if (dependents.has(dep)) {
        usedByDependents.add(dep)
      }
    }
  }

  const rootIds = [...dependents]
    .filter((id) => !usedByDependents.has(id))
    .sort((a, b) => {
      const aName = customComponents.get(a)?.name ?? ''
      const bName = customComponents.get(b)?.name ?? ''
      return aName.localeCompare(bName)
    })

  const minDepth = new Map<CustomComponentId, number>()

  const updateMinDepth = (id: CustomComponentId, depth: number) => {
    const current = minDepth.get(id)
    if (current === undefined || depth < current) {
      minDepth.set(id, depth)
    }
  }

  const walkDepth = (id: CustomComponentId, depth: number, path: Set<CustomComponentId>) => {
    if (path.has(id)) return
    updateMinDepth(id, depth)

    const nextPath = new Set(path)
    nextPath.add(id)

    const deps = dependencyMap.get(id) ?? []
    for (const dep of deps) {
      if (dep === componentId) {
        updateMinDepth(componentId, depth + 1)
      } else if (dependents.has(dep)) {
        walkDepth(dep, depth + 1, nextPath)
      }
    }
  }

  for (const rootId of rootIds) {
    walkDepth(rootId, 0, new Set())
  }

  const directDependents = new Set<CustomComponentId>()
  for (const id of dependents) {
    const deps = dependencyMap.get(id) ?? []
    if (deps.includes(componentId)) {
      directDependents.add(id)
    }
  }

  const buildNode = (id: CustomComponentId, path: Set<CustomComponentId>): TreeNode => {
    const def = customComponents.get(id)
    const name = def?.name ?? 'Unknown'
    if (path.has(id)) {
      return { id, name: `${name} (cycle)`, children: [], isTarget: false }
    }

    const isDirectDependent = directDependents.has(id)
    const note = !isDirectDependent ? 'higher order dependency' : undefined

    const nextPath = new Set(path)
    nextPath.add(id)

    const deps = dependencyMap.get(id) ?? []
    const childNodes: TreeNode[] = []

    for (const dep of deps) {
      if (dep === componentId) {
        childNodes.push({ id: dep, name: targetName, children: [], isTarget: true })
      } else if (dependents.has(dep)) {
        childNodes.push(buildNode(dep, nextPath))
      }
    }

    childNodes.sort((a, b) => a.name.localeCompare(b.name))

    return {
      id,
      name,
      children: childNodes,
      isTarget: false,
      note,
    }
  }

  const lines: DependencyLine[] = []
  const rendered = new Set<CustomComponentId>()

  const shouldRenderNode = (node: TreeNode, depth: number): boolean => {
    if (node.isTarget) return true
    const expectedDepth = minDepth.get(node.id)
    if (expectedDepth === undefined || expectedDepth !== depth) return false
    if (rendered.has(node.id)) return false
    return true
  }

  const renderNode = (node: TreeNode, prefix: string, isLast: boolean, isRoot: boolean, depth: number) => {
    if (!shouldRenderNode(node, depth)) return
    const connector = isRoot ? '' : isLast ? '└─ ' : '├─ '
    lines.push({
      prefix: `${prefix}${connector}`,
      name: node.name,
      isTarget: node.isTarget,
      note: node.note,
    })
    if (!node.isTarget) {
      rendered.add(node.id)
    }

    const nextPrefix = isRoot ? prefix : `${prefix}${isLast ? '   ' : '│  '}`
    const visibleChildren = node.children.filter((child) => shouldRenderNode(child, depth + 1))
    visibleChildren.forEach((child, index) => {
      renderNode(child, nextPrefix, index === visibleChildren.length - 1, false, depth + 1)
    })
  }

  for (const rootId of rootIds) {
    const node = buildNode(rootId, new Set())
    renderNode(node, '', true, true, 0)
  }

  return {
    lines,
    total: dependents.size,
  }
}
