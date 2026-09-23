import type { ProviderRunSpec, SessionRef, SessionTarget } from '../../core/contract/agent-provider.js'
import type { SessionMetadataRepository } from '../../core/contract/session-metadata-repository.js'
import { assertRunMode, SessionError, sessionRefKey, type RunMode } from '../../core/resource/session.js'
import { PLATFORM_INSTRUCTIONS } from '../prompt/platform-instructions.js'

/** Session policy is persisted when the harness owns a session repository. */
export class SessionRunModes {
  private readonly modes = new Map<string, RunMode>()

  constructor(private readonly metadata?: SessionMetadataRepository) {}

  async get(ref: SessionRef): Promise<RunMode> {
    if (this.metadata) return (await this.metadata.get(ref)).runMode ?? 'code'
    return this.modes.get(sessionRefKey(ref)) ?? 'code'
  }

  async bind(ref: SessionRef, mode: RunMode): Promise<RunMode> {
    if (this.metadata) {
      await this.metadata.upsert(ref, { runMode: mode })
      return mode
    }
    const key = sessionRefKey(ref), current = this.modes.get(key)
    assertRunMode(current, mode)
    this.modes.set(key, mode)
    return mode
  }

  async resolve(target: SessionTarget, spec: ProviderRunSpec): Promise<ProviderRunSpec> {
    const provider = target.kind === 'new' ? target.provider : target.kind === 'resume' ? target.session.provider : target.source.provider
    if (provider !== spec.provider) throw new SessionError('invalid-request', 'Session and requested provider differ')
    if (spec.provider !== 'claude') {
      if (spec.runMode !== undefined) throw new SessionError('invalid-request', 'Agent / Code modes are only available for Claude')
      return spec
    }
    const mode = target.kind === 'new' ? spec.runMode ?? 'agent'
      : await this.get(target.kind === 'resume' ? target.session : target.source)
    assertRunMode(mode, spec.runMode)
    const ref = target.kind === 'resume' ? target.session : { provider, id: target.sessionId ?? '' }
    if (!ref.id) throw new SessionError('invalid-request', 'Choose the Claude session ID before binding its mode')
    if (target.kind === 'fork') await this.bind(target.source, mode)
    await this.bind(ref, mode)
    return { ...spec, runMode: mode, systemInstructions: PLATFORM_INSTRUCTIONS }
  }
}
