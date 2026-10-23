import { z } from 'zod'

import { errorBodySchema } from './errors.js'
import { agentApiEventSchema, durableEventSchema, ephemeralEventSchema } from './events.js'
import {
  clientCommandSchema,
  createSessionBodySchema,
  interactionResponseBodySchema,
  patchSessionBodySchema,
  sendMessageBodySchema,
  userMessageSchema,
} from './input.js'
import {
  contentBlockSchema,
  interactionSchema,
  itemSchema,
  runSchema,
  runWithItemsSchema,
  sessionSchema,
  sessionSnapshotSchema,
  taskSchema,
} from './objects.js'
import {
  capabilitiesSchema,
  fileUploadedSchema,
  interactionAcceptedSchema,
  messageAcceptedSchema,
  messageResultSchema,
  publishedSessionCreatedSchema,
  runCancelAcceptedSchema,
  runResultSchema,
  runsPageSchema,
  sessionCreatedSchema,
  sessionsPageSchema,
  sessionUpdatedSchema,
  taskStopAcceptedSchema,
} from './responses.js'

const PUBLIC_SCHEMAS = {
  ContentBlock: contentBlockSchema,
  Session: sessionSchema,
  SessionSnapshot: sessionSnapshotSchema,
  Run: runSchema,
  RunWithItems: runWithItemsSchema,
  Item: itemSchema,
  Task: taskSchema,
  Interaction: interactionSchema,
  UserMessage: userMessageSchema,
  CreateSessionBody: createSessionBodySchema,
  SendMessageBody: sendMessageBodySchema,
  PatchSessionBody: patchSessionBodySchema,
  InteractionResponseBody: interactionResponseBodySchema,
  ClientCommand: clientCommandSchema,
  Capabilities: capabilitiesSchema,
  SessionCreated: sessionCreatedSchema,
  PublishedSessionCreated: publishedSessionCreatedSchema,
  SessionUpdated: sessionUpdatedSchema,
  SessionsPage: sessionsPageSchema,
  RunsPage: runsPageSchema,
  MessageAccepted: messageAcceptedSchema,
  MessageResult: messageResultSchema,
  RunResult: runResultSchema,
  FileUploaded: fileUploadedSchema,
  RunCancelAccepted: runCancelAcceptedSchema,
  InteractionAccepted: interactionAcceptedSchema,
  TaskStopAccepted: taskStopAcceptedSchema,
  DurableEvent: durableEventSchema,
  EphemeralEvent: ephemeralEventSchema,
  Event: agentApiEventSchema,
  ErrorBody: errorBodySchema,
} as const

/** JSON Schema (draft 2020-12) for every public object, body and event of Agent API v1. */
export function agentApiJsonSchema(): Record<string, unknown> {
  const registry = z.registry<{ id: string }>()
  for (const [id, schema] of Object.entries(PUBLIC_SCHEMAS)) registry.add(schema, { id })
  const { schemas } = z.toJSONSchema(registry, { target: 'draft-2020-12', uri: (id) => `#/$defs/${id}` })
  const defs = Object.fromEntries(Object.entries(schemas).map(([id, schema]) => {
    // Definitions are addressed by `#/$defs/<id>` pointers, so they carry no `$id` of their own.
    const definition: Record<string, unknown> = { ...schema }
    delete definition['$schema']
    delete definition['$id']
    return [id, definition]
  }))
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Agent API v1',
    $defs: defs,
  }
}
