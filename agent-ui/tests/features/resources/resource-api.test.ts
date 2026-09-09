import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildSkillTree, filterResourceGroups, groupResourcesByProject, resourceSourceLabel, resourceUrl, type ResourceGroup, type ResourceSource } from '../../../src/features/resources/resource-api.ts'

const source: ResourceSource = { id: 'global', harness: 'pi', scope: 'global', origin: 'settings', label: 'Global · Pi', path: '/runtime/mcp.json', cwd: null, writable: true, canAdd: true }
const groups: ResourceGroup[] = [
  { source, items: [{ id: 'first', sourceId: 'global', name: 'echo', target: 'node', transport: 'stdio', enabled: true, effective: null, override: false, headerCount: 0 }] },
  { source: { ...source, id: 'project', scope: 'project', label: 'Project · Demo', path: '/repo/.pi/mcp.json', cwd: '/repo' }, items: [{ id: 'second', sourceId: 'project', name: 'echo', target: 'https://example.com/mcp', transport: 'http', enabled: true, effective: true, override: false, headerCount: 1 }] },
]

test('source-aware filtering preserves duplicate names and matches source paths', () => {
  assert.equal(filterResourceGroups(groups, 'echo').length, 2)
  assert.equal(filterResourceGroups(groups, ' DEMO ')[0]?.source.id, 'project')
  assert.equal(filterResourceGroups(groups, '/runtime/')[0]?.source.id, 'global')
  assert.deepEqual(filterResourceGroups(groups, 'missing'), [])
  assert.equal(groups.length, 2)
})

test('encodes cwd and relative skill file independently', () => {
  const url = new URL(resourceUrl('skills/id/file', { harness: 'pi', cwd: '/work/a & b' }, { path: 'references/中文.md' }), 'http://localhost')
  assert.equal(url.searchParams.get('cwd'), '/work/a & b')
  assert.equal(url.searchParams.get('path'), 'references/中文.md')
  assert.equal(url.searchParams.get('harness'), 'pi')
})

test('builds nested skill folders before files and preserves selectable relative paths', () => {
  const nodes = buildSkillTree([{ path: 'SKILL.md', size: 1 }, { path: 'references/deep/example.md', size: 1 }, { path: 'references/readme.md', size: 1 }])
  assert.deepEqual(nodes.map((node) => node.name), ['references', 'SKILL.md'])
  assert.equal(nodes[0]?.children[0]?.children[0]?.path, 'references/deep/example.md')
  assert.equal(nodes[1]?.file, true)
})

test('nests project and local sources by full cwd while displaying only the directory name', () => {
  const inputs: ResourceGroup[] = [
    groups[0]!,
    { source: { ...source, id: 'one', scope: 'project', cwd: '/work/client/app', path: '/work/client/app/.pi/mcp.json' }, items: [] },
    { source: { ...source, id: 'local', scope: 'local', cwd: '/work/client/app', path: '/runtime/.claude.json' }, items: [] },
    { source: { ...source, id: 'two', scope: 'project', cwd: '/work/internal/app', path: '/work/internal/app/.mcp.json' }, items: [] },
  ]
  const grouped = groupResourcesByProject(inputs)
  assert.equal(grouped.global[0]?.source.id, 'global')
  assert.deepEqual(grouped.projects.map(({ cwd, name, groups }) => ({ cwd, name, sources: groups.map((group) => group.source.id) })), [
    { cwd: '/work/client/app', name: 'app', sources: ['one', 'local'] },
    { cwd: '/work/internal/app', name: 'app', sources: ['two'] },
  ])
  assert.equal(resourceSourceLabel(inputs[1]!.source), '.pi/mcp.json')
  assert.equal(resourceSourceLabel(inputs[2]!.source), 'Local · .claude.json')
})
