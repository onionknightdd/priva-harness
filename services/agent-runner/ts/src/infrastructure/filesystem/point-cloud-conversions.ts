import { execFile, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ModelAssetInfo, ModelAssets, ModelSource, PointCloudJob, PointClouds } from '../../core/contract/model-assets.js'
import type { UserFileSystem } from '../../core/contract/user-file-system.js'
import { ResourceError } from '../../core/resource/resource-catalog.js'
import type { UserFileInfo } from '../../core/resource/user-file.js'
import { isCopc } from './node-model-assets.js'

const GIB = 1024 ** 3
const PIPELINE_VERSION = 'pdal-2.9.3-copc-v1'
interface Job {
  readonly id: string
  readonly source: ModelSource
  readonly input: ModelAssetInfo
  readonly controller: AbortController
  readonly consumers: Set<string>
  status: PointCloudJob['status']
  output?: string
  error?: string
}

export interface PointCloudConversionOptions {
  readonly cacheDirectory: string
  readonly assets: ModelAssets
  readonly files: UserFileSystem
  readonly executable?: string
  readonly maxSourceBytes?: number
  readonly maxCacheBytes?: number
  readonly maxMemoryBytes?: number
  readonly timeoutMs?: number
  /** An injected process runner keeps lifecycle tests independent of a system PDAL installation. */
  readonly run?: (pipelinePath: string, signal: AbortSignal) => Promise<void>
}

/** One bounded conversion worker; completed immutable files are the durable cache. */
export class PointCloudConversions implements PointClouds {
  private readonly jobs = new Map<string, Job>()
  private readonly leases = new Map<string, number>()
  private readonly queue: Job[] = []
  private readonly maxSourceBytes: number
  private readonly maxCacheBytes: number
  private readonly initialize: Promise<void>
  private worker: Promise<void> | undefined
  private closing = false

  constructor(private readonly options: PointCloudConversionOptions) {
    this.maxSourceBytes = options.maxSourceBytes ?? 2 * GIB
    this.maxCacheBytes = options.maxCacheBytes ?? 2 * GIB
    this.initialize = this.initializeCache()
  }

  async prepare(source: ModelSource): Promise<PointCloudJob> {
    await this.initialize
    if (this.closing) throw new ResourceError(503, 'Point-cloud converter is stopping')
    const input = await this.options.assets.inspect(source)
    if (input.pointCloud === null) throw new ResourceError(415, 'Only PLY, PCD, LAS and LAZ point clouds can be converted')
    if (input.size > this.maxSourceBytes && !input.pointCloud.copc) throw new ResourceError(413, `Point cloud exceeds the ${this.maxSourceBytes} byte conversion input limit; provide COPC for larger datasets`)
    const id = createHash('sha256').update(`${PIPELINE_VERSION}:${input.path}:${input.revision}`).digest('hex')
    const existing = this.jobs.get(id)
    if (existing !== undefined && existing.status !== 'failed' && existing.status !== 'cancelled') return this.subscribe(existing)
    const output = join(this.options.cacheDirectory, `${id}.copc.laz`)
    const cached = await exists(output)
    // Concurrent requests for the same source share the same conversion.
    const concurrent = this.jobs.get(id)
    if (concurrent !== existing && concurrent !== undefined) return this.subscribe(concurrent)
    if (!input.pointCloud.copc && !cached && this.queue.length >= 4) throw new ResourceError(429, 'Point-cloud conversion queue is full; retry after a job finishes')
    this.trimJobHistory()
    const job: Job = { id, source, input, controller: new AbortController(), consumers: new Set(), status: 'queued' }
    if (input.pointCloud.copc || cached) {
      job.status = 'ready'
      job.output = input.pointCloud.copc ? input.path : output
      if (cached) await utimes(output, new Date(), (await stat(output)).mtime)
    }
    this.jobs.set(id, job)
    if (job.status === 'queued') {
      this.queue.push(job)
      this.startWorker()
    }
    return this.subscribe(job)
  }

  async get(id: string): Promise<PointCloudJob> {
    await this.initialize
    return this.publicJob(this.find(id))
  }

  async cancel(id: string, consumerId: string): Promise<PointCloudJob> {
    await this.initialize
    const job = this.find(id)
    if (job.consumers.delete(consumerId) && job.consumers.size === 0 && (job.status === 'queued' || job.status === 'running')) {
      job.status = 'cancelled'
      job.controller.abort()
    }
    return this.publicJob(job)
  }

