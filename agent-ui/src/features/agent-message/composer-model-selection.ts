export type ComposerSessionModel = "profile-default" | "last-used"

export type ComposerProfile = {
  id: string
  label: string
  defaultModel: string | null
  imageUnderstandingModel: string | null
  imageGenerationModel: string | null
  imageEditModel: string | null
  modelCapabilities?: {
    imageUnderstanding: readonly string[]
    imageGeneration: readonly string[]
    imageEdit: readonly string[]
  }
}

export type ComposerModelSelection = {
  profileId: string
  profileLabel: string
  modelId: string
}

export function knownProfileModelIds(profile: ComposerProfile): string[] {
  const modelIds = new Set<string>()
  const add = (value: string | null | undefined) => {
    const modelId = value?.trim()
    if (modelId) {
      modelIds.add(modelId)
    }
  }

  add(profile.defaultModel)
  add(profile.imageUnderstandingModel)
  add(profile.imageGenerationModel)
  add(profile.imageEditModel)

  const catalog = profile.modelCapabilities
  if (catalog) {
    for (const modelId of catalog.imageUnderstanding) {
      add(modelId)
    }
    for (const modelId of catalog.imageGeneration) {
      add(modelId)
    }
    for (const modelId of catalog.imageEdit) {
      add(modelId)
    }
  }

  return [...modelIds]
}

export function selectionFromProfile(
  profile: ComposerProfile | undefined
): ComposerModelSelection | null {
  if (!profile) {
    return null
  }

  return {
    profileId: profile.id,
    profileLabel: profile.label,
    modelId:
      profile.defaultModel?.trim() ||
      knownProfileModelIds(profile)[0] ||
      "",
  }
}

export function selectionFromLastUsed(
  profiles: readonly ComposerProfile[],
  lastModelReference: string | null
): ComposerModelSelection | null {
  const parsed = parseModelReference(lastModelReference)
  if (!parsed) {
    return null
  }

  const profile = profiles.find((item) => item.id === parsed.profileId)
  if (!profile) {
    return null
  }

  return {
    profileId: profile.id,
    profileLabel: profile.label,
    modelId: parsed.modelId,
  }
}

export function resolveComposerSelection(input: {
  sessionModel: ComposerSessionModel
  profiles: readonly ComposerProfile[]
  defaultProfileId: string | null
  lastModelReference: string | null
  current: ComposerModelSelection | null
}): ComposerModelSelection | null {
  const defaultProfile =
    input.profiles.find((profile) => profile.id === input.defaultProfileId) ??
    input.profiles[0]

  if (input.current) {
    const selectedProfile = input.profiles.find(
      (profile) => profile.id === input.current?.profileId
    )
    if (selectedProfile) {
      return keepSelection(input.current, {
        profileId: selectedProfile.id,
        profileLabel: selectedProfile.label,
        modelId:
          input.current.modelId.trim() ||
          selectedProfile.defaultModel?.trim() ||
          knownProfileModelIds(selectedProfile)[0] ||
          "",
      })
    }
  }

  if (input.sessionModel === "last-used") {
    return (
      selectionFromLastUsed(input.profiles, input.lastModelReference) ??
      selectionFromProfile(defaultProfile)
    )
  }

  return selectionFromProfile(defaultProfile)
}

function parseModelReference(
  value: string | null | undefined
): { profileId: string; modelId: string } | null {
  const reference = value?.trim() ?? ""
  const separator = reference.indexOf(":")
  if (separator <= 0 || separator >= reference.length - 1) {
    return null
  }

  const profileId = reference.slice(0, separator).trim()
  const modelId = reference.slice(separator + 1).trim()
  if (!profileId || !modelId) {
    return null
  }

  return { profileId, modelId }
}

function keepSelection(
  current: ComposerModelSelection,
  next: ComposerModelSelection
): ComposerModelSelection {
  if (
    current.profileId === next.profileId &&
    current.profileLabel === next.profileLabel &&
    current.modelId === next.modelId
  ) {
    return current
  }

  return next
}
