import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { WHITEBOARD_ENDPOINT_ENV, whiteboardWriteTool } from '../../../src/core/tool/whiteboard.js'
import { writeNativeProductConfig } from '../../../src/provider/claude/tools/native-product-launch.js'
import { piTerminalLaunch } from '../../../src/provider/pi/pi-terminal-launch.js'
import { testRunSpec } from '../../support/run-spec.js'

const roots: string[] = []
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
it('passes the Runner discovery file explicitly to native Claude MCP and Pi hosts', async () => {
  const scratchDir = await mkdtemp(join(tmpdir(), 'board-launch-')); roots.push(scratchDir)
  const endpoint = join(scratchDir, 'whiteboard-endpoint.json')
  vi.stubEnv(WHITEBOARD_ENDPOINT_ENV, endpoint)
  const spec = testRunSpec({ cwd: scratchDir })
  await writeNativeProductConfig(scratchDir, { kind: 'new', provider: 'claude', sessionId: 'claude' }, spec, [whiteboardWriteTool])
  expect(JSON.parse(await readFile(join(scratchDir, 'product-mcp.json'), 'utf8'))).toMatchObject({ mcpServers: { agentWorkshop: { env: { [WHITEBOARD_ENDPOINT_ENV]: endpoint } } } })
  const pi = await piTerminalLaunch(scratchDir, { kind: 'new', provider: 'pi', sessionId: 'pi' }, spec, { scratchDir, cols: 80, rows: 24 })
  expect(pi.env[WHITEBOARD_ENDPOINT_ENV]).toBe(endpoint)
})
