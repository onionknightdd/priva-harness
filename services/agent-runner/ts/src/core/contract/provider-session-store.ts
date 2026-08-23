import type { SessionRef } from './agent-provider.js'
import type {
  LastAssistantModel,
  ProviderSessionInfo,
  SessionMessage,
} from '../resource/session.js'

export interface SessionListQuery {
  readonly cwd?: string
}

export interface SessionMessagePage {
  readonly limit?: number
  readonly offset?: number
}

export interface SessionForkOptions {
  readonly title: string
  readonly upToMessageId?: string
}

export interface ProviderSessionStore {
  list(query: SessionListQuery): Promise<readonly ProviderSessionInfo[]>
  read(ref: SessionRef): Promise<ProviderSessionInfo>
  lastAssistantModel(ref: SessionRef): Promise<LastAssistantModel | undefined>
  messages(ref: SessionRef, page?: SessionMessagePage): Promise<readonly SessionMessage[]>
  fork(ref: SessionRef, options: SessionForkOptions): Promise<ProviderSessionInfo>
  delete(ref: SessionRef): Promise<void>
  rename(ref: SessionRef, title: string): Promise<void>
  tag(ref: SessionRef, tag: string | null): Promise<void>
}
