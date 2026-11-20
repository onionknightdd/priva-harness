import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { resolveOriginalComputerSkills } from '../../../../src/core/plugin/original-computer-skills.js'
import { stageLinuxComputerSkill } from '../../../../scripts/computer-use/stage-linux-sky-skill.js'

let root: string
let runtime: string
let staged: string
const text = '---\nname: computer-use\ndescription: Linux desktop\n---\nUse sky.list_windows().\n'
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sky-skill-'))
  runtime = join(root, 'cua_node')
  staged = join(root, 'skills')
  mkdirSync(staged, { mode: 0o700 })
  const sky = join(runtime, 'lib/node_modules/@oai/sky')
  mkdirSync(join(sky, 'docs/skills/oai_sky_lib/linux'), { recursive: true })
  writeFileSync(join(runtime, 'manifest.json'), JSON.stringify({ platform: 'linux', arch: 'arm64' }))
  writeFileSync(join(sky, 'package.json'), JSON.stringify({ name: '@oai/sky', version: '0.7.21' }))
  writeFileSync(join(sky, 'docs/skills/oai_sky_lib/linux/SKILL.md'), text)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

it('preserves the Linux Sky skill and rejects it for a Mac worker with the same skill name', () => {
  const entry = stageLinuxComputerSkill(runtime, staged)
  expect(entry).toMatchObject({ id: 'computer-use', version: '0.7.21', skillPlatform: 'linux' })
  writeFileSync(join(staged, 'inventory.json'), JSON.stringify({ version: 1, plugins: [entry] }))
  const [plugin] = resolveOriginalComputerSkills(staged, ['computer-use'], 'linux')
  if (!plugin) throw new Error('Missing staged Linux skill')
  expect(readFileSync(join(plugin.skillDir, 'SKILL.md'), 'utf8')).toBe(text)
  expect(() => resolveOriginalComputerSkills(staged, ['computer-use'], 'darwin')).toThrow('matching computer-use SKILL.md')
  expect(resolveOriginalComputerSkills(staged, ['computer-use'])).toEqual([plugin])
})

it('rejects an archive built for another platform even if it contains the Linux documentation', () => {
  writeFileSync(join(runtime, 'manifest.json'), JSON.stringify({ platform: 'darwin', arch: 'arm64' }))
  expect(() => stageLinuxComputerSkill(runtime, staged)).toThrow()
})
