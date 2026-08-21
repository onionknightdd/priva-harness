const EDITED_FILE_HASH_LENGTH = 7
const EDITED_FILE_HASH_ENTROPY_BYTES = 4

export function createEditedHtmlFileName(
  originalName: string,
  now: Date = new Date(),
  entropy: Uint8Array = randomEntropy(EDITED_FILE_HASH_ENTROPY_BYTES)
) {
  const baseName = fileBaseName(originalName)
  const { extension, stem } = splitFileName(baseName)
  const date = formatUtcDate(now)
  const hash = toHex(entropy).slice(0, EDITED_FILE_HASH_LENGTH)

  if (hash.length < EDITED_FILE_HASH_LENGTH) {
    throw new Error(
      `Edited HTML file names require ${EDITED_FILE_HASH_ENTROPY_BYTES} bytes of entropy`
    )
  }

  const suffix = `_${date}_${hash}`
  return extension ? `${stem}${suffix}.${extension}` : `${stem}${suffix}`
}

function fileBaseName(fileName: string) {
  const baseName = fileName.split(/[/\\]/).pop()?.trim() ?? ""
  return baseName || "untitled"
}

function splitFileName(fileName: string) {
  const separatorIndex = fileName.lastIndexOf(".")

  if (separatorIndex <= 0) {
    return { extension: "", stem: fileName }
  }

  return {
    extension: fileName.slice(separatorIndex + 1),
    stem: fileName.slice(0, separatorIndex),
  }
}

function formatUtcDate(now: Date) {
  const year = String(now.getUTCFullYear()).padStart(4, "0")
  const month = String(now.getUTCMonth() + 1).padStart(2, "0")
  const day = String(now.getUTCDate()).padStart(2, "0")
  return `${year}${month}${day}`
}

function randomEntropy(byteLength: number) {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return bytes
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  )
}
