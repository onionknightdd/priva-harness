import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

import { userTurnText } from '../../../../src/core/run/user-turn.js'

const execFileAsync = promisify(execFile)

it('keeps an attachment-only transcript discoverable through the native SDK title', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'attachment-session-index-')))
  try {
    const cwd = path.join(root, 'workspace')
    const configDir = path.join(root, 'claude')
    const projectDir = path.join(configDir, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'))
    await mkdir(cwd)
    await mkdir(projectDir, { recursive: true })
    const sessionId = randomUUID()
    const transcriptPath = path.join(projectDir, `${sessionId}.jsonl`)
    const transcript = `${JSON.stringify({
      type: 'user',
      uuid: randomUUID(),
      parentUuid: null,
      isSidechain: false,
      cwd,
      sessionId,
      timestamp: new Date().toISOString(),
      message: {
        role: 'user',
        content: userTurnText({
          text: '',
          attachments: [{ path: path.join(cwd, 'README.md'), name: 'README.md', mimeType: 'text/markdown', size: 1 }],
        }),
      },
    })}\n`
    await writeFile(transcriptPath, transcript)

    // A child process isolates the SDK's global config-directory lookup from
    // other tests and from the developer's real session store.
    const script = `
      import { getSessionInfo, listSessions, renameSession } from ${JSON.stringify(import.meta.resolve('@anthropic-ai/claude-agent-sdk'))}
      const sessionId = ${JSON.stringify(sessionId)}
      const options = { dir: ${JSON.stringify(cwd)} }
      const before = {
        readable: (await getSessionInfo(sessionId, options)) !== undefined,
        listed: (await listSessions(options)).some(session => session.sessionId === sessionId),
      }
      await renameSession(sessionId, 'README.md', options)
      const info = await getSessionInfo(sessionId, options)
      const listed = (await listSessions(options)).some(session => session.sessionId === sessionId)
      process.stdout.write(JSON.stringify({ before, after: { title: info?.customTitle, listed } }))
    `
    const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    })
    expect(JSON.parse(stdout)).toEqual({
      before: { readable: false, listed: false },
      after: { title: 'README.md', listed: true },
    })
    const updated = await readFile(transcriptPath, 'utf8')
    expect(updated.startsWith(transcript)).toBe(true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
