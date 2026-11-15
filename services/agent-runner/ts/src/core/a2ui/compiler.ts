import {
  A2uiGenerator,
  CatalogConfig,
  ExpressFormatFactory,
  InMemoryCatalogProvider,
  type AgentToRendererMessage,
} from '@a2ui/agent'

import { a2uiCatalogDefinition } from './catalog.generated.js'
import { MAX_A2UI_SOURCE_LENGTH, validateA2uiSurface } from './validation.js'

const SURFACE_ID = 'main'
const catalog = new InMemoryCatalogProvider(a2uiCatalogDefinition).load()
const generator = new A2uiGenerator([new CatalogConfig(catalog)])
const capabilities = { supportedCatalogIds: [catalog.id] }
const format = new ExpressFormatFactory({
  surfaceId: SURFACE_ID,
  version: 'v1.0',
  allowedMessages: ['createSurface', 'updateComponents', 'updateDataModel'],
})

export interface A2uiOutput {
  readonly format: 'a2ui'
  readonly version: '1.0'
  readonly messages: AgentToRendererMessage[]
}

export class A2uiSourceError extends Error {}

function completeSource(source: string): string {
  if (source.length > MAX_A2UI_SOURCE_LENGTH) {
    throw new A2uiSourceError(`source exceeds ${MAX_A2UI_SOURCE_LENGTH} characters. Summarize or split the content into separate embeds.`)
  }
  const trimmed = source.trim()
  if (trimmed === '') {
    throw new A2uiSourceError('source is required. Provide a complete A2UI Express program with root = Component(...).')
  }
  return trimmed
}

/** Compile and validate a complete response without retaining another embed's state. */
export function compileA2uiSource(source: string, signal?: AbortSignal): A2uiOutput {
  signal?.throwIfAborted()
  const program = completeSource(source)
  const processor = generator.createProcessor(capabilities, format)
  const state = processor.createState()
  try {
    // Full-block parsing always checks the final tree, including missing children and cycles.
    const parts = processor.parseResponse(program, { wrapped: false, state })
    const messages = parts.flatMap((part) => part.type === 'a2ui' ? part.a2ui : [])
    const surfaces = messages.filter((message) => 'createSurface' in message)
    if (surfaces.length !== 1 || surfaces[0]?.createSurface.surfaceId !== SURFACE_ID) {
      throw new A2uiSourceError('Create exactly one UI with root = Component(...). Use the default main surface; do not target another surface.')
    }
    for (const message of messages) {
      const operation = 'createSurface' in message ? message.createSurface
        : 'updateComponents' in message ? message.updateComponents
          : 'updateDataModel' in message ? message.updateDataModel
            : null
      if (operation?.surfaceId !== SURFACE_ID) {
        throw new A2uiSourceError('Only createSurface, updateComponents and updateDataModel on the main surface are supported. Every embed creates a new independent UI.')
      }
    }
    const surface = state.getSurface(SURFACE_ID)
    if (surface === undefined) throw new A2uiSourceError('The program must create a main surface with a root component.')
    validateA2uiSurface(surface)
    signal?.throwIfAborted()
    return { format: 'a2ui', version: '1.0', messages }
  } finally {
    for (const id of state.surfaceIds) state.getSurface(id)?.dispose()
  }
}
