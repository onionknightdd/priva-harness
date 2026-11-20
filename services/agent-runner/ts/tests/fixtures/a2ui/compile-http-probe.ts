import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import Fastify from 'fastify'
import type * as A2uiRoutesModule from '../../../src/transport/http/route/a2ui.js'
import type * as BuiltinPluginsModule from '../../../src/core/plugin/builtin-plugins.js'
import { salesDashboardSource } from './sales-dashboard.source.js'
import { mediaSource } from './media.source.js'
import { gallerySource } from './gallery.source.js'

const buildDirectory = path.resolve(process.argv[2] ?? 'dist')
const routes = await import(pathToFileURL(path.join(buildDirectory, 'transport/http/route/a2ui.js')).href) as typeof A2uiRoutesModule
const registry = await import(pathToFileURL(path.join(buildDirectory, 'core/plugin/builtin-plugins.js')).href) as typeof BuiltinPluginsModule
const [plugin] = registry.resolveBuiltinPlugins(['agent-dashboard'])
assert.ok(plugin)
assert.equal(plugin.rootDir, path.join(buildDirectory, 'resources/plugins/agent-dashboard'))
const examples: { resource: string; source: string }[] = []
for (const resource of ['plugin.json', '.claude-plugin/plugin.json', 'skills/agent-dashboard/SKILL.md', ...['catalog', 'cards', 'charts', 'tables', 'interactions', 'tabs', 'media', 'gallery', 'dashboard'].map((name) => `skills/agent-dashboard/resource/${name}.md`)]) {
  const actual: string = await readFile(path.join(plugin.rootDir, resource), 'utf8')
  const expected: string = await readFile(new URL(`../../../src/resources/plugins/agent-dashboard/${resource}`, import.meta.url), 'utf8')
  assert.equal(actual, expected, `Packaged resource differs: ${resource}`)
  for (const match of actual.matchAll(/^```a2ui id=[a-z][a-z0-9-]{0,63}\n([\s\S]*?)\n```$/gmu)) {
    assert.ok(match[1])
    examples.push({ resource, source: match[1] })
  }
}
assert.ok(examples.some((example) => example.resource === 'skills/agent-dashboard/resource/gallery.md'))

const server = Fastify()
await server.register(routes.a2uiRoutes)
const address = await server.listen({ host: '127.0.0.1', port: 0 })
try {
  for (const [name, source] of Object.entries({ 'sales-dashboard': salesDashboardSource, media: mediaSource, gallery: gallerySource })) {
    const response = await fetch(`${address}/api/sandbox/a2ui/compile`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source }),
    })
    assert.equal(response.status, 200)
    const output: unknown = await response.json()
    const expected: unknown = JSON.parse(await readFile(new URL(`../../../../../../agent-ui/tests/fixtures/a2ui/${name}.json`, import.meta.url), 'utf8'))
    assert.deepEqual(output, expected)
  }
  for (const { resource, source } of examples) {
    const response = await fetch(`${address}/api/sandbox/a2ui/compile`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source }),
    })
    assert.equal(response.status, 200, `Packaged example failed to compile: ${resource}: ${await response.text()}`)
  }
  const invalid = await fetch(`${address}/api/sandbox/a2ui/compile`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'root = Column(children=[missing])' }),
  })
  assert.equal(invalid.status, 422)
  assert.match(await invalid.text(), /missing/u)
  const invalidGallery = await fetch(`${address}/api/sandbox/a2ui/compile`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      source: '$/url = "file:///workspace/image.png"\nroot = ImageGallery(images=[{url:$/url,description:"Image"}])',
    }),
  })
  assert.equal(invalidGallery.status, 422)
  assert.match(await invalidGallery.text(), /ImageGallery.*url must/u)
  process.stdout.write('Compiled A2UI HTTP: canonical dashboard/media/gallery, actionable errors and all packaged plugin resources passed\n')
} finally {
  await server.close()
}
