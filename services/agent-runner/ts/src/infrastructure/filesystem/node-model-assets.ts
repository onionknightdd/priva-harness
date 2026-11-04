import { open, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { ModelAssetInfo, ModelAssets, ModelSource } from '../../core/contract/model-assets.js'
import type { ResourceService } from '../../core/contract/resource-service.js'
import type { UserFileSystem } from '../../core/contract/user-file-system.js'
import { isModelFile, modelExtension, POINT_CLOUD_EXTENSIONS } from '../../core/resource/model-file.js'
import { ResourceError } from '../../core/resource/resource-catalog.js'
import type { UserFileInfo } from '../../core/resource/user-file.js'

export class NodeModelAssets implements ModelAssets {
  constructor(private readonly files: UserFileSystem, private readonly resources?: ResourceService) {}

  async inspect(source: ModelSource): Promise<ModelAssetInfo> {
    const file = await this.resolve(source)
    const pointCloud = POINT_CLOUD_EXTENSIONS.has(modelExtension(file.name))
      ? { copc: await isCopc(file.path) } : null
    return { ...file, pointCloud }
  }

  async resolve(source: ModelSource, resource?: string): Promise<UserFileInfo> {
    if (!isModelFile(source.path)) throw new ResourceError(415, 'Unsupported 3D file format')
    if (source.path.includes('\0')) throw new ResourceError(422, 'Invalid model path')
    let mainPath = source.path
    if (source.kind === 'skill') {
      if (this.resources === undefined) throw new ResourceError(404, 'Skills are unavailable')
      mainPath = await this.resources.skills.resolveAsset(source, source.skillId, source.path)
    }
    const main = await this.files.inspectFile(mainPath)
    if (resource === undefined || resource === '') return main
    // These are decoded local names, never network URLs or a filesystem root.
    if (isAbsolute(resource) || /[\\\0?#:]/u.test(resource)) {
      throw new ResourceError(403, 'Model resources must be relative local paths')
    }
    const root = dirname(main.path)
    const candidate = resolve(root, resource)
    if (!inside(root, candidate)) throw new ResourceError(403, 'Model resource escapes the model directory')
    const file = await this.files.inspectFile(candidate)
    // inspectFile resolves symlinks; check both the requested and canonical path.
    if (!inside(await realpath(root), file.path)) throw new ResourceError(403, 'Linked model resource escapes the model directory')
    return file
  }
}

function inside(root: string, path: string): boolean {
  const child = relative(root, path)
  return child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}

export async function isCopc(path: string): Promise<boolean> {
  const handle = await open(path, 'r')
  try {
    const header = Buffer.alloc(589)
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    return bytesRead === header.length && header.toString('ascii', 0, 4) === 'LASF'
      && header[24] === 1 && header[25] === 4 && header.readUInt16LE(94) === 375
      && header.toString('ascii', 377, 381) === 'copc' && header.readUInt16LE(393) === 1
      && header.readUInt16LE(395) === 160
  } finally { await handle.close() }
}
