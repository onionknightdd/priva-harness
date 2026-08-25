import { describe, expect, it } from 'vitest'

import {
  patchFromToolDetails,
  unifiedDiffFromStructuredPatch,
} from '../../../../src/core/event/tool-patch.js'

describe('unifiedDiffFromStructuredPatch', () => {
  const hunk = {
    oldStart: 12,
    oldLines: 3,
    newStart: 12,
    newLines: 3,
    lines: [' keep', '-const a = 1', '+const a = 2'],
  }

  it('emits @@ headers with file line numbers from Claude hunks', () => {
    expect(unifiedDiffFromStructuredPatch({ structuredPatch: [hunk] })).toBe(
      [
        '@@ -12,3 +12,3 @@',
        ' keep',
        '-const a = 1',
        '+const a = 2',
      ].join('\n'),
    )
  })

  it('accepts a bare hunk array', () => {
    expect(unifiedDiffFromStructuredPatch([hunk])).toContain('@@ -12,3 +12,3 @@')
  })

  it('counts omitted oldLines/newLines from hunk prefixes', () => {
    expect(
      unifiedDiffFromStructuredPatch({
        structuredPatch: [{
          oldStart: 5,
          newStart: 5,
          lines: [' context', '-gone', '+here'],
        }],
      }),
    ).toBe(
      [
        '@@ -5,2 +5,2 @@',
        ' context',
        '-gone',
        '+here',
      ].join('\n'),
    )
  })

  it('returns empty when structuredPatch is missing', () => {
    expect(unifiedDiffFromStructuredPatch({ filePath: 'a.ts' })).toBe('')
    expect(unifiedDiffFromStructuredPatch([])).toBe('')
    expect(unifiedDiffFromStructuredPatch(undefined)).toBe('')
  })
})

describe('patchFromToolDetails', () => {
  it('prefers details.patch over TUI details.diff', () => {
    expect(patchFromToolDetails({
      content: 'edited',
      details: {
        diff: 'pretty tui view',
        patch: '@@ -5,1 +5,1 @@\n-a\n+b',
      },
    })).toBe('@@ -5,1 +5,1 @@\n-a\n+b')
  })

  it('uses details.diff only when it already looks like unified diff', () => {
    expect(patchFromToolDetails({
      details: { diff: '@@ -8,1 +8,1 @@\n-old\n+new' },
    })).toBe('@@ -8,1 +8,1 @@\n-old\n+new')
    expect(patchFromToolDetails({
      details: { diff: 'pretty tui view' },
    })).toBe('')
  })

  it('reads a top-level patch field', () => {
    expect(patchFromToolDetails({
      patch: '--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-a\n+b',
    })).toContain('@@ -1,1 +1,1 @@')
  })
})
