import multipart from '@fastify/multipart'
import websocket from '@fastify/websocket'
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify'

import type { UserFileSystem } from '../../core/contract/user-file-system.js'
import {
  ModelProfileError,
  type ModelProfileErrorKind,
} from '../../core/resource/model-profile.js'
import { UserFileError, type UserFileErrorKind } from '../../core/resource/user-file.js'
import type { AgentHarness } from '../../harness/agent-harness.js'
import type { ModelProfileService } from '../../harness/config/model-profile-service.js'
import { runWebsocketRoutes } from '../websocket/run-route.js'
import { modelProfileRoutes } from './route/model-profiles.js'
import { userFileRoutes } from './route/user-files.js'

export interface BuildHttpServerOptions {
  readonly userFileSystem: UserFileSystem
  readonly modelProfileService: ModelProfileService
  readonly agentHarness?: AgentHarness
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

    if (error instanceof ModelProfileError) {
      const status = statusForModelProfileError(error.kind)
      if (status >= 500) request.log.error({ err: error }, 'Model profile request failed')
      void reply.code(status).send({
        detail: status === 500
          ? 'Internal server error'
          : error.message,
      })
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
  void server.register(modelProfileRoutes, { service: options.modelProfileService })
  if (options.agentHarness !== undefined) {
    void server.register(websocket)
    void server.register(runWebsocketRoutes, {
      harness: options.agentHarness,
      modelProfileService: options.modelProfileService,
      cwd: options.userFileSystem.initialDirectory,
    })
  }

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

function statusForModelProfileError(kind: ModelProfileErrorKind): number {
  switch (kind) {
    case 'profile-not-found': return 404
    case 'profile-id-exists':
    case 'profile-not-ready':
      return 409
    case 'default-profile-missing':
    case 'invalid-model-reference':
      return 400
    case 'auth-token-required':
    case 'invalid-base-url':
    case 'invalid-label':
    case 'invalid-model-id':
    case 'invalid-profile-id':
      return 422
    case 'upstream-auth-failed': return 400
    case 'upstream-timeout': return 504
    case 'upstream-invalid-response':
    case 'upstream-unavailable':
      return 502
    case 'io-failure':
    case 'store-corrupt':
      return 500
  }
}
