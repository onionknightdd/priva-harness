import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import Fastify from 'fastify'
import type * as A2uiRoutesModule from '../../../src/transport/http/route/a2ui.js'
import type * as BuiltinPluginsModule from '../../../src/core/plugin/builtin-plugins.js'
import { salesDashboardSource } from './sales-dashboard.source.js'

const buildDirectory = path.resolve(process.argv[2] ?? 'dist')
const routes = await import(pathToFileURL(path.join(buildDirectory, 'transport/http/route/a2ui.js')).href) as typeof A2uiRoutesModule
const registry = await import(pathToFileURL(path.join(buildDirectory, 'core/plugin/builtin-plugins.js')).href) as typeof BuiltinPluginsModule
const [plugin] = registry.resolveBuiltinPlugins(['agent-dashboard'])
assert.ok(plugin)
assert.equal(plugin.rootDir, path.join(buildDirectory, 'resources/plugins/agent-dashboard'))
for (const resource of ['plugin.json', '.claude-plugin/plugin.json', 'skill/SKILL.md', ...['catalog', 'cards', 'charts', 'tables', 'interactions', 'dashboard'].map((name) => `skill/resource/${name}.md`)]) {
  const actual: string = await readFile(path.join(plugin.rootDir, resource), 'utf8')
  const expected: string = await readFile(new URL(`../../../src/resources/plugins/agent-dashboard/${resource}`, import.meta.url), 'utf8')
  assert.equal(actual, expected, `Packaged resource differs: ${resource}`)
}

const server = Fastify()
await server.register(routes.a2uiRoutes)
const address = await server.listen({ host: '127.0.0.1', port: 0 })
try {
  const response = await fetch(`${address}/api/sandbox/a2ui/compile`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: salesDashboardSource }),
  })
  assert.equal(response.status, 200)
  const output: unknown = await response.json()
  const expected: unknown = JSON.parse(await readFile(new URL('../../../../../../agent-ui/tests/fixtures/a2ui/sales-dashboard.json', import.meta.url), 'utf8'))
  assert.deepEqual(output, expected)
  const invalid = await fetch(`${address}/api/sandbox/a2ui/compile`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'root = Column(children=[missing])' }),
  })
  assert.equal(invalid.status, 422)
  assert.match(await invalid.text(), /missing/u)
  process.stdout.write('Compiled A2UI HTTP: canonical dashboard, actionable errors and all packaged plugin resources passed\n')
} finally {
  await server.close()
}