  async asset(id: string): Promise<UserFileInfo> {
    await this.initialize
    const job = this.find(id)
    if (job.status !== 'ready' || job.output === undefined) throw new ResourceError(409, 'Point cloud is not ready')
    this.leases.set(id, (this.leases.get(id) ?? 0) + 1)
    try {
      // Re-authorize skill context and prevent a changed original from serving under an old revision.
      const current = await this.options.assets.inspect(job.source)
      if (current.revision !== job.input.revision) throw new ResourceError(409, 'Source file changed; reopen the point cloud')
      const result = await this.options.files.inspectFile(job.output)
      // Access time drives LRU; changing mtime would invalidate If-Range on every request.
      if (job.output !== job.input.path) await utimes(job.output, new Date(), result.modified)
      return result
    } catch (error) {
      this.release(id)
      if (!(await exists(job.output))) {
        this.jobs.delete(id)
        throw new ResourceError(410, 'Point-cloud cache expired; prepare it again')
      }
      throw error
    }
  }

  release(id: string): void {
    const count = this.leases.get(id) ?? 0
    if (count <= 1) this.leases.delete(id)
    else this.leases.set(id, count - 1)
  }

  async close(): Promise<void> {
    this.closing = true
    for (const job of this.jobs.values()) {
      if (job.status === 'queued' || job.status === 'running') {
        job.status = 'cancelled'
        job.controller.abort()
      }
    }
    await this.worker
    await this.initialize
  }

  private startWorker(): void {
    if (this.worker !== undefined) return
    this.worker = this.drain().finally(() => {
      this.worker = undefined
      if (this.queue.some((job) => job.status === 'queued') && !this.closing) this.startWorker()
    })
  }

  private async drain(): Promise<void> {
    for (let job = this.queue.shift(); job !== undefined; job = this.queue.shift()) {
      if (job.status !== 'queued' || this.closing) continue
      const directory = join(this.options.cacheDirectory, `${job.id}.partial`)
      const output = join(directory, 'output.copc.laz')
      job.status = 'running'
      const timeout = setTimeout(() => job.controller.abort(new Error('Point-cloud conversion timed out')), this.options.timeoutMs ?? 10 * 60_000)
      try {
        await mkdir(directory, { mode: 0o700 })
        const pipeline = join(directory, 'pipeline.json')
        await writeFile(pipeline, JSON.stringify({ pipeline: [job.input.path, {
          type: 'writers.copc', filename: output, forward: 'all', extra_dims: 'all', threads: 2,
          scale_x: 'auto', scale_y: 'auto', scale_z: 'auto', offset_x: 'auto', offset_y: 'auto', offset_z: 'auto',
        }] }))
        await (this.options.run ?? ((path, signal) => this.runPdal(path, signal)))(pipeline, job.controller.signal)
        job.controller.signal.throwIfAborted()
        if ((await this.options.assets.inspect(job.source)).revision !== job.input.revision) throw new Error('Source changed during conversion; reopen the file')
        if (!(await isCopc(output))) throw new Error('Converter did not produce a valid COPC file')
        const size = (await stat(output)).size
        if (size > this.maxCacheBytes) throw new Error('Converted point cloud exceeds the cache size limit')
        await this.evict(size)
        const destination = join(this.options.cacheDirectory, `${job.id}.copc.laz`)
        await rename(output, destination)
        job.output = destination
        job.status = 'ready'
      } catch (error) {
        if (this.publicJob(job).status !== 'cancelled') {
          job.status = 'failed'
          job.error = error instanceof Error ? error.message : 'Point-cloud conversion failed'
        }
      } finally {
        job.consumers.clear()
        clearTimeout(timeout)
        try { await rm(directory, { recursive: true, force: true }) } catch (error) {
          job.status = 'failed'
          job.error = `Could not clean conversion files: ${error instanceof Error ? error.message : String(error)}`
        }
      }
    }
  }

