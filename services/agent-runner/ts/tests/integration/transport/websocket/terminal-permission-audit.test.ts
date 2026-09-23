import { readFile, stat } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { nativeClaudeAvailable, nativeClaudeFixture, modelMessage } from '../../../fixtures/terminal/claude-tui-fixture.js'
import { MemoryDataRecorder } from '../../../support/memory-data-recorder.js'

it.skipIf(!nativeClaudeAvailable()).each(['allow', 'deny'])('audits native permission %s once with the original request and tool IDs', async (decision) => {
  let calls = 0
  const recorder = new MemoryDataRecorder()
  const fixture = await nativeClaudeFixture((body, reply) => modelMessage(body, reply, ++calls === 1
    ? [{ type: 'tool_use', id: 'native-write', name: 'Write', input: { file_path: `${fixture.root}/example.txt`, content: 'fixture' } }]
    : [{ type: 'text', text: 'done' }], `permission-${calls}`), recorder, { permissionMode: 'default' })
  try {
    fixture.send('Write the fixture', 'native-permission')
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'permission.requested'), { timeout: 30000 }).toBe(true)
    const request = fixture.frames.find((frame) => frame.type === 'permission.requested')
    if (request?.type !== 'permission.requested') throw new Error('Missing permission request')
    await expect.poll(async () => (await fixture.terminals.capture(fixture.ref)).includes('Do you want to create example.txt?')).toBe(true)
    if (decision === 'deny') {
      await fixture.terminals.sendKeys(fixture.ref, ['Down', 'Down'])
      await expect.poll(async () => (await fixture.terminals.capture(fixture.ref)).includes('❯ 3. No')).toBe(true)
    }
    await fixture.terminals.sendKeys(fixture.ref, ['Enter'])
    await expect.poll(() => recorder.ofKind('run.finished').length, { timeout: 10000 }).toBe(1)
    expect(recorder.ofKind('audit').filter((record) => record.action === 'permission.resolved')).toEqual([
      expect.objectContaining({ runId: 'native-permission', sessionId: fixture.ref.id, target: 'Write',
        details: expect.objectContaining({ requestId: request.request.requestId, toolUseId: 'native-write', decision,
          reason: decision === 'allow' ? 'answered' : 'skipped', latencyMs: expect.any(Number) as number }) as unknown }),
    ])
    expect(recorder.ofKind('run.finished')[0]).toMatchObject({ outcome: decision === 'allow' ? 'completed' : 'aborted', usage: { input: decision === 'allow' ? 20 : 10 } })
    expect(fixture.harness.sessionStream(fixture.ref).snapshot().interactions).toHaveLength(0)
    if (decision === 'allow') expect(await readFile(`${fixture.root}/example.txt`, 'utf8')).toBe('fixture')
    else await expect(stat(`${fixture.root}/example.txt`)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(fixture.sdkOpen).not.toHaveBeenCalled()
  } catch (error) {
    if (fixture.ref.id) console.error(await fixture.terminals.capture(fixture.ref))
    console.error(recorder.records)
    throw error
  } finally { await fixture.dispose() }
}, 60000)
