import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { foldThread } from '../../../../src/core/thread/fold-thread.js'
import {
  messagesFromContextEntries,
  PiSessionStore,
  type PiListedSession,
  type PiOpenedSession,
  type PiSessionManagerApi,
} from '../../../../src/provider/pi/pi-session-store.js'
import { piSessionBucketDir } from '../../../../src/provider/pi/pi-paths.js'

describe('PiSessionStore', () => {
  let agentDir: string
  let jsonlPath: string

  beforeEach(async () => {
    agentDir = await mkdtemp(join(tmpdir(), 'priva-pi-session-store-'))
    const bucket = piSessionBucketDir(agentDir, '/work/repo')
    await mkdir(bucket, { recursive: true })
    jsonlPath = join(bucket, '2026-01-01_sess.jsonl')
    await writeFile(jsonlPath, '{"type":"session","id":"bb-1"}\n')
  })

  afterEach(async () => {
    await rm(agentDir, { recursive: true, force: true })
  })

  it('maps active-branch context roles and does not write a Pi label on tag', async () => {
    const { opened, appendSessionInfo } = fakeOpenedSession()
    const store = new PiSessionStore({
      agentDir,
      sessionManager: fakeManager(listed(jsonlPath), opened),
    })

    const messages = await store.messages({ provider: 'pi', id: 'bb-1' })
    expect(messages.map((message) => message.type)).toEqual([
      'user',
      'assistant',
      'tool_result',
      'compaction',
      'custom',
    ])
    expect(messages.find((message) => message.type === 'tool_result')).toMatchObject({
      parentToolUseId: 'call-1',
    })

    await store.tag({ provider: 'pi', id: 'bb-1' }, 'work')
    expect(appendSessionInfo).not.toHaveBeenCalled()
  })

  it('renames via appendSessionInfo and unlinks the jsonl on delete', async () => {
    const { opened, appendSessionInfo } = fakeOpenedSession()
    const store = new PiSessionStore({
      agentDir,
      sessionManager: fakeManager(listed(jsonlPath), opened),
    })

    await store.rename({ provider: 'pi', id: 'bb-1' }, 'Feature')
    expect(appendSessionInfo).toHaveBeenCalledWith('Feature')

    await store.delete({ provider: 'pi', id: 'bb-1' })
    await expect(unlink(jsonlPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('shares one scan between overlapping lookups and scans again for later ones', async () => {
    const { opened } = fakeOpenedSession()
    const manager = fakeManager(listed(jsonlPath), opened)
    const listAll = vi.spyOn(manager, 'listAll')
    const store = new PiSessionStore({ agentDir, sessionManager: manager })
    const ref = { provider: 'pi', id: 'bb-1' } as const

    await Promise.all([store.read(ref), store.read(ref), store.lastAssistantModel(ref), store.list({})])
    expect(listAll).toHaveBeenCalledTimes(1)

    await store.read(ref)
    expect(listAll).toHaveBeenCalledTimes(2)
  })

  it('rescans when a lookup joined a scan that predates the session', async () => {
    const { opened } = fakeOpenedSession()
    let calls = 0
    let finishFirstScan = (): void => undefined
    const firstScan = new Promise<void>((resolve) => { finishFirstScan = resolve })
    const manager: PiSessionManagerApi = {
      list: () => Promise.resolve([]),
      listAll: async () => {
        calls += 1
        if (calls > 1) return [listed(jsonlPath)]
        await firstScan
        return []
      },
      open: () => opened,
    }
    const store = new PiSessionStore({ agentDir, sessionManager: manager })
    const earlier = store.list({})
    await vi.waitFor(() => expect(calls).toBe(1))
    const reading = store.read({ provider: 'pi', id: 'bb-1' })
    finishFirstScan()

    expect((await reading).ref.id).toBe('bb-1')
    expect(await earlier).toEqual([])
    expect(calls).toBe(2)
  })

  it('replays the whole branch in order while messages stay resume-faithful', async () => {
    const entry = (id: string, content: string) => ({ type: 'message', id, message: { role: 'user', content } })
    const compaction = { type: 'compaction', id: 'c1', summary: 'earlier turns', tokensBefore: 10, tokensAfter: 2, firstKeptEntryId: 'kept' }
    const opened: PiOpenedSession = {
      appendSessionInfo: () => undefined,
      // The SDK resumes from the summary and omits what it covers.
      buildContextEntries: () => [compaction, entry('kept', 'kept turn'), entry('after', 'after compaction')],
      getBranch: () => [entry('old', 'summarised turn'), entry('kept', 'kept turn'), compaction, entry('after', 'after compaction')],
    }
    const store = new PiSessionStore({ agentDir, sessionManager: fakeManager(listed(jsonlPath), opened) })
    const ref = { provider: 'pi', id: 'bb-1' } as const

    expect((await store.messages(ref)).map((message) => message.uuid)).toEqual(['c1', 'kept', 'after'])
    const thread = foldThread(await store.replay(ref))
    expect(thread.map((message) => message.compact ? 'compact' : message.content))
      .toEqual(['summarised turn', 'kept turn', 'compact', 'after compaction'])
  })

  it('rejects fork', async () => {
    const store = new PiSessionStore({
      agentDir,
      sessionManager: fakeManager(listed(jsonlPath), fakeOpenedSession().opened),
    })
    await expect(store.fork({ provider: 'pi', id: 'bb-1' }, { title: 'BB (1)' })).rejects.toMatchObject({
      kind: 'invalid-request',
      message: 'Pi does not support fork',
    })
  })

  it('still lists a planted jsonl after the ephemeral runs directory is removed', async () => {
    await mkdir(join(agentDir, 'runs', 'ephemeral'), { recursive: true })
    await rm(join(agentDir, 'runs'), { recursive: true, force: true })
    const store = new PiSessionStore({
      agentDir,
      sessionManager: fakeManager(listed(jsonlPath), fakeOpenedSession().opened),
    })
    const listedSessions = await store.list({})
    expect(listedSessions).toEqual([
      expect.objectContaining({
        ref: { provider: 'pi', id: 'bb-1' },
        customTitle: 'Named',
        gitBranch: null,
      }),
    ])
  })

  it('does not include custom status entries that are not in LLM context', () => {
    expect(messagesFromContextEntries([
      { type: 'custom', id: 'status-1' },
      {
        type: 'message',
        id: 'm1',
        message: { role: 'user', content: 'hi' },
      },
    ], 'bb-1').map((message) => message.type)).toEqual(['user'])
  })

  it('preserves product model audit entries for interrupted Codemode recovery', () => {
    const data = { parentToolCallId: 'outer', modelCalls: [], artifacts: [] }
    expect(messagesFromContextEntries([{ type: 'custom', id: 'audit', customType: 'harness-model-invocations', data }], 's')).toEqual([
      expect.objectContaining({ type: 'custom', message: { role: 'custom', customType: 'harness-model-invocations', data } }),
    ])
  })
})

function listed(path: string): PiListedSession {
  return {
    path,
    id: 'bb-1',
    cwd: '/work/repo',
    name: 'Named',
    modified: new Date('2026-01-01T00:00:00.000Z'),
    firstMessage: 'hello',
  }
}

function fakeOpenedSession(): {
  readonly opened: PiOpenedSession
  readonly appendSessionInfo: ReturnType<typeof vi.fn>
} {
  const appendSessionInfo = vi.fn()
  return {
    appendSessionInfo,
    opened: {
      appendSessionInfo(name: string) {
        appendSessionInfo(name)
      },
      buildContextEntries() {
        return [
          { type: 'message', id: 'e1', message: { role: 'user', content: 'hi' } },
          {
            type: 'message',
            id: 'e2',
            message: { role: 'assistant', model: 'm1', content: [] },
          },
          {
            type: 'message',
            id: 'e3',
            message: { role: 'toolResult', toolCallId: 'call-1', toolName: 'bash' },
          },
          {
            type: 'compaction',
            id: 'e4',
            summary: 'compacted',
            tokensBefore: 10,
            tokensAfter: 2,
          },
          {
            type: 'custom_message',
            id: 'e5',
            customType: 'note',
            content: 'keep me',
          },
          { type: 'custom', id: 'status' },
        ]
      },
      getBranch() {
        return [
          { type: 'message', id: 'e1', message: { role: 'user', content: 'hi' } },
          {
            type: 'message',
            id: 'e2',
            message: { role: 'assistant', model: 'm1', content: [] },
          },
          {
            type: 'message',
            id: 'e3',
            message: { role: 'toolResult', toolCallId: 'call-1', toolName: 'bash' },
          },
          {
            type: 'compaction',
            id: 'e4',
            summary: 'compacted',
            tokensBefore: 10,
            tokensAfter: 2,
          },
          {
            type: 'custom_message',
            id: 'e5',
            customType: 'note',
            content: 'keep me',
          },
          { type: 'custom', id: 'status' },
        ]
      },
    },
  }
}

function fakeManager(info: PiListedSession, opened: PiOpenedSession): PiSessionManagerApi {
  return {
    list: () => Promise.resolve([info]),
    listAll: () => Promise.resolve([info]),
    open: () => opened,
  }
}