  private runPdal(pipeline: string, signal: AbortSignal): Promise<void> {
    // Resource limits apply to PDAL itself, before loading any input. No shell or user-supplied command.
    const limit = 'import os,resource,sys; sys.platform == "linux" and resource.setrlimit(resource.RLIMIT_AS,(int(sys.argv[1]),int(sys.argv[1]))); resource.setrlimit(resource.RLIMIT_FSIZE,(int(sys.argv[2]),int(sys.argv[2]))); os.execvp(sys.argv[3],sys.argv[3:])'
    return new Promise((resolve, reject) => {
      const child = spawn('python3', ['-c', limit, String(this.options.maxMemoryBytes ?? 2 * GIB),
        String(this.maxCacheBytes), this.options.executable ?? 'pdal', 'pipeline', pipeline], { stdio: ['ignore', 'ignore', 'pipe'] })
      let stderr = ''
      let killTimer: ReturnType<typeof setTimeout> | undefined
      let memoryError: Error | undefined
      let closed = false
      const abort = (): void => {
        if (killTimer !== undefined) return
        child.kill('SIGTERM')
        killTimer = setTimeout(() => child.kill('SIGKILL'), 2000)
      }
      // Darwin cannot lower RLIMIT_AS. Monitor resident memory for local development;
      // deployed Linux also has the hard address-space limit above and the pod cgroup.
      const memoryCheck = process.platform === 'darwin' ? setInterval(() => {
        if (child.pid === undefined || closed) return
        execFile('ps', ['-o', 'rss=', '-p', String(child.pid)], (error, stdout) => {
          if (closed || memoryError !== undefined) return
          if (error !== null || Number(stdout.trim()) * 1024 > (this.options.maxMemoryBytes ?? 2 * GIB)) {
            memoryError = new Error(error === null ? 'Point-cloud conversion exceeded its memory limit' : 'Cannot monitor converter memory')
            abort()
          }
        })
      }, 500) : undefined
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
      child.stderr.on('data', (data: Buffer) => { stderr = (stderr + data.toString()).slice(-8192) })
      child.on('error', reject)
      child.on('close', (code) => {
        closed = true
        clearInterval(memoryCheck)
        signal.removeEventListener('abort', abort)
        clearTimeout(killTimer)
        if (memoryError !== undefined) reject(memoryError)
        else if (signal.aborted) reject(signal.reason instanceof Error ? signal.reason : new Error('Conversion cancelled'))
        else if (code !== 0) {
          const hint = stderr.includes('FileNotFoundError') ? ' Install PDAL 2.9.3 with writers.copc for local development.' : ''
          reject(new Error(`PDAL conversion failed (${code === null ? 'process terminated' : `exit ${code}`}).${hint} ${stderr.trim()}`))
        }
        else resolve()
      })
    })
  }

  private async initializeCache(): Promise<void> {
    await mkdir(this.options.cacheDirectory, { recursive: true, mode: 0o700 })
    for (const entry of await readdir(this.options.cacheDirectory)) {
      if (/^[a-f0-9]{64}\.partial$/u.test(entry)) await rm(join(this.options.cacheDirectory, entry), { recursive: true, force: true })
    }
    await this.evict(0)
  }

  private async evict(required: number): Promise<void> {
    const entries = await Promise.all((await readdir(this.options.cacheDirectory)).filter((name) => /^[a-f0-9]{64}\.copc\.laz$/u.test(name))
      .map(async (name) => ({ name, info: await stat(join(this.options.cacheDirectory, name)) })))
    let total = entries.reduce((sum, entry) => sum + entry.info.size, 0)
    for (const entry of entries.sort((a, b) => a.info.atimeMs - b.info.atimeMs)) {
      if (total + required <= this.maxCacheBytes) break
      if (this.leases.has(entry.name.slice(0, 64))) continue
      await rm(join(this.options.cacheDirectory, entry.name), { force: true })
      this.jobs.delete(entry.name.slice(0, 64))
      total -= entry.info.size
    }
    if (total + required > this.maxCacheBytes) throw new ResourceError(507, 'Point-cloud cache is busy; close another preview and retry')
  }

  private trimJobHistory(): void {
    if (this.jobs.size < 128) return
    for (const [id, job] of this.jobs) {
      if (job.status !== 'queued' && job.status !== 'running' && !this.leases.has(id)) this.jobs.delete(id)
      if (this.jobs.size < 128) return
    }
  }

  private find(id: string): Job {
    const job = this.jobs.get(id)
    if (job === undefined) throw new ResourceError(404, 'Point-cloud job expired; prepare the source again')
    return job
  }

  private publicJob(job: Job): PointCloudJob {
    return { id: job.id, status: job.status, revision: job.input.revision,
      ...(job.error === undefined ? {} : { error: job.error }),
      ...(job.status === 'ready' ? { url: `/api/sandbox/pointclouds/${job.id}/asset` } : {}) }
  }

  private subscribe(job: Job): PointCloudJob {
    if (job.status !== 'queued' && job.status !== 'running') return this.publicJob(job)
    const consumerId = randomUUID()
    job.consumers.add(consumerId)
    return { ...this.publicJob(job), consumerId }
  }
}

async function exists(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile() } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}
