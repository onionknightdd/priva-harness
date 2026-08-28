import { IMAGE_READ_TOOL_NAME } from '../event/tool-names.js'
import { loadWorkspaceImage } from './image-artifact.js'
import { CompatibleImageApi } from './image-api.js'
import { defineTool, stringToolArg } from './define-tool.js'
import { requireImageModel } from './image-tool-shared.js'

export const imageReadTool = defineTool({
  name: IMAGE_READ_TOOL_NAME,
  description: [
    'Read a workspace image with a text prompt via chat completions (`image_url` data URL).',
    'Returns the model text as this tool\'s output.',
    'Do not pass a model; the current run profile selects the understanding model.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      image_path: {
        type: 'string',
        description: 'Workspace path of the image to read.',
      },
      prompt: {
        type: 'string',
        description: 'Question or instruction about the image.',
      },
    },
    required: ['image_path', 'prompt'],
  },
  async execute(input, context) {
    const prompt = stringToolArg(input, 'prompt').trim()
    const imagePath = stringToolArg(input, 'image_path').trim()
    if (imagePath === '') {
      return { ok: false, text: 'image_read requires image_path' }
    }
    if (prompt === '') {
      return { ok: false, text: 'image_read requires a non-empty prompt' }
    }
    const resolved = requireImageModel(context.profile, 'image_understanding')
    if (!resolved.ok) {
      return { ok: false, text: resolved.error }
    }
    try {
      const image = await loadWorkspaceImage(context.cwd, imagePath)
      const text = await new CompatibleImageApi().read(
        resolved.profile,
        resolved.model,
        {
          prompt,
          image,
          signal: context.signal,
          ...(context.emitProgress === undefined ? {} : { onDelta: context.emitProgress }),
        },
      )
      return { ok: true, text }
    } catch (error) {
      return {
        ok: false,
        text: error instanceof Error ? error.message : String(error),
      }
    }
  },
})
