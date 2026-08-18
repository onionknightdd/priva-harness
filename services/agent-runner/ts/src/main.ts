import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { ModelProfileService } from './harness/config/model-profile-service.js'
import { NodeUserFileSystem } from './infrastructure/filesystem/node-user-file-system.js'
import { CompatibleModelEndpointClient } from './infrastructure/model-profile/compatible-model-endpoint-client.js'
import { JsonModelProfileStore } from './infrastructure/model-profile/json-model-profile-store.js'
import { buildHttpServer } from './transport/http/server.js'

const DEFAULT_PORT = 8000

export async function startServer(): Promise<void> {
  const initialDirectory = process.env['WORKSPACE_DIR'] ?? homedir()
  const runtimeHome = resolve(
    process.env['RUNTIME_HOME'] ?? join(homedir(), '.config', 'priva'),
  )
  await mkdir(initialDirectory, { recursive: true })
  const fileSystem = new NodeUserFileSystem({
    initialDirectory,
  })
  const modelProfileService = new ModelProfileService(
    new JsonModelProfileStore({ runtimeHome }),
    new CompatibleModelEndpointClient(),
  )
  const server = buildHttpServer({
    userFileSystem: fileSystem,
    modelProfileService,
    logger: true,
  })
  const port = parsePort(process.env['PORT'])
  const host = process.env['HOST'] ?? '0.0.0.0'

  const close = async (): Promise<void> => {
    await server.close()
  }
  process.once('SIGINT', () => { void close() })
  process.once('SIGTERM', () => { void close() })

  await server.listen({ host, port })
}

function parsePort(rawPort: string | undefined): number {
  if (rawPort === undefined) return DEFAULT_PORT
  const port = Number(rawPort)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError(`Invalid PORT: ${rawPort}`)
  }
  return port
}

const entrypoint = process.argv[1]
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  startServer().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
