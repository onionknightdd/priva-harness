import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { NodeModelAssets } from '../../../src/infrastructure/filesystem/node-model-assets.js'
import { NodeUserFileSystem } from '../../../src/infrastructure/filesystem/node-user-file-system.js'
import { PointCloudConversions } from '../../../src/infrastructure/filesystem/point-cloud-conversions.js'

const execute = promisify(execFile)
const pdal = process.argv[2] ?? 'pdal'
const root = await mkdtemp(join(tmpdir(), 'priva-pdal-probe-'))
const files = new NodeUserFileSystem({ initialDirectory: root })
const assets = new NodeModelAssets(files)
const conversions = new PointCloudConversions({ files, assets, cacheDirectory: join(root, 'cache'), executable: pdal })
try {
  await writeFile(join(root, 'fixture.ply'), 'ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n1 2 3\n4 5 6\n')
  await writeFile(join(root, 'fixture.pcd'), '# .PCD v0.7\nVERSION 0.7\nFIELDS x y z\nSIZE 4 4 4\nTYPE F F F\nCOUNT 1 1 1\nWIDTH 3\nHEIGHT 1\nVIEWPOINT 0 0 0 1 0 0 0\nPOINTS 3\nDATA ascii\n0 0 0\n1 2 3\n4 5 6\n')
  for (const extension of ['las', 'laz']) await execute(pdal, ['translate', join(root, 'fixture.ply'), join(root, `fixture.${extension}`)])
  for (const extension of ['ply', 'pcd', 'las', 'laz']) {
    const job = await conversions.prepare({ kind: 'file', path: join(root, `fixture.${extension}`) })
    const deadline = Date.now() + 60_000
    let current = job
    while ((current.status === 'queued' || current.status === 'running') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      current = await conversions.get(job.id)
    }
    assert.equal(current.status, 'ready', current.error)
    const output = await conversions.asset(job.id)
    const info = JSON.parse((await execute(pdal, ['info', '--summary', output.path])).stdout) as { summary: { num_points: number } }
    assert.equal(info.summary.num_points, 3)
    assert.equal((await readFile(output.path)).toString('ascii', 0, 4), 'LASF')
    conversions.release(job.id)
    console.log(`${extension.toUpperCase()} -> COPC: 3 points, ${output.size} bytes`)
  }
} finally {
  await conversions.close()
  await rm(root, { recursive: true, force: true })
}
