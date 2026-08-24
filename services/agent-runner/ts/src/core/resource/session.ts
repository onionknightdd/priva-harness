import type { SessionRef } from '../contract/agent-provider.js'
import type { ModelProfile } from './model-profile.js'

export const SESSION_GROUP_PAGE_SIZE = 10
export const MAX_SESSION_TAGS = 3
export const TAG_COLOR_SLOTS = 300
export const DEFAULT_SESSION_LIST_LIMIT = 20
export const RUN_MODES = ['agent', 'code'] as const

export type RunMode = (typeof RUN_MODES)[number]

export type SessionMessageType =
  | 'user'
  | 'assistant'
  | 'system'
  | 'tool_result'
  | 'bash_execution'
  | 'custom'
  | 'compaction'
  | 'branch_summary'

export type SessionErrorKind =
  | 'session-not-found'
  | 'session-busy'
  | 'invalid-request'
  | 'io-failure'

export class SessionError extends Error {
  readonly kind: SessionErrorKind

  constructor(kind: SessionErrorKind, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SessionError'
    this.kind = kind
  }
}

export interface SessionMessage {
  readonly type: SessionMessageType
  readonly uuid: string
  readonly sessionId: string
  readonly message: unknown
  readonly parentToolUseId: string | null
  readonly metadata: Readonly<Record<string, unknown>> | null
  readonly timestamp: number | null
}

export function parseMessageTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    if (value > 1e12) return Math.trunc(value)
    if (value > 1e9) return Math.trunc(value * 1000)
    return null
  }
  if (typeof value === 'string' && value !== '') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

export interface ProviderSessionInfo {
  readonly ref: SessionRef
  readonly summary: string
  readonly lastModified: number
  readonly fileSize: number
  readonly customTitle: string | null
  readonly firstPrompt: string | null
  readonly gitBranch: string | null
  readonly cwd: string | null
  readonly tag: string | null
}

export interface LastAssistantModel {
  readonly modelId: string
  readonly observedAt: number | null
}

export interface SessionModelCapabilities {
  readonly context: '1m' | null
}

export interface SessionModelSelection {
  readonly id: string
  readonly capabilities: SessionModelCapabilities
}

export interface SessionResponseModel {
  readonly profileId: string | null
  readonly model: SessionModelSelection
  readonly observedAt: number | null
}

export interface StoredLastResponseModel extends SessionResponseModel {
  readonly modelSource: 'profile' | 'transcript'
}

export interface SessionRecap {
  readonly text: string
  readonly turns: number
}

export interface SessionFlags {
  readonly pinned: boolean
  readonly archived: boolean
}

export interface SessionMetadataRecord {
  readonly flags: SessionFlags
  readonly tags: readonly string[]
  readonly addDirs: readonly string[]
  readonly runMode: RunMode | null
  readonly recap: SessionRecap | null
  readonly lastResponseModel: StoredLastResponseModel | null
}

export interface SessionMetadataPatch {
  readonly pinned?: boolean
  readonly archived?: boolean
  readonly tags?: readonly string[]
  readonly addDirs?: readonly string[]
  readonly runMode?: RunMode
  readonly recap?: SessionRecap | null
  readonly lastResponseModel?: StoredLastResponseModel | null
}

export function isRunMode(value: unknown): value is RunMode {
  return value === 'agent' || value === 'code'
}

export function sessionRefKey(ref: SessionRef): string {
  return `${ref.provider}:${ref.id}`
}

export function parseSessionRefKey(key: string): SessionRef | undefined {
  const separator = key.indexOf(':')
  if (separator <= 0 || separator === key.length - 1) return undefined
  const provider = key.slice(0, separator)
  const id = key.slice(separator + 1)
  if (provider !== 'claude' && provider !== 'pi') return undefined
  if (id === '') return undefined
  return { provider, id }
}

export function emptySessionMetadata(): SessionMetadataRecord {
  return {
    flags: { pinned: false, archived: false },
    tags: [],
    addDirs: [],
    runMode: null,
    recap: null,
    lastResponseModel: null,
  }
}

export function normalizeSessionTags(raw: unknown, options?: { readonly truncate?: boolean }): string[] {
  const truncate = options?.truncate === true
  const values = typeof raw === 'string' ? [raw] : raw
  if (!Array.isArray(values)) {
    throw new SessionError('invalid-request', 'Tags must be a string or an array of strings')
  }
  const tags: string[] = []
  const seen = new Set<string>()
  for (const item of values) {
    if (typeof item !== 'string') {
      throw new SessionError('invalid-request', 'Each tag must be a string')
    }
    const tag = item.trim()
    const folded = tag.toLowerCase()
    if (tag === '' || seen.has(folded)) continue
    if (tags.length >= MAX_SESSION_TAGS) {
      if (truncate) break
      throw new SessionError('invalid-request', `Maximum ${MAX_SESSION_TAGS} tags per session`)
    }
    seen.add(folded)
    tags.push(tag)
  }
  return tags
}

