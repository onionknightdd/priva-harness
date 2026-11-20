import { lstatSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { z } from 'zod'
import { bundleFile, fileHash, type OriginalSkillEntry } from '../../src/core/plugin/original-computer-skills.js'

/** The Debian bundle ships the standalone desktop skill inside Sky's npm package. */
export function stageLinuxComputerSkill(runtime: string, destination: string): OriginalSkillEntry {
  if (!isAbsolute(runtime) || !lstatSync(runtime).isDirectory()) throw new Error('Expected an absolute Linux cua_node directory')
  if (!isAbsolute(destination)) throw new Error('Expected an absolute staged skills directory')
  const archive = JSON.parse(bundleFile(runtime, 'manifest.json').toString()) as unknown
  z.object({ platform: z.literal('linux'), arch: z.enum(['arm64', 'x64']) }).parse(archive)
  const sky = 'lib/node_modules/@oai/sky'
  const manifest = bundleFile(runtime, sky + '/package.json')
  const { version } = z.object({ name: z.literal('@oai/sky'), version: z.string().min(1) }).parse(JSON.parse(manifest.toString()))
  const document = bundleFile(runtime, sky + '/docs/skills/oai_sky_lib/linux/SKILL.md')
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(new TextDecoder('utf-8', { fatal: true }).decode(document))?.[1]
  if (!header || !/^name: computer-use\r?$/mu.test(header)) throw new Error('Missing Linux computer-use skill declaration')

  const root = join(destination, 'computer-use')
  mkdirSync(root, { mode: 0o700 })
  const assets: Record<string, Buffer> = {
    'skills/computer-use/SKILL.md': document,
    '.claude-plugin/plugin.json': Buffer.from(JSON.stringify({ name: 'priva-original-computer-use', skills: './skills/computer-use' }) + '\n'),
  }
  const files: Record<string, string> = {}
  for (const [name, bytes] of Object.entries(assets)) {
    const path = join(root, name)
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 })
    files[name] = fileHash(bytes)
  }
  return {
    id: 'computer-use', skillPlatform: 'linux', version, manifestSha256: fileHash(manifest),
    license: 'Undeclared in @oai/sky package.json', files, outsideStage: [], mcpServers: [], hooks: [],
    requires: ['node_repl.js', '@oai/sky/service', 'Linux desktop'],
  }
}
