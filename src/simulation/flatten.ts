import type {
  Circuit,
  Component,
  ComponentId,
  CustomComponentDefinition,
  CustomComponentId,
  InputId,
  OutputId,
  Wire,
  WireId,
  WireSource,
  WireTarget,
} from '../types'
import { isPrimitiveGate } from '../types'

interface FlattenContext {
  allocator: IdAllocator
  customComponents: Map<CustomComponentId, CustomComponentDefinition> | undefined
  errors: string[]
}

interface FlattenOptions {
  preserveComponentIds: boolean
  preserveIoIds: boolean
  endpointMap?: Map<string, string>
}

interface FlattenImplResult {
  components: Component[]
  wires: Wire[]
  inputIdMap: Map<InputId, InputId>
  outputIdMap: Map<OutputId, OutputId>
}

interface ComponentConnections {
  inputSources: Map<number, WireSource[]>
  outputTargets: Map<number, WireTarget[]>
}

interface InstanceCache {
  outputDrivers: Map<number, WireSource>
}

export interface FlattenResult {
  circuit: Circuit
  endpointMap: Map<string, string>
  errors: string[]
}

class IdAllocator {
  private nextComponentId: number
  private nextWireId: number
  private nextInputId: number
  private nextOutputId: number

  constructor(circuit: Circuit) {
    this.nextComponentId = maxId(circuit.components.map((c) => c.id as number)) + 1
    this.nextWireId = maxId(circuit.wires.map((w) => w.id as number)) + 1
    this.nextInputId = maxId(circuit.inputs.map((i) => i.id as number)) + 1
    this.nextOutputId = maxId(circuit.outputs.map((o) => o.id as number)) + 1
  }

  allocateComponentId(): ComponentId {
    return this.nextComponentId++ as ComponentId
  }

  allocateWireId(): WireId {
    return this.nextWireId++ as WireId
  }

  allocateInputId(): InputId {
    return this.nextInputId++ as InputId
  }

  allocateOutputId(): OutputId {
    return this.nextOutputId++ as OutputId
  }
}

function maxId(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((max, value) => (value > max ? value : max), values[0] ?? 0)
}

function getPinKey(endpoint: WireSource | WireTarget): string {
  if (endpoint.type === 'component') {
    return `c:${endpoint.componentId}:${endpoint.pinIndex}`
  }
  if (endpoint.type === 'input') {
    return `i:${endpoint.inputId}`
  }
  return `o:${endpoint.outputId}`
}

function isCustomComponent(component: Component | undefined): component is Component {
  if (!component) return false
  return !isPrimitiveGate(component.type)
}

export function flattenCircuit(
  circuit: Circuit,
  customComponents?: Map<CustomComponentId, CustomComponentDefinition>
): FlattenResult {
  const errors: string[] = []
  const allocator = new IdAllocator(circuit)
  const endpointMap = new Map<string, string>()

  const { components, wires } = flattenCircuitImpl(
    circuit,
    { allocator, customComponents, errors },
    {
      preserveComponentIds: true,
      preserveIoIds: true,
      endpointMap,
    }
  )

  const flattened: Circuit = {
    id: circuit.id,
    name: circuit.name,
    inputs: structuredClone(circuit.inputs),
    outputs: structuredClone(circuit.outputs),
    components,
    wires,
    inputBoard: { ...circuit.inputBoard },
    outputBoard: { ...circuit.outputBoard },
  }

  return { circuit: flattened, endpointMap, errors }
}

