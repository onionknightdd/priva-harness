import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { emptyModelCapabilityCatalog } from '../../../../src/core/resource/model-profile.js'
import { imageEditTool } from '../../../../src/core/tool/image-edit.js'
import { imageGenTool } from '../../../../src/core/tool/image-gen.js'
import { imageReadTool } from '../../../../src/core/tool/image-read.js'
import type { ImageToolProfile, ToolContext } from '../../../../src/core/tool/define-tool.js'

const pngB64 = Buffer.from('generated-png').toString('base64')

function profile(overrides: Partial<ImageToolProfile> = {}): ImageToolProfile {
  return {
    baseUrl: 'https://api.example.com/v1',
    authToken: 'secret',
    imageUnderstandingModel: null,
    imageGenerationModel: null,
    imageEditModel: null,
    modelCapabilities: emptyModelCapabilityCatalog(),
    ...overrides,
  }
}

async function context(overrides: Partial<ToolContext> = {}): Promise<ToolContext> {
  return {
    cwd: await mkdtemp(path.join(tmpdir(), 'image-tools-')),
    session: { provider: 'claude', id: 'sess-1' },
    signal: new AbortController().signal,
    ...overrides,
  }
}

describe('image tools', () => {
  it('fails when the profile has no matching capability', async () => {
    const toolContext = await context({ profile: profile() })
    await expect(imageGenTool.execute({ prompt: 'a lake' }, toolContext)).resolves.toEqual({
      ok: false,
      text: 'image_gen failed: this profile has no image generation model',
    })
    await expect(
      imageReadTool.execute({ image_path: 'a.png', prompt: 'what' }, toolContext),
    ).resolves.toEqual({
      ok: false,
      text: 'image_read failed: this profile has no image understanding model',
    })
    await expect(
      imageEditTool.execute({ image_path: 'a.png', prompt: 'blue' }, toolContext),
    ).resolves.toEqual({
      ok: false,
      text: 'image_edit failed: this profile has no image edit model',
    })
  })

  it('writes a generated image under .images and returns the path', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(Response.json({ data: [{ b64_json: pngB64 }] })))
    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchImpl
    try {
      const toolContext = await context({
        profile: profile({
          modelCapabilities: {
            ...emptyModelCapabilityCatalog(),
            imageGeneration: ['gen-a'],
          },
        }),
      })
      const result = await imageGenTool.execute({ prompt: 'a lake', size: '1024x1024' }, toolContext)
      expect(result.ok).toBe(true)
      expect(result.text).toMatch(/\.images\/[a-z2-7]+\.png$/)
      await expect(readFile(result.text)).resolves.toEqual(Buffer.from('generated-png'))
      expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).not.toMatchObject({
        stream: true,
      })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('reads a workspace image through chat completions', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(Response.json({
      choices: [{ message: { content: 'a red square' } }],
    })))
    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchImpl
    try {
      const toolContext = await context({
        profile: profile({ imageUnderstandingModel: 'vision-a' }),
      })
      await writeFile(path.join(toolContext.cwd, 'shot.png'), 'source-png')
      await expect(
        imageReadTool.execute({ image_path: 'shot.png', prompt: 'describe' }, toolContext),
      ).resolves.toEqual({ ok: true, text: 'a red square' })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('edits multiple workspace images', async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      const body = init?.body
      if (body instanceof FormData) {
        expect(body.getAll('image[]')).toHaveLength(2)
        expect(body.get('stream')).toBeNull()
        expect(body.get('partial_images')).toBeNull()
      }
      return Promise.resolve(Response.json({ data: [{ b64_json: pngB64 }] }))
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchImpl as typeof fetch
    try {
      const toolContext = await context({
        profile: profile({ imageEditModel: 'edit-a' }),
      })
      await writeFile(path.join(toolContext.cwd, 'a.png'), 'a')
      await writeFile(path.join(toolContext.cwd, 'b.png'), 'b')
      const result = await imageEditTool.execute(
        { prompt: 'merge', image_path: 'a.png,b.png' },
        toolContext,
      )
      expect(result.ok).toBe(true)
      expect(result.text).toMatch(/\.images\/[a-z2-7]+\.png$/)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
