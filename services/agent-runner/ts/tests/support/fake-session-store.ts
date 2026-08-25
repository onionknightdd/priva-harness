import type {
  ProviderSessionStore,
  SessionListQuery,
  SessionMessagePage,
} from '../../src/core/contract/provider-session-store.js'
import type { SessionRef } from '../../src/core/contract/agent-provider.js'
import {
  pageSessionMessages,
  SessionError,
  type LastAssistantModel,
  type ProviderSessionInfo,
  type SessionMessage,
} from '../../src/core/resource/session.js'
import type { ThreadReplayItem } from '../../src/core/resource/thread.js'
import { replayClaudeSessionMessages } from '../../src/provider/claude/session/claude-thread-replay.js'
import { replayPiSessionMessages } from '../../src/provider/pi/pi-thread-replay.js'

export class FakeSessionStore implements ProviderSessionStore {
  readonly records = new Map<string, ProviderSessionInfo>()
  readonly messageLists = new Map<string, SessionMessage[]>()
  readonly assistantModels = new Map<string, LastAssistantModel>()
  readonly deleted: string[] = []
  readonly renamed: { readonly id: string; readonly title: string }[] = []
  readonly tagged: { readonly id: string; readonly tag: string | null }[] = []
  readonly forked: { readonly sourceId: string; readonly title: string; readonly upToMessageId?: string }[] = []

  seed(info: ProviderSessionInfo, messages: readonly SessionMessage[] = []): void {
    this.records.set(info.ref.id, info)
    this.messageLists.set(info.ref.id, [...messages])
  }

  setAssistantModel(id: string, model: LastAssistantModel): void {
    this.assistantModels.set(id, model)
  }

  list(query: SessionListQuery): Promise<readonly ProviderSessionInfo[]> {
    const sessions = [...this.records.values()].filter((info) => {
      if (query.cwd === undefined) return true
      return info.cwd === query.cwd
    })
    sessions.sort((left, right) => right.lastModified - left.lastModified)
    return Promise.resolve(sessions)
  }

  read(ref: SessionRef): Promise<ProviderSessionInfo> {
    const info = this.records.get(ref.id)
    if (info?.ref.provider !== ref.provider) {
      return Promise.reject(new SessionError('session-not-found', 'Session not found'))
    }
    return Promise.resolve(info)
  }

  lastAssistantModel(ref: SessionRef): Promise<LastAssistantModel | undefined> {
    return this.read(ref).then(() => this.assistantModels.get(ref.id))
  }

  messages(ref: SessionRef, page?: SessionMessagePage): Promise<readonly SessionMessage[]> {
    return this.read(ref).then(() => pageSessionMessages(this.messageLists.get(ref.id) ?? [], page))
  }

  replay(ref: SessionRef, page?: SessionMessagePage): Promise<readonly ThreadReplayItem[]> {
    return this.messages(ref, page).then((messages) =>
      ref.provider === 'pi'
        ? replayPiSessionMessages(messages)
        : replayClaudeSessionMessages(messages),
    )
  }

  delete(ref: SessionRef): Promise<void> {
    return this.read(ref).then(() => {
      this.records.delete(ref.id)
      this.messageLists.delete(ref.id)
      this.deleted.push(ref.id)
    })
  }

  rename(ref: SessionRef, title: string): Promise<void> {
    return this.read(ref).then((info) => {
      this.records.set(ref.id, {
        ...info,
        customTitle: title,
        summary: title,
      })
      this.renamed.push({ id: ref.id, title })
    })
  }

  tag(ref: SessionRef, tag: string | null): Promise<void> {
    return this.read(ref).then((info) => {
      this.records.set(ref.id, { ...info, tag })
      this.tagged.push({ id: ref.id, tag })
    })
  }

  fork(
    ref: SessionRef,
    options: { title: string; upToMessageId?: string },
  ): Promise<ProviderSessionInfo> {
    if (ref.provider === 'pi') {
      return Promise.reject(new SessionError('invalid-request', 'Pi does not support fork'))
    }
    return this.read(ref).then((info) => {
      const sourceMessages = this.messageLists.get(ref.id) ?? []
      let messages = [...sourceMessages]
      if (options.upToMessageId !== undefined) {
        const index = messages.findIndex((message) => message.uuid === options.upToMessageId)
        if (index < 0) {
          throw new SessionError('invalid-request', 'Fork point message not found')
        }
        messages = messages.slice(0, index + 1)
      }
      const id = `fork-${ref.id}-${this.records.size}`
      const forked: ProviderSessionInfo = {
        ...info,
        ref: { provider: info.ref.provider, id },
        customTitle: options.title,
        summary: options.title,
        lastModified: Date.now(),
      }
      this.records.set(id, forked)
      this.messageLists.set(id, messages)
      this.forked.push({
        sourceId: ref.id,
        title: options.title,
        ...(options.upToMessageId === undefined ? {} : { upToMessageId: options.upToMessageId }),
      })
      return forked
    })
  }
}
