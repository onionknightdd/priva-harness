import type { FastifyPluginCallback } from 'fastify'
import { z } from 'zod'

import type { DataRecorder } from '../../../core/contract/data-recorder.js'
import type { ResourceService } from '../../../core/contract/resource-service.js'
import { auditRoute } from '../route-audit.js'
import { ResourceError, type ResourceQuery } from '../../../core/resource/resource-catalog.js'

const prefix = '/api/sandbox/resource'
const querySchema = z.object({ harness: z.enum(['claude', 'pi']), cwd: z.string().min(1).max(4096).optional() })
const definitionSchema = z.record(z.string(), z.unknown())
const draftSchema = z.object({ id: z.string().min(1).optional(), definition: definitionSchema.optional() }).refine((value) => (value.id === undefined) !== (value.definition === undefined), 'Provide either id or definition')
const agentDraft = z.object({ definition: definitionSchema, prompt: z.string().max(1024 * 1024) })
const revisionSchema = z.string().regex(/^[A-Za-z0-9_-]{32}$/u)

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new ResourceError(422, result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '))
  return result.data
}

function query(value: unknown): ResourceQuery {
  const parsed = parse(querySchema, value)
  return { harness: parsed.harness, ...(parsed.cwd === undefined ? {} : { cwd: parsed.cwd }) }
}

function id(value: unknown): string {
  return parse(z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{32}$/u) }), value).id
}

