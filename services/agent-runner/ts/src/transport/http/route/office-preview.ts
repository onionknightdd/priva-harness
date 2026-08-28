import type { FastifyPluginCallback } from 'fastify'

import type { OnlyOfficeExampleClient } from '../../../core/contract/office-preview-client.js'
import type { UserFileSystem } from '../../../core/contract/user-file-system.js'
import { createOfficePreviewSessionSchema } from '../schema/office-preview-schema.js'

interface CreateOfficePreviewSessionBody {
  readonly path: string
}

export interface OfficePreviewRoutesOptions {
  readonly fileSystem: UserFileSystem
  readonly officeClient: OnlyOfficeExampleClient
}

export const officePreviewRoutes: FastifyPluginCallback<OfficePreviewRoutesOptions> = (
  fastify,
  options,
  done,
) => {
  const { fileSystem, officeClient } = options

  fastify.post<{ Body: CreateOfficePreviewSessionBody }>(
    '/api/sandbox/office/preview-session',
    { schema: createOfficePreviewSessionSchema },
    async (request) => {
      const download = await fileSystem.openDownload(request.body.path)
      const bytes = await readBytes(download.content)
      const session = await officeClient.createSpreadsheetPreview({
        fileName: download.name,
        mimeType: download.mimeType,
        size: download.size,
        modified: download.modified,
        path: download.path,
        bytes,
      })

      return {
        document_server_url: session.documentServerUrl,
        document: session.document,
      }
    },
  )

  done()
}

async function readBytes(content: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0

  for await (const chunk of content) {
    chunks.push(chunk)
    total += chunk.byteLength
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return bytes
}
