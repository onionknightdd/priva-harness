import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { materializeClaudeImages } from '../../../../src/provider/claude/session/claude-image-attachments.js'
import { mapClaudeMessage } from '../../../../src/provider/claude/session/claude-session-store.js'
import { replayClaudeSessionMessages } from '../../../../src/provider/claude/session/claude-thread-replay.js'
import { foldThread } from '../../../../src/core/resource/fold-thread.js'

it('projects an image-only native paste to a private attachment without duplicating files on replay', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-image-'))
  try {
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')
    const row = mapClaudeMessage({ type: 'user', uuid: 'image', session_id: 's', message: { role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: bytes.toString('base64') } },
    ] } }, 's')
    const first = await materializeClaudeImages(row, root)
    expect(await materializeClaudeImages(row, root)).toEqual(first)
    expect(await readdir(root)).toHaveLength(1)
    const image = first[0]
    if (!image) throw new Error('Image was lost')
    expect(await readFile(image.path)).toEqual(bytes)
    expect((await stat(image.path)).mode & 0o777).toBe(0o600)
    const messages = foldThread(replayClaudeSessionMessages([row], new Map([[row.uuid, first]])))
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ role: 'user', attachments: first })
  } finally { await rm(root, { recursive: true, force: true }) }
})
