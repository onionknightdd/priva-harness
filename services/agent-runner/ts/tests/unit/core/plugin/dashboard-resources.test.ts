import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { compileA2uiSource } from '../../../../src/core/a2ui/compiler.js'
import { a2uiCatalogDefinition } from '../../../../src/core/a2ui/catalog.generated.js'
import { resolveBuiltinPlugins } from '../../../../src/core/plugin/builtin-plugins.js'

const plugin = resolveBuiltinPlugins(['agent-dashboard'])[0]
if (plugin === undefined) throw new Error('Missing dashboard skill')
const skillDir = plugin.skillDir

describe('Agent dashboard skill resources', () => {
  it('provides valid native skill frontmatter', () => {
    const document = readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8')
    const source = /^---\n([\s\S]*?)\n---/u.exec(document)?.[1]
    if (source === undefined) throw new Error('Missing skill frontmatter')
    const metadata: unknown = parse(source)
    expect(metadata).toMatchObject({ name: 'agent-dashboard' })
    if (typeof metadata !== 'object' || metadata === null || !('description' in metadata)) throw new Error('Missing skill description')
    expect(metadata.description).toBeTypeOf('string')
  })

  it.each(['SKILL.md', 'resource/cards.md', 'resource/charts.md', 'resource/tables.md', 'resource/interactions.md', 'resource/tabs.md', 'resource/media.md', 'resource/gallery.md', 'resource/dashboard.md'])('compiles every complete example in %s against the real catalog', (file) => {
    const document = readFileSync(path.join(skillDir, file), 'utf8')
    const examples = [...document.matchAll(/^```a2ui id=([a-z][a-z0-9-]{0,63})\n([\s\S]*?)\n```$/gmu)]
    expect(examples.length).toBeGreaterThan(0)
    for (const match of examples) {
      const [, id, source] = match
      if (id === undefined || source === undefined) throw new Error('Incomplete example')
      expect(document).toContain(`](a2ui:${id})`)
      const output = compileA2uiSource(source)
      expect(output.messages).not.toHaveLength(0)
      expect(output.messages[0]).toMatchObject({ version: 'v1.0', createSurface: { surfaceId: 'main' } })
    }
  })

  it('keeps the generated reference identical to the supported component schema', () => {
    const document = readFileSync(path.join(skillDir, 'resource/catalog.md'), 'utf8')
    const source = /^```json\n([\s\S]*?)\n```$/mu.exec(document)?.[1]
    if (source === undefined) throw new Error('Missing generated catalog')
    const documented: unknown = JSON.parse(source)
    expect(documented).toEqual(a2uiCatalogDefinition['components'])
  })
})
