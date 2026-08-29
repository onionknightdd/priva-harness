import { describe, expect, it } from 'vitest'

import {
  attachTranscriptToolUseResult,
  mergeSdkAndTranscriptMessages,
  toolUseResultsFromTranscriptLines,
  transcriptThreadRecords,
} from '../../../../src/provider/claude/session/claude-transcript.js'

const editPatch = {
  structuredPatch: [{
    oldStart: 4,
    oldLines: 8,
    newStart: 4,
    newLines: 7,
    lines: [' ', ' ## 今日要点', '-- 完成文件写入测试', '+测试'],
  }],
}

describe('toolUseResultsFromTranscriptLines', () => {
  it('indexes camelCase JSONL-root toolUseResult by uuid and tool_use_id', () => {
    const results = toolUseResultsFromTranscriptLines([
      'not-json',
      JSON.stringify({
        type: 'user',
        uuid: 't1',
        isSidechain: false,
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: 'edit-1',
            content: 'The file has been updated successfully.',
          }],
        },
        toolUseResult: editPatch,
      }),
    ])
    expect(results.get('uuid:t1')).toEqual(editPatch)
    expect(results.get('tool:edit-1')).toEqual(editPatch)
  })

  it('does not let a sidechain overwrite a main-thread tool_use_id mapping', () => {
    const results = toolUseResultsFromTranscriptLines([
      JSON.stringify({
        type: 'user',
        uuid: 'main',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'shared', content: 'ok' }],
        },
        toolUseResult: { structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [' keep'] }] },
      }),
      JSON.stringify({
        type: 'user',
        uuid: 'side',
        isSidechain: true,
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'shared', content: 'other' }],
        },
        toolUseResult: { stdout: 'from-sidechain' },
      }),
    ])
    expect(results.get('tool:shared')).toEqual({
      structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [' keep'] }],
    })
    expect(results.get('uuid:side')).toEqual({ stdout: 'from-sidechain' })
  })
})

describe('attachTranscriptToolUseResult', () => {
  it('copies a missing result onto an SDK-shaped user message', () => {
    const results = toolUseResultsFromTranscriptLines([
      JSON.stringify({
        type: 'user',
        uuid: 't1',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'edit-1', content: 'ok' }],
        },
        toolUseResult: editPatch,
      }),
    ])
    const attached = attachTranscriptToolUseResult({
      type: 'user',
      uuid: 't1',
      session_id: 'sess-1',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'edit-1', content: 'ok' }],
      },
    }, results)
    expect(attached).toMatchObject({ tool_use_result: editPatch })
  })

  it('falls back to tool_use_id when the SDK uuid does not match JSONL', () => {
    const results = toolUseResultsFromTranscriptLines([
      JSON.stringify({
        type: 'user',
        uuid: 'jsonl-1',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'edit-1', content: 'ok' }],
        },
        toolUseResult: editPatch,
      }),
    ])
    const attached = attachTranscriptToolUseResult({
      type: 'user',
      uuid: 'sdk-other',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'edit-1', content: 'ok' }],
      },
    }, results)
    expect(attached).toMatchObject({ tool_use_result: editPatch })
  })

  it('does not overwrite a result already present on the SDK message', () => {
    const results = new Map<string, unknown>([['uuid:t1', editPatch]])
    const raw = {
      type: 'user',
      uuid: 't1',
      tool_use_result: { stdout: 'keep-sdk' },
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'bash-1', content: 'ok' }] },
    }
    expect(attachTranscriptToolUseResult(raw, results)).toBe(raw)
  })
})

describe('transcriptThreadRecords', () => {
  it('keeps main-thread user and assistant records and drops compact plumbing', () => {
    const records = transcriptThreadRecords([
      JSON.stringify({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'hello' } }),
      JSON.stringify({ type: 'queue-operation', operation: 'enqueue', content: '/compact' }),
      JSON.stringify({
        type: 'system',
        subtype: 'compact_boundary',
        uuid: 'b1',
        content: 'Conversation compacted',
      }),
      JSON.stringify({
        type: 'user',
        uuid: 'meta',
        isMeta: true,
        message: { role: 'user', content: '<local-command-caveat>skip</local-command-caveat>' },
      }),
      JSON.stringify({
        type: 'user',
        uuid: 'cmd',
        message: {
          role: 'user',
          content: '<command-name>/compact</command-name>\n<command-message>compact</command-message>',
        },
      }),
    ])
    expect(records.map((record) => (record as { uuid: string }).uuid)).toEqual(['u1', 'cmd'])
  })

  it('drops the synthetic No response requested assistant', () => {
    const records = transcriptThreadRecords([
      JSON.stringify({
        type: 'assistant',
        uuid: 'syn',
        message: {
          role: 'assistant',
          model: '<synthetic>',
          content: [{ type: 'text', text: 'No response requested.' }],
        },
      }),
      JSON.stringify({
        type: 'user',
        uuid: 'u2',
        message: { role: 'user', content: '不用了' },
      }),
    ])
    expect(records.map((record) => (record as { uuid: string }).uuid)).toEqual(['u2'])
  })
})

describe('mergeSdkAndTranscriptMessages', () => {
  it('restores pre-compact transcript turns that the SDK parent-chain walk dropped', () => {
    const earlyUser = { type: 'user', uuid: 'u1', message: { role: 'user', content: '写一个mock 的sre 大盘' } }
    const earlyAssistant = {
      type: 'assistant',
      uuid: 'a-tool',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'edit-1', name: 'Edit' }] },
    }
    const tail = {
      type: 'assistant',
      uuid: 'a-tail',
      message: { role: 'assistant', content: [{ type: 'text', text: '完成。' }] },
    }
    const command = {
      type: 'user',
      uuid: 'cmd',
      message: { role: 'user', content: '<command-name>/compact</command-name>' },
    }
    const sdkTail = { ...tail, session_id: 'sess-1' }

    const merged = mergeSdkAndTranscriptMessages(
      [sdkTail, command],
      [earlyUser, earlyAssistant, tail, command],
    )

    expect(merged.map((record) => (record as { uuid: string }).uuid)).toEqual([
      'u1',
      'a-tool',
      'a-tail',
      'cmd',
    ])
    expect(merged[2]).toBe(sdkTail)
  })

  it('does not append a synthetic No response requested leftover from the SDK', () => {
    const user = { type: 'user', uuid: 'u1', message: { role: 'user', content: '写完了吗' } }
    const answer = {
      type: 'assistant',
      uuid: 'a1',
      message: { role: 'assistant', content: [{ type: 'text', text: '已经写完。' }] },
    }
    const synthetic = {
      type: 'assistant',
      uuid: 'syn',
      message: {
        role: 'assistant',
        model: '<synthetic>',
        content: [{ type: 'text', text: 'No response requested.' }],
      },
    }

    const merged = mergeSdkAndTranscriptMessages(
      [user, answer, synthetic],
      [user, answer],
    )

    expect(merged.map((record) => (record as { uuid: string }).uuid)).toEqual(['u1', 'a1'])
  })
})