export const resourceRoutes: FastifyPluginCallback<{ service: ResourceService; onChanged?: () => Promise<void>; recorder?: DataRecorder }> = (server, { service, onChanged, recorder }, done) => {
  const audit = (action: string, context: ResourceQuery, target: string, details: Record<string, unknown> = {}): void => {
    auditRoute(recorder, action, { target, details: { harness: context.harness, ...(context.cwd === undefined ? {} : { cwd: context.cwd }), ...details } })
  }
  server.get(`${prefix}/skills`, async (request) => await service.skills.list(query(request.query)))
  server.get(`${prefix}/subagents/catalog`, (request) => service.subagents.catalog(query(request.query)))
  server.get(`${prefix}/subagents`, async (request) => await service.subagents.list(query(request.query)))
  server.get(`${prefix}/subagents/:id`, async (request) => await service.subagents.get(query(request.query), id(request.params)))
  server.post(`${prefix}/subagents`, async (request, reply) => {
    const input = parse(agentDraft.extend({ sourceId: revisionSchema }).strict(), request.body)
    const context = query(request.query)
    const result = await service.subagents.create(context, input)
    audit('agents.created', context, result.id, { name: result.name })
    await onChanged?.()
    return await reply.code(201).send(result)
  })
  server.patch(`${prefix}/subagents/:id`, async (request) => {
    const input = parse(agentDraft.extend({ revision: revisionSchema }).strict(), request.body)
    const context = query(request.query)
    const result = await service.subagents.update(context, id(request.params), input)
    audit('agents.updated', context, result.id, { name: result.name })
    await onChanged?.()
    return result
  })
  server.delete(`${prefix}/subagents/:id`, async (request, reply) => {
    const { revision } = parse(z.object({ revision: revisionSchema }).strict(), request.body)
    const context = query(request.query)
    await service.subagents.delete(context, id(request.params), revision)
    audit('agents.deleted', context, id(request.params))
    await onChanged?.()
    return await reply.code(204).send()
  })
  server.get(`${prefix}/memory`, async (request) => await service.memory.list(query(request.query)))
  server.get(`${prefix}/memory/:id`, async (request) => await service.memory.get(query(request.query), id(request.params)))
  server.patch(`${prefix}/memory/:id`, async (request) => {
    const { content, revision } = parse(z.object({ content: z.string().max(1024 * 1024), revision: revisionSchema }).strict(), request.body)
    const context = query(request.query)
    const result = await service.memory.update(context, id(request.params), content, revision)
    audit('memory.updated', context, result.id, { name: result.name, contentChars: content.length })
    await onChanged?.()
    return result
  })
  server.delete(`${prefix}/memory/:id`, async (request, reply) => {
    const { revision } = parse(z.object({ revision: revisionSchema }).strict(), request.body)
    const context = query(request.query)
    await service.memory.delete(context, id(request.params), revision)
    audit('memory.deleted', context, id(request.params))
    await onChanged?.()
    return await reply.code(204).send()
  })
  server.put(`${prefix}/memory/auto/enabled`, async (request) => {
    const { enabled } = parse(z.object({ enabled: z.boolean() }).strict(), request.body)
    const context = query(request.query)
    const result = await service.memory.toggle(context, enabled)
    audit('memory.auto_toggled', context, 'auto', { enabled })
    await onChanged?.()
    return result
  })
  server.get(`${prefix}/skills/:id`, async (request) => await service.skills.get(query(request.query), id(request.params)))
  server.get(`${prefix}/skills/:id/file`, async (request) => {
    const path = parse(z.object({ path: z.string().min(1).max(4096) }), request.query).path
    return await service.skills.file(query(request.query), id(request.params), path)
  })
  server.get(`${prefix}/skills/:id/asset`, async (request, reply) => {
    const path = parse(z.object({ path: z.string().min(1).max(4096) }), request.query).path
    const asset = await service.skills.asset(query(request.query), id(request.params), path)
    return await reply.type(asset.mediaType)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'")
      .header('Cache-Control', 'no-cache')
      .send(asset.data)
  })
  server.get(`${prefix}/skills/:id/download`, async (request, reply) => {
    const archive = await service.downloadSkill(query(request.query), id(request.params))
    return await reply.header('Content-Type', 'application/zip').header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(archive.filename)}`).send(Buffer.from(archive.data))
  })
  server.post(`${prefix}/skills/upload`, async (request, reply) => {
    const context = query(request.query)
    const { scope } = parse(z.object({ scope: z.enum(['global', 'project']) }), request.query)
    const file = await request.file({ limits: { fileSize: 3 * 1024 * 1024, files: 1 } })
    if (file === undefined) throw new ResourceError(422, 'A skill archive is required')
    let data: Buffer
    try { data = await file.toBuffer() } catch { throw new ResourceError(413, 'Skill archives must be 3 MB or smaller') }
    const result = await service.uploadSkill(context, scope, file.filename, data)
    audit('skill.uploaded', context, result.id, { name: result.name, scope, filename: file.filename, bytes: data.byteLength })
    await onChanged?.()
    return await reply.code(201).send(result)
  })
  server.patch(`${prefix}/skills/:id`, async (request) => {
    const { enabled } = parse(z.object({ enabled: z.boolean() }).strict(), request.body)
    const context = query(request.query)
    const result = await service.skills.toggle(context, id(request.params), enabled)
    audit('skill.toggled', context, result.id, { name: result.name, enabled })
    await onChanged?.()
    return result
  })
  server.delete(`${prefix}/skills/:id`, async (request, reply) => {
    const context = query(request.query)
    await service.skills.delete(context, id(request.params))
    audit('skill.deleted', context, id(request.params))
    await onChanged?.()
    return await reply.code(204).send()
  })
  server.get(`${prefix}/mcp`, async (request) => await service.mcp.list(query(request.query)))
  server.get(`${prefix}/mcp/:id`, async (request) => await service.mcp.get(query(request.query), id(request.params)))
  server.post(`${prefix}/mcp`, async (request, reply) => {
    const value = parse(z.object({ name: z.string(), definition: definitionSchema, sourceId: z.string().optional(), scope: z.enum(['global', 'project', 'local']).optional() }).strict(), request.body)
    const context = query(request.query)
    const result = await service.mcp.create(context, {
      name: value.name, definition: value.definition,
      ...(value.sourceId === undefined ? {} : { sourceId: value.sourceId }),
      ...(value.scope === undefined ? {} : { scope: value.scope }),
    })
    audit('mcp.created', context, result.id, { name: result.name, ...(value.scope === undefined ? {} : { scope: value.scope }) })
    await onChanged?.()
    return await reply.code(201).send(result)
  })
  server.patch(`${prefix}/mcp/:id`, async (request) => {
    const { definition } = parse(z.object({ definition: definitionSchema }).strict(), request.body)
    const context = query(request.query)
    const result = await service.mcp.update(context, id(request.params), definition)
    audit('mcp.updated', context, result.id, { name: result.name })
    await onChanged?.()
    return result
  })
  server.delete(`${prefix}/mcp/:id`, async (request, reply) => {
    const context = query(request.query)
    await service.mcp.delete(context, id(request.params))
    audit('mcp.deleted', context, id(request.params))
    await onChanged?.()
    return await reply.code(204).send()
  })
  server.get(`${prefix}/mcp/:id/capabilities`, async (request) => await service.capabilities(query(request.query), { id: id(request.params) }))
  server.post(`${prefix}/mcp/validate`, async (request) => {
    const value = parse(draftSchema, request.body)
    return await service.capabilities(query(request.query), value.id !== undefined ? { id: value.id } : { definition: value.definition ?? {} })
  })
  server.post(`${prefix}/mcp/validate/tool`, async (request) => {
    const value = parse(draftSchema.safeExtend({ name: z.string().min(1), args: definitionSchema }), request.body)
    return await service.callTool(query(request.query), { name: value.name, args: value.args, ...(value.id !== undefined ? { id: value.id } : { definition: value.definition ?? {} }) })
  })
  done()
}
