import type { FastifyPluginCallback } from 'fastify'

import type { ProviderId } from '../../../core/contract/agent-provider.js'
import { SessionError } from '../../../core/resource/session.js'
import type { SessionService, SessionView } from '../../../harness/session/session-service.js'
import {
  addDirsSchema,
  archiveSessionSchema,
  deleteSessionSchema,
  forkSessionSchema,
  listRunningSessionsSchema,
  listSessionsSchema,
  pinSessionSchema,
  renameSessionSchema,
  sessionMessagesSchema,
  sessionRecapSchema,
  tagSessionSchema,
} from '../schema/session-schema.js'

const SESSION_ROUTE_PREFIX = '/api/sandbox/agent/sessions'

export interface SessionRoutesOptions {
  readonly sessionService: SessionService
}

interface HarnessQuery {
  readonly harness: ProviderId
  readonly cwd?: string
  readonly archived?: string
  readonly limit?: string
  readonly offset?: string
}

interface SessionParams {
  readonly session_id: string
}

export const sessionRoutes: FastifyPluginCallback<SessionRoutesOptions> = (
  fastify,
  options,
  done,
) => {
  const { sessionService } = options

  fastify.get<{ Querystring: HarnessQuery }>(
    SESSION_ROUTE_PREFIX,
    { schema: listSessionsSchema },
    async (request) => {
      const limit = parseOptionalInt(request.query.limit)
      const offset = parseOptionalInt(request.query.offset)
      const result = await sessionService.list({
        harness: request.query.harness,
        archived: request.query.archived === 'true',
        ...(request.query.cwd === undefined ? {} : { cwd: request.query.cwd }),
        ...(limit === undefined ? {} : { limit }),
        ...(offset === undefined ? {} : { offset }),
      })
      if (result.kind === 'grouped') {
        return {
          groups: result.groups.map((group) => ({
            cwd: group.cwd,
            pinned: group.pinned,
            sessions: group.sessions.map(toSessionInfoResponse),
            has_more: group.hasMore,
          })),
          active_cwd: result.activeCwd,
        }
      }
      if (result.kind === 'flat') {
        return {
          cwd: result.cwd,
          sessions: result.sessions.map(toSessionInfoResponse),
          total: result.total,
          limit: result.limit,
          offset: result.offset,
        }
      }
      return {
        sessions: result.sessions.map(toSessionInfoResponse),
      }
    },
  )

  fastify.get<{ Querystring: HarnessQuery }>(
    `${SESSION_ROUTE_PREFIX}/running`,
    { schema: listRunningSessionsSchema },
    async (request) => ({
      running: (await sessionService.listRunning(request.query.harness)).map((item) => ({
        session_id: item.sessionId,
        run_id: item.runId,
        status: item.status,
        started_at: item.startedAt,
        last_seq: item.lastSeq,
        first_seq: item.firstSeq,
        first_user_uuid: item.firstUserUuid,
        pending_permission: item.pendingPermission,
        run_mode: item.runMode,
        harness: item.harness,
      })),
    }),
  )

  fastify.get<{ Params: SessionParams; Querystring: HarnessQuery }>(
    `${SESSION_ROUTE_PREFIX}/:session_id/messages`,
    { schema: sessionMessagesSchema },
    async (request) => {
      const limit = parseOptionalInt(request.query.limit)
      const offset = parseOptionalInt(request.query.offset)
      const result = await sessionService.messages(
        request.query.harness,
        request.params.session_id,
        {
          ...(limit === undefined ? {} : { limit }),
          ...(offset === undefined ? {} : { offset }),
        },
      )
      return {
        messages: result.messages.map((message) => ({
          type: message.type,
          uuid: message.uuid,
          session_id: message.sessionId,
          message: message.message,
          parent_tool_use_id: message.parentToolUseId,
          metadata: message.metadata,
          timestamp: message.timestamp,
        })),
        add_dirs: result.addDirs,
        run_mode: result.runMode,
        live_run_id: result.liveRunId,
        live_seq: result.liveSeq,
        live_first_seq: result.liveFirstSeq,
      }
    },
  )

  fastify.get<{ Params: SessionParams; Querystring: HarnessQuery }>(
    `${SESSION_ROUTE_PREFIX}/:session_id/recap`,
    { schema: sessionRecapSchema },
    async (request) => await sessionService.recap(
      request.query.harness,
      request.params.session_id,
    ),
  )

  fastify.delete<{ Params: SessionParams; Querystring: HarnessQuery }>(
    `${SESSION_ROUTE_PREFIX}/:session_id`,
    { schema: deleteSessionSchema },
    async (request) => {
      await sessionService.delete(request.query.harness, request.params.session_id)
      return { status: 'ok' }
    },
  )

  fastify.patch<{ Params: SessionParams; Querystring: HarnessQuery; Body: { title: string } }>(
    `${SESSION_ROUTE_PREFIX}/:session_id`,
    { schema: renameSessionSchema },
    async (request) => {
      await sessionService.rename(
        request.query.harness,
        request.params.session_id,
        request.body.title,
      )
      return { status: 'ok' }
    },
  )

  fastify.post<{
    Params: SessionParams
    Querystring: HarnessQuery
    Body: { stem: string; up_to_message_id?: string }
  }>(
    `${SESSION_ROUTE_PREFIX}/:session_id/fork`,
    { schema: forkSessionSchema },
    async (request) => toSessionInfoResponse(
      await sessionService.fork(
        request.query.harness,
        request.params.session_id,
        {
          stem: request.body.stem,
          ...(request.body.up_to_message_id === undefined
            ? {}
            : { upToMessageId: request.body.up_to_message_id }),
        },
      ),
    ),
  )

  fastify.put<{
    Params: SessionParams
    Querystring: HarnessQuery
    Body: { tags?: string[]; tag?: string }
  }>(
    `${SESSION_ROUTE_PREFIX}/:session_id/tag`,
    { schema: tagSessionSchema },
    async (request) => {
      const raw = request.body.tags ?? request.body.tag ?? []
      const result = await sessionService.setTags(
        request.query.harness,
        request.params.session_id,
        raw,
      )
      return {
        status: 'ok',
        tags: result.tags,
        tag_colors: result.tagColors,
      }
    },
  )

  fastify.put<{
    Params: SessionParams
    Querystring: HarnessQuery
    Body: { add_dirs: string[] }
  }>(
    `${SESSION_ROUTE_PREFIX}/:session_id/add_dirs`,
    { schema: addDirsSchema },
    async (request) => {
      const addDirs = await sessionService.setAddDirs(
        request.query.harness,
        request.params.session_id,
        request.body.add_dirs,
      )
      return { status: 'ok', add_dirs: addDirs }
    },
  )

  fastify.put<{
    Params: SessionParams
    Querystring: HarnessQuery
    Body: { pinned: boolean }
  }>(
    `${SESSION_ROUTE_PREFIX}/:session_id/pin`,
    { schema: pinSessionSchema },
    async (request) => {
      const flags = await sessionService.setPinned(
        request.query.harness,
        request.params.session_id,
        request.body.pinned,
      )
      return { status: 'ok', pinned: flags.pinned, archived: flags.archived }
    },
  )

  fastify.put<{
    Params: SessionParams
    Querystring: HarnessQuery
    Body: { archived: boolean }
  }>(
    `${SESSION_ROUTE_PREFIX}/:session_id/archive`,
    { schema: archiveSessionSchema },
    async (request) => {
      const flags = await sessionService.setArchived(
        request.query.harness,
        request.params.session_id,
        request.body.archived,
      )
      return { status: 'ok', pinned: flags.pinned, archived: flags.archived }
    },
  )

  done()
}

export function toSessionInfoResponse(session: SessionView): Record<string, unknown> {
  return {
    session_id: session.sessionId,
    summary: session.summary,
    last_modified: session.lastModified,
    file_size: session.fileSize,
    custom_title: session.customTitle,
    first_prompt: session.firstPrompt,
    git_branch: session.gitBranch,
    cwd: session.cwd,
    session_source: session.sessionSource,
    tag: session.tag,
    tags: session.tags,
    tag_colors: session.tagColors,
    pinned: session.pinned,
    archived: session.archived,
    parent_session_id: session.parentSessionId,
    parent_message_uuid: session.parentMessageUuid,
    fork_count: session.forkCount,
    origin: session.origin,
    scheduler_job_name: session.schedulerJobName,
    last_response_model: session.lastResponseModel === null
      ? null
      : {
        profile_id: session.lastResponseModel.profileId ?? '',
        model: {
          id: session.lastResponseModel.model.id,
          capabilities: {
            context: session.lastResponseModel.model.capabilities.context,
          },
        },
        observed_at: session.lastResponseModel.observedAt,
      },
    run_mode: session.runMode,
  }
}

function parseOptionalInt(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new SessionError('invalid-request', 'limit and offset must be non-negative integers')
  }
  return parsed
}
