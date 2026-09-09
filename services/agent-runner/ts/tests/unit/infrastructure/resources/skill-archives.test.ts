import { gzipSync } from 'node:zlib'

import { zipSync } from 'fflate'
import tar from 'tar-stream'
import { describe, expect, it } from 'vitest'

import { readSkillArchive } from '../../../../src/infrastructure/resources/skill-archives.js'

async function tarArchive(entries: Record<string, Uint8Array>): Promise<Buffer> {
  const pack = tar.pack()
  const chunks: Buffer[] = []
  const finished = new Promise<Buffer>((resolve, reject) => {
    pack.on('data', (chunk: Buffer) => chunks.push(chunk))
    pack.on('end', () => resolve(Buffer.concat(chunks)))
    pack.on('error', reject)
  })
  for (const [name, data] of Object.entries(entries)) pack.entry({ name }, Buffer.from(data))
  pack.finalize()
  return await finished
}

describe('skill archives', () => {
  it.each(['zip', 'skill', 'tar', 'tgz'])('ignores macOS metadata in %s while preserving skill files', async (extension) => {
    const entries = {
      'fixture-skill/SKILL.md': Buffer.from('Skill content'),
      'fixture-skill/references/readme.md': Buffer.from('Reference'),
      'fixture-skill/.config.json': Buffer.from('{}'),
      '__MACOSX/fixture-skill/._SKILL.md': Buffer.from('AppleDouble metadata'),
      './.DS_Store': Buffer.from('Finder metadata'),
      './._fixture-skill': Buffer.from('AppleDouble metadata'),
      'fixture-skill/references/.DS_Store': Buffer.from('Finder metadata'),
      'fixture-skill/references/._readme.md': Buffer.from('AppleDouble metadata'),
    }
    const data = extension === 'tar' || extension === 'tgz' ? await tarArchive(entries) : Buffer.from(zipSync(entries))
    const files = await readSkillArchive(`fixture.${extension}`, extension === 'tgz' ? gzipSync(data) : data)
    expect([...files.keys()].sort()).toEqual(['fixture-skill/.config.json', 'fixture-skill/SKILL.md', 'fixture-skill/references/readme.md'].sort())
    expect(Buffer.from(files.get('fixture-skill/references/readme.md') ?? []).toString()).toBe('Reference')
  })

  it.each(['zip', 'tar'])('still rejects unsafe metadata paths in %s', async (extension) => {
    const entries = { '__MACOSX/../escape': Buffer.from('x') }
    const data = extension === 'tar' ? await tarArchive(entries) : Buffer.from(zipSync(entries))
    await expect(readSkillArchive(`unsafe.${extension}`, data)).rejects.toMatchObject({ statusCode: 422 })
  })

  it('still checks extraction limits and rejects metadata-only archives', async () => {
    await expect(readSkillArchive('large.zip', Buffer.from(zipSync({ '__MACOSX/large': new Uint8Array(6 * 1024 * 1024) })))).rejects.toMatchObject({ statusCode: 413 })
    await expect(readSkillArchive('empty.zip', Buffer.from(zipSync({ '__MACOSX/._skill': Buffer.from('Metadata') })))).rejects.toMatchObject({ statusCode: 422, message: 'Archive contains no skill files' })
  })
})
