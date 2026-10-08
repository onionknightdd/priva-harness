import assert from 'node:assert/strict'
import os from 'node:os'
import { syncBuiltinESMExports } from 'node:module'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { mock } from 'node:test'

// Isolate SDK and extension home discovery from the developer's configuration.
const root = await mkdtemp(join(os.tmpdir(), 'pi-context-probe-'))
os.homedir = () => root
syncBuiltinESMExports()
process.env['PI_CODING_AGENT_DIR'] = join(root, 'agent')
const { AgentSession } = await import('@earendil-works/pi-coding-agent')
const { CodingAgentSessionFactory } = await import('../../../src/provider/pi/pi-session-factory.js')
const cwd = join(root, 'work')
await mkdir(cwd)
const session = await new CodingAgentSessionFactory(join(root, 'agent')).open({
  cwd, provider: 'pi', model: 'gpt-5.4', baseUrl: 'http://127.0.0.1:1/v1', authToken: 'fixture',
}, { kind: 'new', provider: 'pi' })
const usage = () => session.getContextUsage?.()
const select = async (model: string, window: 200000 | 1000000) => {
  if (!session.setRunModel) throw new Error('Missing model configuration method')
  await session.setRunModel(model, window)
}
try {
  assert.equal(usage()?.contextWindow, 200000)
  await select('gpt-5.4', 1000000)
  assert.equal(session.modelId, 'gpt-5.4')
  assert.equal(usage()?.contextWindow, 1000000)
  await select('gpt-5.4', 200000)
  assert.equal(usage()?.contextWindow, 200000)
  await select('custom:model', 1000000)
  assert.equal(session.modelId, 'custom:model')
  assert.equal(usage()?.contextWindow, 1000000)

  let compactions = 0
  mock.method(AgentSession.prototype, 'getContextUsage', function (this: InstanceType<typeof AgentSession>) {
    return { contextWindow: this.model?.contextWindow ?? 0, tokens: 300000, percent: 30 }
  })
  mock.method(AgentSession.prototype, 'compact', () => { compactions++; return Promise.reject(new Error('fixture compaction failed')) })
  await assert.rejects(select('custom:model', 200000), /fixture compaction failed/)
  assert.equal(compactions, 1)
  assert.equal(usage()?.contextWindow, 1000000)
  mock.restoreAll()
  await select('custom:model', 200000)
  assert.equal(usage()?.contextWindow, 200000)
  process.stdout.write('Pi context: built-in/custom models, same-ID updates and failed compaction passed\n')
} finally {
  mock.restoreAll()
  await session.dispose()
  await rm(root, { recursive: true, force: true })
}
