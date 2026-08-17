import {
  file as defaultFileIconId,
  fileExtensions,
  fileNames,
  iconDefinitions,
  light,
} from "material-icon-theme/dist/material-icons.json"
import { useTheme } from "next-themes"

import { cn } from "@/lib/utils"

type IconAssociations = Record<string, string>
type IconDefinition = { iconPath: string }

const definitions = iconDefinitions as Record<string, IconDefinition>
const baseFileNameIcons = normalizeAssociations(fileNames)
const baseFileExtensionIcons = normalizeAssociations(fileExtensions)
const lightFileNameIcons = normalizeAssociations(light.fileNames)
const lightFileExtensionIcons = normalizeAssociations(light.fileExtensions)
const materialIconAssetDirectory = import.meta.env.DEV
  ? "node_modules/material-icon-theme/icons"
  : "material-icon-theme"

function normalizeAssociations(associations: IconAssociations) {
  return new Map(
    Object.entries(associations).map(([association, iconId]) => [
      normalizeFilePath(association),
      iconId,
    ])
  )
}

function normalizeFilePath(path: string) {
  return path.replaceAll("\\", "/").toLowerCase()
}

function getFileNameCandidates(name: string, path?: string) {
  const normalizedName = normalizeFilePath(name)
  const pathSegments = normalizeFilePath(path ?? name)
    .split("/")
    .filter(Boolean)
  const candidates = pathSegments.map((_, index) =>
    pathSegments.slice(index).join("/")
  )

  if (!candidates.includes(normalizedName)) {
    candidates.push(normalizedName)
  }

  return candidates
}

function getFileExtensionCandidates(name: string) {
  const normalizedName = normalizeFilePath(name)
  const candidates = new Set<string>()

  for (let index = 0; index < normalizedName.length; index += 1) {
    if (normalizedName[index] !== ".") {
      continue
    }

    candidates.add(normalizedName.slice(index))
    candidates.add(normalizedName.slice(index + 1))
  }

  return [...candidates].sort(
    (firstCandidate, secondCandidate) =>
      secondCandidate.length - firstCandidate.length
  )
}

function findIconAssociation(
  candidates: string[],
  baseAssociations: Map<string, string>,
  lightAssociations: Map<string, string>,
  preferLightIcon: boolean
) {
  for (const candidate of candidates) {
    const iconId = preferLightIcon
      ? lightAssociations.get(candidate) ?? baseAssociations.get(candidate)
      : baseAssociations.get(candidate)

    if (iconId) {
      return iconId
    }
  }

  return null
}

function getMaterialIconUrl(iconId: string) {
  const iconPath = definitions[iconId]?.iconPath
  const iconFileName = iconPath?.split("/").at(-1) ?? "file.svg"

  return `${import.meta.env.BASE_URL}${materialIconAssetDirectory}/${encodeURIComponent(iconFileName)}`
}

function getMaterialFileIcon(
  name: string,
  path: string | undefined,
  preferLightIcon: boolean
) {
  const fileNameIcon = findIconAssociation(
    getFileNameCandidates(name, path),
    baseFileNameIcons,
    lightFileNameIcons,
    preferLightIcon
  )

  if (fileNameIcon) {
    return getMaterialIconUrl(fileNameIcon)
  }

  const fileExtensionIcon = findIconAssociation(
    getFileExtensionCandidates(name),
    baseFileExtensionIcons,
    lightFileExtensionIcons,
    preferLightIcon
  )

  return getMaterialIconUrl(fileExtensionIcon ?? defaultFileIconId)
}

export function FileTypeIcon({
  name,
  path,
  className,
}: {
  name: string
  path?: string
  className?: string
}) {
  const { resolvedTheme } = useTheme()

  return (
    <img
      src={getMaterialFileIcon(name, path, resolvedTheme === "light")}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn("size-4 shrink-0", className)}
    />
  )
}
