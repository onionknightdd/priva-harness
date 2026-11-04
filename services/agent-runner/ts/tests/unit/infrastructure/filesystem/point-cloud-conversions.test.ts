import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NodeUserFileSystem } from '../../../../src/infrastructure/filesystem/node-user-file-system.js'
import { NodeModelAssets } from '../../../../src/infrastructure/filesystem/node-model-assets.js'
import { PointCloudConversions } from '../../../../src/infrastructure/filesystem/point-cloud-conversions.js'
import { copcHeader } from '../../../support/point-cloud.js'

describe('point-cloud conversion lifecycle', () => {
  let root: string
  let files: NodeUserFileSystem
  let assets: NodeModelAssets
  let service: PointCloudConversions | undefined
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'priva-point-cloud-'))
    files = new NodeUserFileSystem({ initialDirectory: root })
    assets = new NodeModelAssets(files)
  })
  afterEach(async () => { await service?.close(); await rm(root, { recursive: true, force: true }) })
  const source = (path: string) => ({ kind: 'file' as const, path })

  it('deduplicates concurrent conversions, persists cache and invalidates on source changes', async () => {
    const path = join(root, 'cloud.ply')
    await writeFile(path, 'ply')
    const run = vi.fn(async (pipeline: string) => { await writeCopc(pipeline) })
    const options = { files, assets, cacheDirectory: join(root, 'cache'), run }
    service = new PointCloudConversions(options)
    const [first, second] = await Promise.all([service.prepare(source(path)), service.prepare(source(path))])
    expect(first.id).toBe(second.id)
    await vi.waitFor(async () => { expect((await service?.get(first.id))?.status).toBe('ready') })
    expect(run).toHaveBeenCalledTimes(1)
    expect((await service.asset(first.id)).size).toBe(589)
    service.release(first.id)
    await service.close()
    service = new PointCloudConversions(options)
    expect((await service.prepare(source(path))).status).toBe('ready')
    expect(run).toHaveBeenCalledTimes(1)
    await writeFile(path, 'ply changed')
    const changed = await service.prepare(source(path))
    expect(changed.id).not.toBe(first.id)
    await vi.waitFor(async () => { expect((await service?.get(changed.id))?.status).toBe('ready') })
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('cancels active work, cleans partial output and allows retry', async () => {
    const path = join(root, 'cloud.las')
    await writeFile(path, 'LAS')
    let started = false
    service = new PointCloudConversions({ files, assets, cacheDirectory: join(root, 'cache'),
      run: async (_, signal) => { started = true; await aborted(signal) } })
    const job = await service.prepare(source(path))
    await vi.waitFor(() => expect(started).toBe(true))
    expect((await service.cancel(job.id, job.consumerId ?? '')).status).toBe('cancelled')
    await vi.waitFor(async () => expect(await readdir(join(root, 'cache'))).toEqual([]))
    expect((await service.prepare(source(path))).status).not.toBe('cancelled')
  })

  it('shares conversion work while cancelling only after the final consumer releases it', async () => {
    const path = join(root, 'cloud.ply')
    await writeFile(path, 'ply')
    let started = false
    const run = vi.fn(async (_: string, signal: AbortSignal) => { started = true; await aborted(signal) })
    service = new PointCloudConversions({ files, assets, cacheDirectory: join(root, 'cache'), run })
    const first = await service.prepare(source(path))
    const second = await service.prepare(source(path))
    expect(first.id).toBe(second.id)
    expect(first.consumerId).not.toBe(second.consumerId)
    await vi.waitFor(() => expect(started).toBe(true))
    expect((await service.cancel(first.id, first.consumerId ?? '')).status).toBe('running')
    expect((await service.cancel(first.id, first.consumerId ?? '')).status).toBe('running')
    expect((await service.cancel(first.id, 'unknown-token')).status).toBe('running')
    expect((await service.cancel(second.id, second.consumerId ?? '')).status).toBe('cancelled')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('surfaces timeouts and conversion errors without publishing partial files', async () => {
    const path = join(root, 'cloud.pcd')
    await writeFile(path, 'PCD')
    service = new PointCloudConversions({ files, assets, cacheDirectory: join(root, 'cache'), timeoutMs: 20,
      run: async (_, signal) => { await aborted(signal) } })
    const job = await service.prepare(source(path))
    await vi.waitFor(async () => expect((await service?.get(job.id))?.status).toBe('failed'))
    expect((await service.get(job.id)).error).toContain('timed out')
    await expect(service.asset(job.id)).rejects.toThrow('not ready')
    expect(await readdir(join(root, 'cache'))).toEqual([])
  })

  it('enforces source and cache budgets, and evicts oldest completed output', async () => {
    service = new PointCloudConversions({ files, assets, cacheDirectory: join(root, 'cache'), maxSourceBytes: 8, maxCacheBytes: 600,
      run: async (pipeline) => { await writeCopc(pipeline) } })
    const large = join(root, 'large.ply')
    await writeFile(large, 'a'.repeat(9))
    await expect(service.prepare(source(large))).rejects.toThrow('input limit')
    const first = join(root, 'first.ply')
    const second = join(root, 'second.ply')
    await writeFile(first, 'one')
    await writeFile(second, 'two')
    const a = await service.prepare(source(first))
    await vi.waitFor(async () => expect((await service?.get(a.id))?.status).toBe('ready'))
    const b = await service.prepare(source(second))
    await vi.waitFor(async () => expect((await service?.get(b.id))?.status).toBe('ready'))
    expect((await readdir(join(root, 'cache'))).filter((name) => name.endsWith('.laz'))).toEqual([`${b.id}.copc.laz`])
    await expect(service.get(a.id)).rejects.toThrow('expired')
  })

  it('refuses to publish a conversion when the input changes while it runs', async () => {
    const path = join(root, 'cloud.las')
    await writeFile(path, 'LAS')
    service = new PointCloudConversions({ files, assets, cacheDirectory: join(root, 'cache'),
      run: async (pipeline) => { await writeCopc(pipeline); await writeFile(path, 'changed') } })
    const job = await service.prepare(source(path))
    await vi.waitFor(async () => expect((await service?.get(job.id))?.status).toBe('failed'))
    expect((await service.get(job.id)).error).toContain('Source changed')
    expect(await readdir(join(root, 'cache'))).toEqual([])
  })

  it('protects active downloads from eviction and preserves the cached file modification time', async () => {
    service = new PointCloudConversions({ files, assets, cacheDirectory: join(root, 'cache'), maxCacheBytes: 600,
      run: async (pipeline) => { await writeCopc(pipeline) } })
    const first = join(root, 'first.ply')
    const second = join(root, 'second.ply')
    await writeFile(first, 'one')
    await writeFile(second, 'two')
    const a = await service.prepare(source(first))
    await vi.waitFor(async () => expect((await service?.get(a.id))?.status).toBe('ready'))
    const download = await service.asset(a.id)
    const secondDownload = await service.asset(a.id)
    expect(secondDownload.modified).toBeCloseTo(download.modified, 5)
    service.release(a.id)
    const b = await service.prepare(source(second))
    await vi.waitFor(async () => expect((await service?.get(b.id))?.status).toBe('failed'))
    expect((await service.get(b.id)).error).toContain('cache is busy')
    expect((await readdir(join(root, 'cache'))).filter((name) => name.endsWith('.laz'))).toEqual([`${a.id}.copc.laz`])
    service.release(a.id)
    await service.prepare(source(second))
    await vi.waitFor(async () => expect((await service?.get(b.id))?.status).toBe('ready'))
  })
})

async function writeCopc(path: string): Promise<void> {
  const pipeline = JSON.parse(await readFile(path, 'utf8')) as { pipeline: [string, { filename: string }] }
  await writeFile(pipeline.pipeline[1].filename, copcHeader())
}

async function aborted(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  await new Promise<void>((_, reject) => signal.addEventListener('abort', () => {
    reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'))
  }, { once: true }))
}
