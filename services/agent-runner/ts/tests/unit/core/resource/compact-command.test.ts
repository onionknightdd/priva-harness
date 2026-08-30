import { describe, expect, it } from 'vitest'

import {
  compactInstructionsOf,
  compactSummaryBody,
  isCompactCommandContent,
  isHiddenCompactUserContent,
  mergeCompactMarker,
} from '../../../../src/core/resource/compact-command.js'

describe('compact-command', () => {
  it('parses live and envelope compact commands', () => {
    expect(isCompactCommandContent('/compact')).toBe(true)
    expect(isCompactCommandContent('/compact keep files')).toBe(true)
    expect(isCompactCommandContent(
      '<command-name>/compact</command-name>\n<command-message>compact</command-message>',
    )).toBe(true)
    expect(compactInstructionsOf('/compact keep files')).toBe('keep files')
    expect(compactInstructionsOf('/compact')).toBeUndefined()
  })

  it('hides continuation, caveat, and stdout', () => {
    expect(isHiddenCompactUserContent(
      'This session is being continued from a previous conversation that ran out of context.',
    )).toBe(true)
    expect(isHiddenCompactUserContent('<local-command-stdout>Compacted </local-command-stdout>')).toBe(true)
    expect(compactSummaryBody(
      'This session is being continued from a previous conversation.\n\nSummary:\nKept tokens.',
    )).toBe('Kept tokens.')
  })

  it('does not let compacting overwrite a completed summary', () => {
    expect(mergeCompactMarker(
      { phase: 'compacted', summary: 'done' },
      { phase: 'compacting' },
    )).toEqual({ phase: 'compacted', summary: 'done' })
  })
})
