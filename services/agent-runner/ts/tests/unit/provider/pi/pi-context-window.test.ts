import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

it('applies context windows through the real Pi model registry and agent session', async () => {
  const result = await promisify(execFile)(process.execPath,
    ['--import', 'tsx', 'tests/fixtures/resources/pi-context-probe.ts'], { timeout: 20000 })
  expect(result.stdout).toContain('same-ID updates and failed compaction passed')
}, 25000)
