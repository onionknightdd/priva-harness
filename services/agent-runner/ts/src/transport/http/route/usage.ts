import type { FastifyPluginCallback } from 'fastify'

import type { UsageReader } from '../../../core/contract/usage-reader.js'
import { daysBetween, isValidLocalDate, isValidTimeZone } from '../../../core/resource/local-time.js'

export const USAGE_ROUTE_PREFIX = '/api/sandbox/usage'

const DEFAULT_HEATMAP_DAYS = 183
const MAX_HEATMAP_DAYS = 365
const DEFAULT_AUDIT_LIMIT = 50
const MAX_AUDIT_LIMIT = 200
// Facts are pruned after a year by default; ten years bounds a runaway query.
const MAX_RANGE_DAYS = 3660

export interface UsageRoutesOptions {
  readonly reader: UsageReader
}

interface OverviewQuery {
  readonly tz: string
  readonly days?: number
}

interface RangeQuery {
  readonly tz: string
  readonly from: string
  readonly to: string
}

interface AuditQuery {
  readonly before?: number
  readonly limit?: number
  readonly action?: string
  readonly session_id?: string
}

const overviewSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    required: ['tz'],
    properties: {
      tz: { type: 'string', minLength: 1, maxLength: 64 },
      days: { type: 'integer', minimum: 1, maximum: MAX_HEATMAP_DAYS },
    },
  },
} as const

const rangeSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    required: ['tz', 'from', 'to'],
    properties: {
      tz: { type: 'string', minLength: 1, maxLength: 64 },
      from: { type: 'string', minLength: 10, maxLength: 10 },
      to: { type: 'string', minLength: 10, maxLength: 10 },
    },
  },
} as const

const auditSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      before: { type: 'integer', minimum: 1 },
      limit: { type: 'integer', minimum: 1, maximum: MAX_AUDIT_LIMIT },
      action: { type: 'string', minLength: 1, maxLength: 64 },
      session_id: { type: 'string', minLength: 1, maxLength: 128 },
    },
  },
} as const

// Read side of the usage store. The client names its IANA time zone so the
// server can fold UTC facts into the user's calendar days.
export const usageRoutes: FastifyPluginCallback<UsageRoutesOptions> = (fastify, options, done) => {
  fastify.get<{ Querystring: OverviewQuery }>(
    `${USAGE_ROUTE_PREFIX}/overview`,
    { schema: overviewSchema },
    async (request, reply) => {
      if (!isValidTimeZone(request.query.tz)) {
        return await reply.code(422).send({ detail: `Unknown time zone: ${request.query.tz}` })
      }
      return await options.reader.overview({
        timeZone: request.query.tz,
        heatmapDays: request.query.days ?? DEFAULT_HEATMAP_DAYS,
      })
    },
  )

  fastify.get<{ Querystring: RangeQuery }>(
    `${USAGE_ROUTE_PREFIX}/range`,
    { schema: rangeSchema },
    async (request, reply) => {
      const { tz, from, to } = request.query
      if (!isValidTimeZone(tz)) {
        return await reply.code(422).send({ detail: `Unknown time zone: ${tz}` })
      }
      if (!isValidLocalDate(from) || !isValidLocalDate(to)) {
        return await reply.code(422).send({ detail: 'from and to must be calendar dates formatted YYYY-MM-DD' })
      }
      if (from > to) {
        return await reply.code(422).send({ detail: 'from must not be after to' })
      }
      if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) {
        return await reply.code(422).send({ detail: `Range must not exceed ${MAX_RANGE_DAYS} days` })
      }
      return await options.reader.range({ timeZone: tz, from, to })
    },
  )

  fastify.get<{ Querystring: AuditQuery }>(
    `${USAGE_ROUTE_PREFIX}/audit`,
    { schema: auditSchema },
    async (request) => await options.reader.auditPage({
      limit: request.query.limit ?? DEFAULT_AUDIT_LIMIT,
      ...(request.query.before === undefined ? {} : { before: request.query.before }),
      ...(request.query.action === undefined ? {} : { action: request.query.action }),
      ...(request.query.session_id === undefined ? {} : { sessionId: request.query.session_id }),
    }),
  )

  done()
}
