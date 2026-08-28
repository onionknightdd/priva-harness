import type { FastifyPluginCallback } from 'fastify'

import type { ProviderId, ProviderRunSpec } from '../../../core/contract/agent-provider.js'
import { ModelProfileError } from '../../../core/resource/model-profile.js'
import { rewriteProviderBaseUrl } from '../../../core/resource/run-harness.js'
import type { SlashCommand } from '../../../core/resource/slash-command.js'
import type { AgentHarness } from '../../../harness/agent-harness.js'
import type { ModelProfileService } from '../../../harness/config/model-profile-service.js'
import { listSlashCommandsSchema } from '../schema/slash-command-schema.js'

export const SLASH_COMMANDS_ROUTE = '/api/sandbox/agent/slash-commands'

export interface SlashCommandRoutesOptions {
  readonly harness: AgentHarness
  readonly modelProfileService: ModelProfileService
  readonly cwd: string
}

interface SlashCommandQuery {
  readonly harness: ProviderId
  readonly cwd?: string
}

export const slashCommandRoutes: FastifyPluginCallback<SlashCommandRoutesOptions> = (
  fastify,
  options,
  done,
) => {
  fastify.get<{ Querystring: SlashCommandQuery }>(
    SLASH_COMMANDS_ROUTE,
    { schema: listSlashCommandsSchema },
    async (request) => {
      const requestedCwd = request.query.cwd?.trim()
      const cwd = requestedCwd === undefined || requestedCwd === '' ? options.cwd : requestedCwd
      const spec = request.query.harness === 'claude'
        ? await listingRunSpec(options.modelProfileService, request.query.harness, cwd)
        : undefined
      const catalog = await options.harness.listSlashCommands({
        provider: request.query.harness,
        cwd,
        ...(spec === undefined ? {} : { spec }),
      })
      return {
        harness: catalog.harness,
        cwd: catalog.cwd,
        commands: catalog.commands.map(toSlashCommandResponse),
      }
    },
  )
  done()
}

async function listingRunSpec(
  modelProfileService: ModelProfileService,
  provider: ProviderId,
  cwd: string,
): Promise<ProviderRunSpec> {
  const listed = await modelProfileService.listProfiles()
  if (listed.defaultProfileId === null) {
    throw new ModelProfileError('default-profile-missing', 'default_profile_missing')
  }
  const profile = await modelProfileService.getProfile(listed.defaultProfileId)
  if (profile.baseUrl === '' || profile.authToken === '' || profile.defaultModel === null) {
    throw new ModelProfileError('profile-not-ready', 'profile_not_ready')
  }
  const resolved = await modelProfileService.resolve(profile.defaultModel)
  return {
    cwd,
    provider,
    model: resolved.model,
    baseUrl: rewriteProviderBaseUrl(resolved.profile.baseUrl, provider),
    authToken: resolved.profile.authToken,
    profileId: resolved.profile.id,
    modelContext: resolved.capabilities.context,
  }
}

function toSlashCommandResponse(command: SlashCommand): Record<string, unknown> {
  return {
    name: command.name,
    description: command.description,
    kind: command.kind,
    origin: command.origin,
    ...(command.argumentHint === undefined ? {} : { argument_hint: command.argumentHint }),
    ...(command.aliases === undefined ? {} : { aliases: command.aliases }),
  }
}
