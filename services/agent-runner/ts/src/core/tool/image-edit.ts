import { IMAGE_EDIT_TOOL_NAME } from '../event/tool-names.js'
import { loadWorkspaceImage } from './image-artifact.js'
import { CompatibleImageApi } from './image-api.js'
import { defineTool, stringListToolArg, stringToolArg } from './define-tool.js'
import { requireImageModel, writeGeneratedImage } from './image-tool-shared.js'

export const imageEditTool = defineTool({
  name: IMAGE_EDIT_TOOL_NAME,
  description: [
    'Edit one or more existing workspace images with a text prompt and save the result under `.images/`.',
    'Returns the saved file path.',
    'Accepts multiple source images; does not accept a mask.',
    'Do not pass a model; the current run profile selects the edit model.',
    'Optional size uses the OpenAI `WIDTHxHEIGHT` form, for example `1024x1024`.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'How the source image or images should change.',
      },
      image_path: {
        type: 'string',
        description:
          'Workspace path of a source image. Pass several paths as a comma- or newline-separated string.',
      },
      size: {
        type: 'string',
        description: 'Optional output size in `WIDTHxHEIGHT` form, for example `1024x1024`.',
      },
    },
    required: ['prompt', 'image_path'],
  },
  async execute(input, context) {
    const prompt = stringToolArg(input, 'prompt').trim()
    const imagePaths = stringListToolArg(input, 'image_path')
    if (prompt === '') {
      return { ok: false, text: 'image_edit requires a non-empty prompt' }
    }
    if (imagePaths.length === 0) {
      return { ok: false, text: 'image_edit requires at least one image_path' }
    }
    const resolved = requireImageModel(context.profile, 'image_edit')
    if (!resolved.ok) {
      return { ok: false, text: resolved.error }
    }
    if (context.profile === undefined) {
      return { ok: false, text: resolved.error }
    }
    const size = stringToolArg(input, 'size').trim()
    try {
      const images = []
      for (const imagePath of imagePaths) {
        images.push(await loadWorkspaceImage(context.cwd, imagePath))
      }
      const edited = await new CompatibleImageApi().edit(
        context.profile,
        resolved.model,
        {
          prompt,
          images,
          ...(size === '' ? {} : { size }),
          stream: context.streamImages === true,
          onImage: context.emitImage,
          signal: context.signal,
        },
      )
      const filePath = await writeGeneratedImage({
        cwd: context.cwd,
        mimeType: edited.mime,
        bytes: edited.bytes,
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
