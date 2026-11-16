import { A2uiValidationError, type SurfaceModel } from '@a2ui/agent'

export const MAX_A2UI_SOURCE_LENGTH = 64_000
const MAX_COMPONENTS = 200
const MAX_RENDERED_NODES = 1_000

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function arrayValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

function resolveStringBinding(value: unknown, surface: SurfaceModel, location: string): unknown {
  const path = objectValue(value)?.['@path']
  if (typeof path !== 'string') return value
  const resolved = surface.dataModel.get<unknown>(path)
  if (typeof resolved !== 'string') {
    throw new A2uiValidationError(`Component ${location}: bind to an initialized string; ${path} does not contain a string.`)
  }
  return resolved
}

function isImageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value !== value.trim() || /\p{Cc}/u.test(value)) return false
  if (/^sandbox:/i.test(value)) {
    try {
      const path = decodeURIComponent(value.slice('sandbox:'.length)).replaceAll('\\', '/')
      return !/\p{Cc}/u.test(path) && /^(?:\/(?!\/)|[a-z]:\/)/i.test(path)
    } catch (error) {
      if (error instanceof URIError) return false
      throw error
    }
  }
  if (!/^https?:\/\//i.test(value)) return false
  try {
    const url = new URL(value)
    return url.hostname !== '' && (url.protocol === 'http:' || url.protocol === 'https:')
  } catch (error) {
    if (error instanceof TypeError) return false
    throw error
  }
}

function checkBindings(value: unknown, surface: SurfaceModel, componentId: string): void {
  if (Array.isArray(value)) {
    for (const child of value) checkBindings(child, surface, componentId)
    return
  }
  const object = objectValue(value)
  if (object === undefined) return
  const path = object['@path']
  if (typeof path === 'string') {
    if (!path.startsWith('/') || !surface.dataModel.hasPath(path)) {
      throw new A2uiValidationError(`Component ${componentId} has an uninitialized or relative binding ${path}. Initialize an absolute data-model path with $/path = value before using it.`)
    }
    return
  }
  for (const child of Object.values(object)) checkBindings(child, surface, componentId)
}

/** Constraints that span component properties cannot be expressed by the catalog's JSON schema. */
export function validateA2uiSurface(surface: SurfaceModel): void {
  if (surface.componentsModel.size > MAX_COMPONENTS) {
    throw new A2uiValidationError(`Use at most ${MAX_COMPONENTS} components per UI; summarize or split the content into separate embeds.`)
  }
  // A valid acyclic graph can still expand exponentially when several parents reuse a subtree.
  const pending = ['root']
  let renderedNodes = 0
  while (pending.length > 0) {
    const id = pending.pop()
    if (id === undefined) break
    renderedNodes += 1
    if (renderedNodes > MAX_RENDERED_NODES) {
      throw new A2uiValidationError(`The UI expands beyond ${MAX_RENDERED_NODES} rendered nodes. Reduce repeated component references.`)
    }
    for (const [childId] of surface.componentsModel.getChildReferences(id)) pending.push(childId)
  }
  for (const component of surface.componentsModel.values) {
    const properties: Record<string, unknown> = component.properties
    if (properties['children'] !== undefined && !Array.isArray(properties['children'])) {
      throw new A2uiValidationError(`Component ${component.id} uses a dynamic list template. Use an explicit children list for this renderer.`)
    }
    checkBindings(properties, surface, component.id)
    // Every directly bindable property in this catalog is a DynamicString.
    // JSON schema validates the binding expression, but cannot validate its data-model value.
    for (const [key, value] of Object.entries(properties)) {
      resolveStringBinding(value, surface, `${component.id}.${key}`)
    }
    if (component.type === 'Image') {
      const url = resolveStringBinding(properties['url'], surface, `${component.id}.url`)
      if (!isImageUrl(url)) {
        throw new A2uiValidationError(`Image ${component.id}: url must be an HTTP(S) URL or sandbox:/absolute/path to an existing image. Relative paths, file, data and blob URLs are not supported.`)
      }
    }
    if (component.type === 'ImageGallery') {
      for (const [index, item] of arrayValue(properties['images']).entries()) {
        const image = objectValue(item)
        const location = `${component.id}.images[${index}]`
        for (const key of ['description', 'title']) resolveStringBinding(image?.[key], surface, `${location}.${key}`)
        const url = resolveStringBinding(image?.['url'], surface, `${location}.url`)
        if (!isImageUrl(url)) {
          throw new A2uiValidationError(`ImageGallery ${location}: url must be an HTTP(S) URL or sandbox:/absolute/path to an existing image. Relative paths, file, data and blob URLs are not supported.`)
        }
      }
    }
    if (component.type === 'Button') {
      const event = objectValue(objectValue(properties['action'])?.['event'])
      const userMessage = event?.['userMessage']
      const path = objectValue(userMessage)?.['@path']
      const resolvedMessage = typeof path === 'string' ? surface.dataModel.get<unknown>(path) : userMessage
      if (typeof resolvedMessage !== 'string' || resolvedMessage.trim() === '') {
        throw new A2uiValidationError(`Button ${component.id}: supply a readable userMessage using action={event:{name:"action_name",context:{},userMessage:"Readable request"}}.`)
      }
    }
    if (['BarChart', 'LineChart', 'AreaChart'].includes(component.type)) {
      const labels = arrayValue(properties['labels'])
      const series = arrayValue(properties['series'])
      for (const entry of series) {
        if (arrayValue(objectValue(entry)?.['values']).length !== labels.length) {
          throw new A2uiValidationError(`Chart ${component.id}: every series must contain exactly ${labels.length} values, one for each label.`)
        }
      }
    }
    if (component.type === 'DonutChart') {
      const labels = arrayValue(properties['labels'])
      const values = arrayValue(properties['values'])
      const total = values.reduce<number>((sum, value) => sum + (typeof value === 'number' ? value : 0), 0)
      if (values.length !== labels.length || !Number.isFinite(total) || total <= 0) {
        throw new A2uiValidationError(`Donut chart ${component.id}: provide one non-negative value per label and a finite total greater than zero.`)
      }
    }
    if (component.type === 'Table') {
      const columns = arrayValue(properties['columns'])
      const rows = arrayValue(properties['rows'])
      if (rows.some((row) => arrayValue(row).length !== columns.length)) {
        throw new A2uiValidationError(`Table ${component.id}: every row must contain exactly ${columns.length} cells, one for each column.`)
      }
    }
    if (component.type === 'TextField' || component.type === 'Select') {
      const path = objectValue(properties['value'])?.['@path']
      if (typeof path !== 'string' || typeof surface.dataModel.get<unknown>(path) !== 'string') {
        throw new A2uiValidationError(`Input ${component.id}: value must bind to an initialized string, for example $/region = "Europe" and value=$/region.`)
      }
      if (component.type === 'Select') {
        const selected = surface.dataModel.get<unknown>(path)
        const options = arrayValue(properties['options'])
        if (!options.some((option) => objectValue(option)?.['value'] === selected)) {
          throw new A2uiValidationError(`Select ${component.id}: the initial bound value must match one of the option values.`)
        }
      }
    }
  }
}
