import { Readable } from 'node:stream'

import type { FastifyPluginCallback } from 'fastify'

import type {
  PendingUserFileUpload,
  UserFileSystem,
} from '../../../core/contract/user-file-system.js'
import { UserFileError } from '../../../core/resource/user-file.js'
import {
  createDirectorySchema,
  deletePathSchema,
  downloadFileSchema,
  listDirectorySchema,
  previewFileSchema,
  uploadFileSchema,
} from '../schema/user-file-schema.js'

const FILE_ROUTE_PREFIX = '/api/sandbox/files'
const MAX_MULTIPART_FIELDS = 16

interface PathQuery {
  readonly path: string
}

interface ListDirectoryQuery {
  readonly path?: string
}

interface CreateDirectoryBody {
  readonly directory: string
  readonly name: string
}

export interface UserFileRoutesOptions {
  readonly fileSystem: UserFileSystem
}

export const userFileRoutes: FastifyPluginCallback<UserFileRoutesOptions> = (
  fastify,
  options,
  done,
) => {
  const { fileSystem } = options

  fastify.get<{ Querystring: ListDirectoryQuery }>(
    `${FILE_ROUTE_PREFIX}/list`,
    { schema: listDirectorySchema },
    async (request) => await fileSystem.listDirectory(
      request.query.path ?? fileSystem.initialDirectory,
    ),
  )

  fastify.delete<{ Querystring: PathQuery }>(
    FILE_ROUTE_PREFIX,
    { schema: deletePathSchema },
    async (request) => await fileSystem.deletePath(request.query.path),
  )

  fastify.post<{ Body: CreateDirectoryBody }>(
    `${FILE_ROUTE_PREFIX}/mkdir`,
    { schema: createDirectorySchema },
    async (request, reply) => {
      const result = await fileSystem.createDirectory(
        request.body.directory,
        request.body.name,
      )
      return await reply.code(201).send(result)
    },
  )

  fastify.get<{ Querystring: PathQuery }>(
    `${FILE_ROUTE_PREFIX}/download`,
    { schema: downloadFileSchema },
    async (request, reply) => {
      const download = await fileSystem.openDownload(request.query.path)
      const content = download.content instanceof Readable
        ? download.content
        : Readable.from(download.content, { objectMode: false })

      void reply.header('Content-Type', download.mimeType)
      void reply.header('Content-Length', String(download.size))
      void reply.header('Last-Modified', new Date(download.modified * 1000).toUTCString())
      void reply.header(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeRfc5987(download.name)}`,
      )
      return await reply.send(content)
    },
  )

  fastify.get<{ Querystring: PathQuery }>(
    `${FILE_ROUTE_PREFIX}/preview`,
    { schema: previewFileSchema },
    async (request) => {
      const preview = await fileSystem.previewFile(request.query.path)
      return {
        path: preview.path,
        name: preview.name,
        mime_type: preview.mimeType,
        size: preview.size,
        content: preview.content,
        is_binary: preview.isBinary,
        preview_url: preview.previewUrl,
      }
    },
  )

  fastify.post(
    `${FILE_ROUTE_PREFIX}/upload`,
    { schema: uploadFileSchema },
    async (request) => {
      let pendingUpload: PendingUserFileUpload | undefined
      let directory: string | undefined
      let foundFile = false

      try {
        const parts = request.parts({
          limits: {
            fieldSize: 16 * 1024,
            fields: MAX_MULTIPART_FIELDS,
            fileSize: fileSystem.maxUploadBytes,
            files: 1,
            parts: MAX_MULTIPART_FIELDS + 1,
          },
        })

        for await (const part of parts) {
          if (part.type === 'file') {
            if (part.fieldname !== 'file') {
              for await (const chunk of part.file) {
                // Consume unexpected file fields so the multipart parser can finish.
                void chunk
              }
              continue
            }

            foundFile = true
            pendingUpload = await fileSystem.beginUpload(part.filename || 'upload')
            await pendingUpload.write(part.file)
            if (part.file.truncated) {
              throw uploadTooLarge(fileSystem.maxUploadBytes)
            }
          } else if (part.fieldname === 'directory') {
            directory = String(part.value)
          }
        }

        if (!foundFile || pendingUpload === undefined) {
          throw new UserFileError('missing-field', 'file field required')
        }
        if (directory === undefined || directory === '') {
          throw new UserFileError('missing-field', 'directory field required')
        }

        return await pendingUpload.commit(directory)
      } catch (error) {
        if (isMultipartFileTooLarge(error)) {
          throw uploadTooLarge(fileSystem.maxUploadBytes)
        }
        throw error
      } finally {
        await pendingUpload?.abort()
      }
    },
  )

  done()
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/gu, (character) =>
    `%${character.codePointAt(0)?.toString(16).toUpperCase() ?? ''}`,
  )
}

function isMultipartFileTooLarge(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'FST_REQ_FILE_TOO_LARGE'
}

function uploadTooLarge(maxUploadBytes: number): UserFileError {
  const mebibyte = 1024 * 1024
  const limit = maxUploadBytes % mebibyte === 0
    ? `${maxUploadBytes / mebibyte}MB`
    : `${maxUploadBytes} byte${maxUploadBytes === 1 ? '' : 's'}`
  return new UserFileError(
    'upload-too-large',
    `File exceeds the ${limit} upload limit`,
  )
}
