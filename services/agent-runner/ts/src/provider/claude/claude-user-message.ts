import { randomUUID } from 'node:crypto'

import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

export function claudeUserMessage(text: string): SDKUserMessage {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: text,
    },
    parent_tool_use_id: null,
    uuid: randomUUID(),
  }
}
