import { AgentApiError } from '../../core/agent-api/errors.js'
import type { UserMessage } from '../../core/agent-api/input.js'
import type { ContentBlock } from '../../core/agent-api/objects.js'
import type { AgentApiWorkspace } from '../../core/contract/agent-api-workspace.js'
import type { UserAttachment, UserTurn } from '../../core/run/user-turn.js'

// The image types every vision model behind Claude and Pi accepts.
const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

export interface PreparedMessage {
  readonly turn: UserTurn
  /** The confirmed input, echoed in `run.started` with workdir-relative paths. */
  readonly content: readonly ContentBlock[]
}

export interface MessageInputContext {
  readonly cwd: string
  readonly workspace: AgentApiWorkspace
  readonly acceptsImages: boolean
  readonly model: string
  readonly maxInlineBytes: number
  readonly param: string
}

/** Text joins with blank lines; images precede it and files follow, as `userTurnText` encodes them. */
export async function prepareMessage(message: UserMessage, context: MessageInputContext): Promise<PreparedMessage> {
  const firstImage = message.parts.findIndex((part) => part.type === 'image')
  if (firstImage >= 0 && !context.acceptsImages) {
    throw new AgentApiError('image_input_unsupported', `The current model ${context.model} does not accept image input`,
      { param: `${context.param}.parts[${String(firstImage)}]` })
  }
  const texts: string[] = []
  const images: UserAttachment[] = []
  const files: UserAttachment[] = []
  for (const [index, part] of message.parts.entries()) {
    const param = `${context.param}.parts[${String(index)}]`
    if (part.type === 'text') {
      if (part.text.trim() !== '') texts.push(part.text)
    } else if (part.type === 'image') {
      images.push(part.image_path !== undefined
        ? await existingImage(context, part.image_path, `${param}.image_path`)
        : await inlineImage(context, part.image_url ?? '', images.length + 1, `${param}.image_url`))
    } else if (part.file_path !== undefined) {
      files.push(await context.workspace.resolveFile(context.cwd, part.file_path, `${param}.file_path`))
    } else {
      const { bytes } = decodeDataUrl(part.file_data ?? '', context.maxInlineBytes, `${param}.file_data`)
      files.push(await context.workspace.writeAttachment(context.cwd, part.filename ?? 'file', bytes))
    }
  }
  const text = texts.join('\n\n')
  const relative = (file: UserAttachment) => context.workspace.relativePath(context.cwd, file.path)
  return {
    turn: {
      text,
      ...(files.length === 0 ? {} : { attachments: files }),
      ...(images.length === 0 ? {} : { imagePaths: images.map((image) => image.path) }),
    },
    content: [
      ...images.map((image): ContentBlock => ({ type: 'image', image_path: relative(image), media_type: image.mimeType })),
      ...(text === '' ? [] : [{ type: 'text' as const, text }]),
      ...files.map((file): ContentBlock => ({ type: 'file', file_path: relative(file), name: file.name, media_type: file.mimeType, size: file.size })),
    ],
  }
}

async function existingImage(context: MessageInputContext, path: string, param: string): Promise<UserAttachment> {
  const image = await context.workspace.resolveFile(context.cwd, path, param)
  if (IMAGE_EXTENSIONS[image.mimeType] === undefined) {
    throw new AgentApiError('validation_failed', `Images must be PNG, JPEG, GIF or WebP, not ${image.mimeType}`, { param })
  }
  return image
}

async function inlineImage(context: MessageInputContext, url: string, ordinal: number, param: string): Promise<UserAttachment> {
  const { mediaType, bytes } = decodeDataUrl(url, context.maxInlineBytes, param)
  const extension = IMAGE_EXTENSIONS[mediaType]
  if (extension === undefined) throw new AgentApiError('validation_failed', `Images must be PNG, JPEG, GIF or WebP, not ${mediaType}`, { param })
  return context.workspace.writeAttachment(context.cwd, `image-${String(ordinal)}.${extension}`, bytes)
}

function decodeDataUrl(url: string, maxBytes: number, param: string): { mediaType: string; bytes: Uint8Array } {
  const comma = url.indexOf(',')
  const header = url.slice('data:'.length, comma)
  const mediaType = header.split(';')[0]?.toLowerCase() ?? ''
  const data = url.slice(comma + 1)
  if (Math.floor(data.length * 3 / 4) > maxBytes + 2) {
    throw new AgentApiError('file_too_large', `Inline content exceeds the ${String(maxBytes)} byte limit`, { param })
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(data)) throw new AgentApiError('validation_failed', 'Inline content is not valid base64', { param })
  return { mediaType, bytes: Buffer.from(data, 'base64') }
}
