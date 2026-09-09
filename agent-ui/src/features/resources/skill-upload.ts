export const SKILL_ARCHIVE_ACCEPT = ".zip,.skill,.tar,.tar.gz,.tgz"
export const MAX_SKILL_ARCHIVE_BYTES = 3 * 1024 * 1024

export function validateSkillArchive(file: { name: string; size: number }): "resources.archiveType" | "resources.archiveSize" | undefined {
  if (!/\.(zip|skill|tar|tar\.gz|tgz)$/iu.test(file.name)) return "resources.archiveType"
  if (file.size > MAX_SKILL_ARCHIVE_BYTES) return "resources.archiveSize"
  return undefined
}
