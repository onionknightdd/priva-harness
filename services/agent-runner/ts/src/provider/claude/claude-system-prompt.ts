import type { ProviderRunSpec } from '../../core/contract/agent-provider.js'
import { isRunMode } from '../../core/resource/session.js'

export function claudeSystemPrompt(spec: ProviderRunSpec): string | { type: 'preset'; preset: 'claude_code'; append: string } {
  if (!isRunMode(spec.runMode) || !spec.systemInstructions?.trim()) {
    throw new Error('Claude requires a resolved session mode and platform instructions')
  }
  return spec.runMode === 'agent' ? spec.systemInstructions
    : { type: 'preset', preset: 'claude_code', append: spec.systemInstructions }
}

export function claudeSystemPromptArgs(spec: ProviderRunSpec): string[] {
  const prompt = claudeSystemPrompt(spec)
  return typeof prompt === 'string' ? ['--system-prompt', prompt] : ['--append-system-prompt', prompt.append]
}
