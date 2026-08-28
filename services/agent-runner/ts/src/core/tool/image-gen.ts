import { IMAGE_GEN_TOOL_NAME } from '../event/tool-names.js'
import { CompatibleImageApi } from './image-api.js'
import { defineTool, stringToolArg } from './define-tool.js'
import { requireImageModel, writeGeneratedImage } from './image-tool-shared.js'

export const imageGenTool = defineTool({
  name: IMAGE_GEN_TOOL_NAME,
  description: [
    'Generate an image from a text prompt and save it under the current workspace `.images/` directory.',
    'Returns the saved file path.',
    'Do not pass a model; the current run profile selects the generation model.',
    'Optional size uses the OpenAI `WIDTHxHEIGHT` form, for example `1024x1024`.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'Text description of the image to generate.',
      },
      size: {
        type: 'string',
        description: 'Optional image size in `WIDTHxHEIGHT` form, for example `1024x1024`.',
      },
    },
    required: ['prompt'],
  },
  async execute(input, context) {
    const prompt = stringToolArg(input, 'prompt').trim()
    if (prompt === '') {
      return { ok: false, text: 'image_gen requires a non-empty prompt' }
    }
    const resolved = requireImageModel(context.profile, 'image_generation')
    if (!resolved.ok) {
      return { ok: false, text: resolved.error }
    }
    const size = stringToolArg(input, 'size').trim()
    try {
      const generated = await new CompatibleImageApi().generate(
        resolved.profile,
        resolved.model,
        {
          prompt,
          stream: context.streamImages === true,
          signal: context.signal,
          ...(size === '' ? {} : { size }),
          ...(context.emitImage === undefined ? {} : { onImage: context.emitImage }),
        },
      )
      const filePath = await writeGeneratedImage({
        cwd: context.cwd,
        mimeType: generated.mime,
        bytes: generated.bytes,
      })
      return { ok: true, text: filePath }
    } catch (error) {
      return {
        ok: false,
        text: error instanceof Error ? error.message : String(error),
      }
    }
  },
})