export function fallbackTagColorIndex(tag: string): number {
  let value = 2_166_136_261
  for (const byte of new TextEncoder().encode(tag.toLowerCase())) {
    value ^= byte
    value = Math.imul(value, 16_777_619) >>> 0
  }
  return value % TAG_COLOR_SLOTS
}

export function reserveTagColors(
  registry: Record<string, number>,
  tags: readonly string[],
): Record<string, number> {
  const next = { ...registry }
  const used = new Set(
    Object.values(next).filter((index) => Number.isInteger(index) && index >= 0 && index < TAG_COLOR_SLOTS),
  )
  const seen = new Set<string>()
  for (const tag of tags) {
    const folded = tag.toLowerCase()
    if (tag === '' || seen.has(folded)) continue
    seen.add(folded)
    if (registeredTagColor(next, tag) !== undefined) continue
    const start = fallbackTagColorIndex(tag)
    let slot = start
    for (let offset = 0; offset < TAG_COLOR_SLOTS; offset += 1) {
      const candidate = (start + offset) % TAG_COLOR_SLOTS
      if (!used.has(candidate)) {
        slot = candidate
        break
      }
    }
    next[tag] = slot
    used.add(slot)
  }
  return next
}

export function tagColorsFor(
  tags: readonly string[],
  registry: Readonly<Record<string, number>>,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const tag of tags) {
    out[tag] = registeredTagColor(registry, tag) ?? fallbackTagColorIndex(tag)
  }
  return out
}

export function uniqueProfileIdByModel(
  profiles: readonly Pick<
    ModelProfile,
    'id' | 'defaultModel' | 'imageUnderstandingModel' | 'imageGenerationModel' | 'imageEditModel'
  >[],
): ReadonlyMap<string, string> {
  const owners = new Map<string, Set<string>>()
  for (const profile of profiles) {
    for (const modelId of [
      profile.defaultModel,
      profile.imageUnderstandingModel,
      profile.imageGenerationModel,
      profile.imageEditModel,
    ]) {
      if (modelId === null || modelId === '') continue
      const existing = owners.get(modelId) ?? new Set<string>()
      existing.add(profile.id)
      owners.set(modelId, existing)
    }
  }
  const unique = new Map<string, string>()
  for (const [modelId, profileIds] of owners) {
    if (profileIds.size !== 1) continue
    const [profileId] = profileIds
    if (profileId !== undefined) unique.set(modelId, profileId)
  }
  return unique
}

export function resolveListedResponseModel(
  stored: StoredLastResponseModel | null,
  transcript: LastAssistantModel | undefined,
  profileByModel: ReadonlyMap<string, string>,
): SessionResponseModel | null {
  if (stored !== null && stored.modelSource === 'profile') {
    return publicResponseModel(stored)
  }
  if (stored !== null) {
    const profileId = profileByModel.get(stored.model.id)
    if (profileId === undefined) return null
    if (stored.profileId !== null && stored.profileId !== profileId) return null
    return publicResponseModel({
      ...stored,
      profileId,
    })
  }
  if (transcript === undefined) return null
  const profileId = profileByModel.get(transcript.modelId)
  if (profileId === undefined) return null
  return {
    profileId,
    model: {
      id: transcript.modelId,
      capabilities: { context: null },
    },
    observedAt: transcript.observedAt,
  }
}

export function pageSessionMessages(
  messages: readonly SessionMessage[],
  page?: { readonly limit?: number; readonly offset?: number },
): SessionMessage[] {
  const offset = Math.max(0, page?.offset ?? 0)
  if (page?.limit === undefined) return [...messages.slice(offset)]
  return [...messages.slice(offset, offset + Math.max(0, page.limit))]
}

export function publicResponseModel(stored: StoredLastResponseModel): SessionResponseModel {
  return {
    profileId: stored.profileId,
    model: stored.model,
    observedAt: stored.observedAt,
  }
}

function registeredTagColor(
  registry: Readonly<Record<string, number>>,
  tag: string,
): number | undefined {
  const direct = registry[tag]
  if (isColorSlot(direct)) return direct
  const folded = tag.toLowerCase()
  for (const [candidate, index] of Object.entries(registry)) {
    if (candidate.toLowerCase() === folded && isColorSlot(index)) return index
  }
  return undefined
}

function isColorSlot(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < TAG_COLOR_SLOTS
}
