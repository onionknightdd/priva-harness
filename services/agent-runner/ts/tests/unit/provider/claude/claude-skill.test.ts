import { describe, expect, it } from 'vitest'
import { ClaudeEventMapper } from '../../../../src/provider/claude/claude-event-mapper.js'
import { mapClaudeMessage } from '../../../../src/provider/claude/session/claude-session-store.js'
import { replayClaudeSessionMessages } from '../../../../src/provider/claude/session/claude-thread-replay.js'
import { mergeSdkAndTranscriptMessages, transcriptThreadRecords } from '../../../../src/provider/claude/session/claude-transcript.js'

const markdown = '# Skill reference\n\n- Read the files\n- **Verify** results'
const records = [
  { type: 'assistant', uuid: 'a1', message: { id: 'a1', role: 'assistant', content: [{ type: 'tool_use', id: 's1', name: 'Skill', input: { skill: 'review' } }] } },
  { type: 'user', uuid: 'r1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 's1', content: 'Launching skill: review' }] } },
  { type: 'user', uuid: 'm1', isMeta: true, sourceToolUseID: 's1', message: { role: 'user', content: [{ type: 'text', text: markdown }] } },
]

describe('Skill content', () => {
  it('attaches live Markdown to the exact Skill tool', () => {
    const mapper = new ClaudeEventMapper()
    const events = records.flatMap((record) => mapper.push(record))
    expect(events.at(-1)).toMatchObject({ type: 'tool.completed', id: 's1', name: 'skill', output: markdown })
    expect(mapper.push({ type: 'user', sourceToolUseID: 'unknown', message: records[2]?.message })).toEqual([])
  })

  it('preserves metadata through transcript merging and replays it as tool output', () => {
    const transcript = transcriptThreadRecords(records.map((record) => JSON.stringify(record)))
    const sdk = records.map(({ message, uuid, type }) => ({ message, uuid, type }))
    const merged = mergeSdkAndTranscriptMessages(sdk, transcript)
    const frames = replayClaudeSessionMessages(merged.map((record) => mapClaudeMessage(record, 'session')))
    expect(frames.some((item) => item.kind === 'user')).toBe(false)
    expect(frames.at(-1)).toMatchObject({ kind: 'frame', event: { type: 'tool.completed', id: 's1', output: markdown } })
  })
})
