import { CLAUDE_EFFORT_LEVELS, isClaudeEffortLevel, type ClaudeEffortLevel } from '../../core/contract/agent-provider.js'

export function assertClaudeEffort(effort: unknown): asserts effort is ClaudeEffortLevel | undefined {
  if (effort !== undefined && !isClaudeEffortLevel(effort)) {
    throw new Error(`Unsupported Claude effort; expected ${CLAUDE_EFFORT_LEVELS.join(', ')}`)
  }
}
