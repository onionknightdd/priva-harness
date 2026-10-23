import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'

import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

import { userTurnText, type UserTurn } from '../../core/run/user-turn.js'

const IMAGE_MEDIA_TYPES: Readonly<Record<string, 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

/**
 * Images precede the text, like a paste into the TUI. The transcript keeps
 * them as base64 blocks, which history replay restores as attachments.
 */
export async function claudeUserMessage(turn: UserTurn): Promise<SDKUserMessage> {
  const text = userTurnText(turn)
  const images = await Promise.all((turn.imagePaths ?? []).map(async (path) => {
    const mediaType = IMAGE_MEDIA_TYPES[extname(path).toLowerCase()]
    if (mediaType === undefined) throw new Error(`Unsupported image type for Claude: ${path}`)
    return { type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType, data: (await readFile(path)).toString('base64') } }
  }))
  return {
    type: 'user',
    message: {
      role: 'user',
      content: images.length === 0 ? text : [...images, { type: 'text', text }],
    },
    parent_tool_use_id: null,
    uuid: randomUUID(),
  }
}
