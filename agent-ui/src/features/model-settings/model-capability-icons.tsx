import { EyeIcon, ImagePlusIcon, PencilIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { cn } from "@/lib/utils"

import {
  cachedModelCapability,
  type ModelCapabilityCatalog,
} from "./model-profile-api"

const ICONS = [
  {
    capability: "image_understanding",
    Icon: EyeIcon,
    labelKey: "settings.models.imageUnderstanding",
  },
  {
    capability: "image_generation",
    Icon: ImagePlusIcon,
    labelKey: "settings.models.imageGeneration",
  },
  {
    capability: "image_edit",
    Icon: PencilIcon,
    labelKey: "settings.models.imageEdit",
  },
] as const

export function ModelCapabilityIcons({
  catalog,
  modelId,
  className,
}: {
  catalog?: ModelCapabilityCatalog
  modelId: string
  className?: string
}) {
  const { t } = useTranslation()
  const supported = ICONS.filter(
    (item) => cachedModelCapability(catalog, modelId, item.capability) === true
  )
  if (supported.length === 0) {
    return null
  }

  return (
    <span
      className={cn(
        "ml-auto inline-flex shrink-0 items-center gap-0.5 text-muted-foreground",
        className
      )}
    >
      {supported.map((item) => (
        <item.Icon
          key={item.capability}
          className="size-3.5"
          aria-label={t(item.labelKey)}
        />
      ))}
    </span>
  )
}
