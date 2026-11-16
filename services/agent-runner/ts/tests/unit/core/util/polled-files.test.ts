import { mkdtemp, rename, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PolledFiles } from '../../../../src/core/util/polled-files.js'

describe('PolledFiles', () => {
  let root: string
  let path: string
  const parse = vi.fn((text: string) => ({ text }))
  // Old enough that the file counts as settled rather than just written.
  const settled = new Date(Date.now() - 60_000)

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'priva-polled-files-'))
    path = join(root, 'status.json')
    parse.mockClear()
  })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  it('parses an unchanged file once and hands every poll the same value', async () => {
    const files = new PolledFiles()
    await writeFile(path, 'first')
    await utimes(path, settled, settled)

    const value = await files.read(path, parse)
    expect(value).toEqual({ text: 'first' })
    expect(await files.read(path, parse)).toBe(value)
    expect(parse).toHaveBeenCalledTimes(1)
  })

  it('reads the file again once it is replaced or rewritten', async () => {
    const files = new PolledFiles()
    await writeFile(path, 'first')
    await utimes(path, settled, settled)
    await files.read(path, parse)

    // Replaced by rename, as the terminal hooks write their status.
    const next = join(root, 'status.json.next')
    await writeFile(next, 'second')
    await utimes(next, settled, settled)
    await rename(next, path)
    expect(await files.read(path, parse)).toEqual({ text: 'second' })

    // Rewritten in place with the same length.
    await writeFile(path, 'third!')
    expect(await files.read(path, parse)).toEqual({ text: 'third!' })
    expect(parse).toHaveBeenCalledTimes(3)
  })

  it('does not trust the stamp of a file that was only just written', async () => {
    const files = new PolledFiles()
    await writeFile(path, 'fresh')
    await files.read(path, parse)
    await files.read(path, parse)
    expect(parse).toHaveBeenCalledTimes(2)
  })

  it('rejects for a missing file and keeps nothing from a failed parse', async () => {
    const files = new PolledFiles()
    await expect(files.read(path, parse)).rejects.toMatchObject({ code: 'ENOENT' })

    await writeFile(path, 'broken')
    await utimes(path, settled, settled)
    const failing = vi.fn(() => { throw new SyntaxError('not JSON') })
    await expect(files.read(path, failing)).rejects.toThrow(SyntaxError)
    await expect(files.read(path, failing)).rejects.toThrow(SyntaxError)
    expect(failing).toHaveBeenCalledTimes(2)
    expect(await files.read(path, parse)).toEqual({ text: 'broken' })
  })

  it('forgets the oldest files beyond its limit', async () => {
    const files = new PolledFiles(1)
    const other = join(root, 'other.json')
    for (const file of [path, other]) {
      await writeFile(file, file)
      await utimes(file, settled, settled)
    }
    await files.read(path, parse)
    await files.read(other, parse)
    await files.read(path, parse)
    expect(parse).toHaveBeenCalledTimes(3)
  })
})
