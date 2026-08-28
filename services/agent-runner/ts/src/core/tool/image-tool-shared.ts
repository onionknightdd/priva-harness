import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  emptyModelCapabilityCatalog,
  resolveCapabilityModel,
  type ModelCapability,
} from '../resource/model-profile.js'
import { imageArtifactFileName, resolveImageArtifactPath } from './image-artifact.js'
import type { ImageToolProfile } from './define-tool.js'

const CAPABILITY_ERROR: Record<ModelCapability, string> = {
  image_understanding: 'image_read failed: this profile has no image understanding model',
  image_generation: 'image_gen failed: this profile has no image generation model',
  image_edit: 'image_edit failed: this profile has no image edit model',
}

export function imageToolsFromSpec(spec: {
  readonly baseUrl: string
  readonly authToken: string
  readonly imageTools?: ImageToolProfile
}): ImageToolProfile {
  return spec.imageTools ?? {
    baseUrl: spec.baseUrl,
    authToken: spec.authToken,
    imageUnderstandingModel: null,
    imageGenerationModel: null,
    imageEditModel: null,
    modelCapabilities: emptyModelCapabilityCatalog(),
  }
}

export function requireImageModel(
  profile: ImageToolProfile | undefined,
  capability: ModelCapability,
):
  | { ok: true; model: string; profile: ImageToolProfile }
  | { ok: false; error: string } {
  if (profile === undefined) {
    return { ok: false, error: CAPABILITY_ERROR[capability] }
  }
  const model = resolveCapabilityModel(profile, capability)
  if (model === null || model === '') {
    return { ok: false, error: CAPABILITY_ERROR[capability] }
  }
  return { ok: true, model, profile }
}

export async function writeGeneratedImage(input: {
  cwd: string
  mimeType: string
  bytes: Uint8Array
}): Promise<string> {
  const fileName = imageArtifactFileName(input.bytes, input.mimeType)
  const filePath = resolveImageArtifactPath(input.cwd, fileName)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, input.bytes)
  return filePath
}
