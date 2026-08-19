import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

export function singleShotUserMessage(text: string): AsyncIterable<SDKUserMessage> {
  const message: SDKUserMessage = {
    type: 'user',
    message: {
      role: 'user',
      content: text,
    },
    parent_tool_use_id: null,
  }
  return {
    [Symbol.asyncIterator]() {
      let yielded = false
      return {
        next(): Promise<IteratorResult<SDKUserMessage>> {
          if (yielded) return Promise.resolve({ value: undefined, done: true })
          yielded = true
          return Promise.resolve({ value: message, done: false })
        },
      }
    },
  }
}
