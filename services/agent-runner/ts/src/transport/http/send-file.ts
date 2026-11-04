import send from '@fastify/send'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { UserFileInfo } from '../../core/resource/user-file.js'

/** Shared streaming path: Range, If-Range, HEAD and conditional requests stay in fastify/send. */
export async function sendFile(request: FastifyRequest, reply: FastifyReply, file: UserFileInfo): Promise<FastifyReply> {
  const result = await send(request.raw, file.path.split('/').map(encodeURIComponent).join('/'), {
    dotfiles: 'allow', index: false, extensions: false, cacheControl: false,
    contentType: false,
  })
  void reply.headers(result.headers)
  void reply.header('Content-Type', file.mimeType)
  void reply.header('Cache-Control', 'no-cache')
  void reply.header('X-Content-Type-Options', 'nosniff')
  void reply.header('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'")
  return await reply.code(result.statusCode).send(result.stream)
}
