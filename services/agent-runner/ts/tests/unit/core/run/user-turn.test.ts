import { describe, expect, it } from 'vitest'

import { userTurnFromText, userTurnSummary, userTurnText } from '../../../../src/core/run/user-turn.js'
import { foldThread } from '../../../../src/core/resource/fold-thread.js'
import type { SessionMessage } from '../../../../src/core/resource/session.js'
import { replayClaudeSessionMessages } from '../../../../src/provider/claude/session/claude-thread-replay.js'
import { replayPiSessionMessages } from '../../../../src/provider/pi/pi-thread-replay.js'
import { parseInitFrame } from '../../../../src/transport/websocket/schema/run-frames.js'

const attachments = [{ path: '/workspace/销售 report.csv', name: '销售 report.csv', size: 12, mimeType: 'text/csv' }]

describe('user turn attachments', () => {
  it('keeps manifests out of session titles, including truncated provider summaries', () => {
    const encoded = userTurnText({ text: '', attachments })
    expect(userTurnSummary(encoded)).toBe('销售 report.csv')
    expect(userTurnSummary(encoded.trim())).toBe('销售 report.csv')
    expect(userTurnSummary(encoded.slice(0, 80))).toBe('Attached files')
    expect(userTurnSummary(userTurnText({ text: 'Read this', attachments }).slice(0, 80))).toBe('Read this')
    expect(userTurnSummary('plain prompt')).toBe('plain prompt')
  })
  it('keeps plain text unchanged and preserves user text exactly on round trip', () => {
    expect(userTurnText({ text: 'hello' })).toBe('hello')
    const turn = { text: '请分析\n\n这些文件  ', attachments }
    expect(userTurnFromText(userTurnText(turn))).toEqual(turn)
    expect(userTurnText(turn)).toContain(attachments[0]?.path)
  })

  it('does not strip malformed or ordinary user content', () => {
    const encoded = userTurnText({ text: 'hello', attachments })
    for (const text of ['hello', '<priva-attachments>example</priva-attachments>', encoded.replace('"size":12', '"size":-1'), encoded.replace('[{', '[broken{')]) {
      expect(userTurnFromText(text)).toEqual({ text })
    }
  })

  it.each([
    ['claude', replayClaudeSessionMessages],
    ['pi', replayPiSessionMessages],
  ] as const)('restores %s native transcript attachments, including attachment-only messages', (_, replay) => {
    for (const text of ['请分析', '']) {
      const turn = { text, attachments }
      const message: SessionMessage = {
        type: 'user', uuid: 'u1', sessionId: 's1', parentToolUseId: null,
        metadata: null, timestamp: 1700000000000,
        message: { role: 'user', content: [{ type: 'text', text: userTurnText(turn) }] },
      }
      expect(foldThread(replay([message]))).toEqual([
        expect.objectContaining({ id: 'u1', role: 'user', content: text, attachments, transcriptUuid: 'u1' }),
      ])
    }
  })

  it('accepts attachment-only input and rejects empty or invalid attachments', () => {
    const init = { type: 'init', text: '', model: 'm', harness: 'claude', cwd: '/workspace', attachments }
    expect(parseInitFrame(init)).toMatchObject({ ok: true, frame: { text: '', attachments } })
    expect(parseInitFrame({ ...init, attachments: [] })).toMatchObject({ ok: false })
    expect(parseInitFrame({ ...init, attachments: [{ ...attachments[0], path: '' }] })).toMatchObject({ ok: false })
    expect(parseInitFrame({ ...init, attachments: 'file.csv' })).toMatchObject({ ok: false })
  })
})
