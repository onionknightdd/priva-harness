import type { ProviderId } from '../../core/contract/agent-provider.js'
import { ResourceError } from '../../core/resource/resource-catalog.js'
import { canonicalDirectory } from './resource-files.js'

export class ProjectDirectories {
  private readonly cache = new Map<ProviderId, { expires: number; result: Promise<string[]> }>()

  constructor(
    readonly activeCwd: string,
    private readonly discover: (harness: ProviderId) => Promise<readonly string[]>,
  ) {}

  async list(harness: ProviderId, cwd?: string): Promise<string[]> {
    if (cwd !== undefined) return [await canonicalDirectory(cwd)]
    const cached = this.cache.get(harness)
    if (cached !== undefined && cached.expires > Date.now()) return cached.result
    const result = this.discover(harness).then(async (paths) => {
      const canonical = await Promise.all([...new Set([this.activeCwd, ...paths])].map(async (path) => {
        // A session can outlive its working directory. Do not scan a replacement relative path.
        try { return await canonicalDirectory(path) } catch (error) {
          if (error instanceof ResourceError && [404, 422].includes(error.statusCode)) return null
          throw error
        }
      }))
      return [...new Set(canonical.filter((path): path is string => path !== null))]
    })
    this.cache.set(harness, { expires: Date.now() + 5000, result })
    try { return await result } catch (error) { this.cache.delete(harness); throw error }
  }
}
