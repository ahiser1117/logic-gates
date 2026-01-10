import type { CompiledComponent, Net } from './types'
import type { ComponentId } from '../types'

interface TopoResult {
  order: number[]
  hasCycle: boolean
  cycleComponents: ComponentId[]
}

export function topologicalSort(
  components: CompiledComponent[],
  nets: Net[]
): TopoResult {
  if (components.length === 0) {
    return { order: [], hasCycle: false, cycleComponents: [] }
  }

  // Build component index map
  const compIndexMap = new Map<ComponentId, number>()
  components.forEach((comp, idx) => {
    compIndexMap.set(comp.id, idx)
  })

  // Build adjacency: for each component, which components depend on it
  const downstream = new Map<number, number[]>()
  const inDegree = new Map<number, number>()

  for (let i = 0; i < components.length; i++) {
    downstream.set(i, [])
    inDegree.set(i, 0)
  }

  // For each component's input nets, find the driving component
  for (let i = 0; i < components.length; i++) {
    const comp = components[i]!

    for (const inputNetId of comp.inputNetIds) {
      const net = nets[inputNetId]
      if (net?.driver?.type === 'component') {
        const driverIdx = compIndexMap.get(net.driver.componentId)
        if (driverIdx !== undefined && driverIdx !== i) {
          // Driver component -> this component
          downstream.get(driverIdx)!.push(i)
          inDegree.set(i, (inDegree.get(i) || 0) + 1)
        }
      }
    }
  }

  // Kahn's algorithm
  const queue: number[] = []
  const result: number[] = []

  for (const [idx, degree] of inDegree) {
    if (degree === 0) {
      queue.push(idx)
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!
    result.push(current)

    for (const next of downstream.get(current)!) {
      const newDegree = inDegree.get(next)! - 1
      inDegree.set(next, newDegree)
      if (newDegree === 0) {
        queue.push(next)
      }
    }
  }

  // Check for cycles
  if (result.length !== components.length) {
    const cycleComponents = components
      .filter((_, idx) => !result.includes(idx))
      .map((c) => c.id)

    return {
      order: [],
      hasCycle: true,
      cycleComponents,
    }
  }

  return {
    order: result,
    hasCycle: false,
    cycleComponents: [],
  }
}
