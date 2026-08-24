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
import {
  RuntimeSettingsError,
  type RuntimeSettingsErrorKind,
} from '../../core/resource/runtime-settings.js'
import { SessionError, type SessionErrorKind } from '../../core/resource/session.js'
import { UserFileError, type UserFileErrorKind } from '../../core/resource/user-file.js'
import type { AgentHarness } from '../../harness/agent-harness.js'
import type { AgentProfileService } from '../../harness/config/agent-profile-service.js'
import type { ConfigDistributor } from '../../harness/config/config-distributor.js'
import type { ModelProfileService } from '../../harness/config/model-profile-service.js'
import type { SessionService } from '../../harness/session/session-service.js'
import { runWebsocketRoutes } from '../websocket/run-route.js'
import { agentProfileRoutes } from './route/agent-profile.js'
import { modelProfileRoutes } from './route/model-profiles.js'
import { sessionRoutes } from './route/sessions.js'
import { userFileRoutes } from './route/user-files.js'

export interface BuildHttpServerOptions {
  readonly userFileSystem: UserFileSystem
  readonly modelProfileService: ModelProfileService
  readonly agentProfileService: AgentProfileService
  readonly agentHarness?: AgentHarness
  readonly sessionService?: SessionService
  readonly configDistributor?: ConfigDistributor
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

    if (error instanceof RuntimeSettingsError) {
      const status = statusForRuntimeSettingsError(error.kind)
      if (status >= 500) request.log.error({ err: error }, 'Runtime settings request failed')
      void reply.code(status).send({
        detail: status === 500
          ? 'Internal server error'
          : error.message,
      })
      return
    }

    if (error instanceof SessionError) {
      void reply.code(statusForSessionError(error.kind)).send({ detail: error.message })
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
  void server.register(agentProfileRoutes, { service: options.agentProfileService })
  if (options.sessionService !== undefined) {
    void server.register(sessionRoutes, { sessionService: options.sessionService })
  }
  if (options.agentHarness !== undefined) {
    void server.register(websocket)
    void server.register(runWebsocketRoutes, {
      harness: options.agentHarness,
      modelProfileService: options.modelProfileService,
      agentProfileService: options.agentProfileService,
      cwd: options.userFileSystem.initialDirectory,
    })
  }

  return server
}

function isValidationError(error: unknown): error is Error & { validation: unknown } {
  return error instanceof Error && 'validation' in error && error.validation !== undefined
}

function statusForSessionError(kind: SessionErrorKind): number {
  switch (kind) {
    case 'session-not-found': return 404
    case 'session-busy': return 409
    case 'invalid-request': return 400
    case 'io-failure': return 500
  }
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

function statusForRuntimeSettingsError(kind: RuntimeSettingsErrorKind): number {
  switch (kind) {
    case 'invalid-queue-behavior': return 422
    case 'io-failure':
    case 'store-corrupt':
      return 500
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
