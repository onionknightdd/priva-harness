import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { ImageBytes } from './image-api.js'

export const IMAGE_DIRECTORY_NAME = '.images'
const HASH_BYTES = 10
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'

export function encodeBase32(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  }
  return output
}

export function imageExtensionForMime(mime: string): string {
  const normalized = mime.trim().toLowerCase()
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg'
  if (normalized === 'image/webp') return 'webp'
  if (normalized === 'image/gif') return 'gif'
  return 'png'
}

export function mimeForImagePath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'image/png'
}

export function imageArtifactFileName(bytes: Uint8Array, mime: string): string {
  const digest = createHash('sha256').update(bytes).digest().subarray(0, HASH_BYTES)
  return `${encodeBase32(digest)}.${imageExtensionForMime(mime)}`
}

export function resolveImageArtifactPath(cwd: string, fileName: string): string {
  const imageDir = path.resolve(cwd, IMAGE_DIRECTORY_NAME)
  const filePath = path.resolve(imageDir, fileName)
  const relative = path.relative(imageDir, filePath)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('image path must stay inside .images')
  }
  return filePath
}

export function resolveWorkspaceFilePath(cwd: string, raw: string): string {
  const root = path.resolve(cwd)
  const filePath = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw)
  const relative = path.relative(root, filePath)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('path must stay inside the workspace')
  }
  return filePath
}

export function splitImagePaths(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

export async function loadWorkspaceImage(cwd: string, rawPath: string): Promise<ImageBytes> {
  const filePath = resolveWorkspaceFilePath(cwd, rawPath)
  const bytes = new Uint8Array(await readFile(filePath))
  return {
    bytes,
    mime: mimeForImagePath(filePath),
    name: path.basename(filePath),
  }
}
