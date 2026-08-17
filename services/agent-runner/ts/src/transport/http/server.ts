import multipart from '@fastify/multipart'
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify'

import type { UserFileSystem } from '../../core/contract/user-file-system.js'
import { UserFileError, type UserFileErrorKind } from '../../core/resource/user-file.js'
import { userFileRoutes } from './route/user-files.js'

export interface BuildHttpServerOptions {
  readonly userFileSystem: UserFileSystem
  readonly logger?: FastifyServerOptions['logger']
}

export function buildHttpServer(options: BuildHttpServerOptions): FastifyInstance {
  const server = Fastify({
    forceCloseConnections: 'idle',
    logger: options.logger ?? false,
  })

  server.setErrorHandler((error, request, reply) => {
    if (error instanceof UserFileError) {
      void reply.code(statusForUserFileError(error.kind)).send({ detail: error.message })
      return
    }

    if (isValidationError(error)) {
      void reply.code(422).send({ detail: error.message })
      return
    }

    request.log.error({ err: error }, 'Unhandled HTTP request error')
    void reply.code(500).send({ detail: 'Internal server error' })
  })

  void server.register(multipart, {
    limits: {
      fieldSize: 16 * 1024,
      fields: 16,
      fileSize: options.userFileSystem.maxUploadBytes,
      files: 1,
      parts: 17,
    },
  })
  void server.register(userFileRoutes, { fileSystem: options.userFileSystem })

  return server
}

function isValidationError(error: unknown): error is Error & { validation: unknown } {
  return error instanceof Error && 'validation' in error && error.validation !== undefined
}

function statusForUserFileError(kind: UserFileErrorKind): number {
  switch (kind) {
    case 'access-denied': return 403
    case 'already-exists': return 409
    case 'file-not-found': return 404
    case 'missing-field': return 422
    case 'upload-too-large': return 413
    case 'invalid-path-segment':
    case 'invalid-request':
    case 'io-failure':
    case 'not-directory':
      return 400
  }
}