function flattenCircuitImpl(
  circuit: Circuit,
  context: FlattenContext,
  options: FlattenOptions
): FlattenImplResult {
  const { allocator, customComponents, errors } = context
  const componentById = new Map<ComponentId, Component>()
  circuit.components.forEach((component) => componentById.set(component.id, component))

  const connections = new Map<ComponentId, ComponentConnections>()

  const getConnections = (componentId: ComponentId): ComponentConnections => {
    let entry = connections.get(componentId)
    if (!entry) {
      entry = { inputSources: new Map(), outputTargets: new Map() }
      connections.set(componentId, entry)
    }
    return entry
  }

  for (const wire of circuit.wires) {
    if (wire.source.type === 'component') {
      const sourceComp = componentById.get(wire.source.componentId)
      if (isCustomComponent(sourceComp)) {
        const entry = getConnections(wire.source.componentId)
        const list = entry.outputTargets.get(wire.source.pinIndex) ?? []
        list.push(wire.target)
        entry.outputTargets.set(wire.source.pinIndex, list)
      }
    }
    if (wire.target.type === 'component') {
      const targetComp = componentById.get(wire.target.componentId)
      if (isCustomComponent(targetComp)) {
        const entry = getConnections(wire.target.componentId)
        const list = entry.inputSources.get(wire.target.pinIndex) ?? []
        list.push(wire.source)
        entry.inputSources.set(wire.target.pinIndex, list)
      }
    }
  }

  const inputIdMap = new Map<InputId, InputId>()
  const outputIdMap = new Map<OutputId, OutputId>()
  const componentIdMap = new Map<ComponentId, ComponentId>()

  for (const input of circuit.inputs) {
    inputIdMap.set(
      input.id,
      options.preserveIoIds ? input.id : allocator.allocateInputId()
    )
  }

  for (const output of circuit.outputs) {
    outputIdMap.set(
      output.id,
      options.preserveIoIds ? output.id : allocator.allocateOutputId()
    )
  }

  const flatComponents: Component[] = []
  const flatWires: Wire[] = []

  for (const component of circuit.components) {
    if (isPrimitiveGate(component.type)) {
      const newId = options.preserveComponentIds ? component.id : allocator.allocateComponentId()
      componentIdMap.set(component.id, newId)
      flatComponents.push({ ...component, id: newId })
    }
  }

  const instanceCache = new Map<ComponentId, InstanceCache>()
  const instanceInProgress = new Set<ComponentId>()

  const resolveSourceEndpoint = (source: WireSource): WireSource | null => {
    if (source.type === 'input') {
      const mapped = inputIdMap.get(source.inputId)
      if (!mapped) {
        errors.push(`missing input mapping for ${source.inputId}`)
        return null
      }
      return { type: 'input', inputId: mapped }
    }

    const component = componentById.get(source.componentId)
    if (!component) {
      errors.push(`missing component ${source.componentId}`)
      return null
    }

    if (isPrimitiveGate(component.type)) {
      const mapped = componentIdMap.get(component.id)
      if (!mapped) {
        errors.push(`missing component mapping for ${component.id}`)
        return null
      }
      return { type: 'component', componentId: mapped, pinIndex: source.pinIndex }
    }

    const cache = flattenCustomInstance(component)
    const driver = cache.outputDrivers.get(source.pinIndex)
    if (!driver) {
      errors.push(`missing output driver for component ${component.id} pin ${source.pinIndex}`)
      return null
    }
    return driver
  }

  const resolveTargetEndpoint = (target: WireTarget): WireTarget | null => {
    if (target.type === 'output') {
      const mapped = outputIdMap.get(target.outputId)
      if (!mapped) {
        errors.push(`missing output mapping for ${target.outputId}`)
        return null
      }
      return { type: 'output', outputId: mapped }
    }

    const component = componentById.get(target.componentId)
    if (!component) {
      errors.push(`missing component ${target.componentId}`)
      return null
    }

    if (isPrimitiveGate(component.type)) {
      const mapped = componentIdMap.get(component.id)
      if (!mapped) {
        errors.push(`missing component mapping for ${component.id}`)
        return null
      }
      return { type: 'component', componentId: mapped, pinIndex: target.pinIndex }
    }

    return null
  }

  const flattenCustomInstance = (component: Component): InstanceCache => {
    const cached = instanceCache.get(component.id)
    if (cached) {
      return cached
    }

    if (instanceInProgress.has(component.id)) {
      errors.push(`cycle detected while flattening component ${component.id}`)
      const fallback = { outputDrivers: new Map<number, WireSource>() }
      instanceCache.set(component.id, fallback)
      return fallback
    }

    instanceInProgress.add(component.id)

    const definition = customComponents?.get(component.type as CustomComponentId)
    if (!definition) {
      errors.push(`missing custom component definition for ${component.type}`)
      const fallback = { outputDrivers: new Map<number, WireSource>() }
      instanceCache.set(component.id, fallback)
      instanceInProgress.delete(component.id)
      return fallback
    }

    const internal = flattenCircuitImpl(
      {
        id: definition.id,
        name: definition.name,
        inputs: definition.circuit.inputs.map((input) => ({ ...input })),
        outputs: definition.circuit.outputs.map((output) => ({ ...output })),
        components: definition.circuit.components.map((comp) => ({ ...comp })),
        wires: definition.circuit.wires.map((wire) => ({
          ...wire,
          source: { ...wire.source },
          target: { ...wire.target },
          waypoints: wire.waypoints?.map((point) => ({ ...point })),
        })),
        inputBoard: { x: 0, y: 0 },
        outputBoard: { x: 0, y: 0 },
      },
      context,
      {
        preserveComponentIds: false,
        preserveIoIds: false,
      }
    )

    const orderedInputs = [...definition.circuit.inputs].sort((a, b) => a.order - b.order)
    const orderedOutputs = [...definition.circuit.outputs].sort((a, b) => a.order - b.order)
    const inputCount = orderedInputs.length

    const internalInputIds = orderedInputs.map((input) => {
      const mapped = internal.inputIdMap.get(input.id)
      if (!mapped) {
        errors.push(`missing input mapping for custom component ${definition.name}`)
        return allocator.allocateInputId()
      }
      return mapped
    })

    const internalOutputIds = orderedOutputs.map((output) => {
      const mapped = internal.outputIdMap.get(output.id)
      if (!mapped) {
        errors.push(`missing output mapping for custom component ${definition.name}`)
        return allocator.allocateOutputId()
      }
      return mapped
    })

    const connection = connections.get(component.id)

    internalInputIds.forEach((internalInputId, index) => {
      const pinIndex = index
      const sources = connection?.inputSources.get(pinIndex) ?? []
      if (sources.length > 1) {
        errors.push(`multiple drivers for component ${component.id} input ${pinIndex}`)
      }
      const externalSource = sources[0]
      const mappedSource = externalSource ? resolveSourceEndpoint(externalSource) : null
      if (mappedSource) {
        for (const wire of internal.wires) {
          if (wire.source.type === 'input' && wire.source.inputId === internalInputId) {
            wire.source = mappedSource
          }
        }
        options.endpointMap?.set(
          `c:${component.id}:${pinIndex}`,
          getPinKey(mappedSource)
        )
      } else {
        options.endpointMap?.set(`c:${component.id}:${pinIndex}`, `i:${internalInputId}`)
      }
    })

    const outputDrivers = new Map<number, WireSource>()
    internalOutputIds.forEach((internalOutputId, index) => {
      const pinIndex = inputCount + index
      let driver: WireSource | null = null
      for (const wire of internal.wires) {
        if (wire.target.type === 'output' && wire.target.outputId === internalOutputId) {
          driver = wire.source
          break
        }
      }

      if (!driver) {
        const syntheticInput = allocator.allocateInputId()
        const wire: Wire = {
          id: allocator.allocateWireId(),
          source: { type: 'input', inputId: syntheticInput },
          target: { type: 'output', outputId: internalOutputId },
        }
        internal.wires.push(wire)
        driver = wire.source
      }

      outputDrivers.set(pinIndex, driver)

      options.endpointMap?.set(`c:${component.id}:${pinIndex}`, `o:${internalOutputId}`)

      const targets = connection?.outputTargets.get(pinIndex) ?? []
      for (const target of targets) {
        if (target.type === 'component') {
          const targetComp = componentById.get(target.componentId)
          if (isCustomComponent(targetComp)) {
            continue
          }
        }
        const mappedTarget = resolveTargetEndpoint(target)
        if (!mappedTarget) continue
        internal.wires.push({
          id: allocator.allocateWireId(),
          source: driver,
          target: mappedTarget,
        })
      }
    })

    flatComponents.push(...internal.components)
    flatWires.push(...internal.wires)

    const cache: InstanceCache = { outputDrivers }
    instanceCache.set(component.id, cache)
    instanceInProgress.delete(component.id)
    return cache
  }

  for (const component of circuit.components) {
    if (isCustomComponent(component)) {
      flattenCustomInstance(component)
    }
  }

  for (const wire of circuit.wires) {
    if (wire.source.type === 'component') {
      const sourceComponent = componentById.get(wire.source.componentId)
      if (isCustomComponent(sourceComponent)) {
        continue
      }
    }
    if (wire.target.type === 'component') {
      const targetComponent = componentById.get(wire.target.componentId)
      if (isCustomComponent(targetComponent)) {
        continue
      }
    }

    const mappedSource = resolveSourceEndpoint(wire.source)
    const mappedTarget = resolveTargetEndpoint(wire.target)
    if (!mappedSource || !mappedTarget) {
      continue
    }

    flatWires.push({
      id: allocator.allocateWireId(),
      source: mappedSource,
      target: mappedTarget,
    })
  }

  return { components: flatComponents, wires: flatWires, inputIdMap, outputIdMap }
}
