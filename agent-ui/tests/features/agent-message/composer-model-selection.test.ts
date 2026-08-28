import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  resolveComposerSelection,
  selectionFromLastUsed,
  selectionFromProfile,
  type ComposerProfile,
} from "../../../src/features/agent-message/composer-model-selection.ts"

function profile(
  id: string,
  label: string,
  defaultModel: string | null
): ComposerProfile {
  return {
    id,
    label,
    defaultModel,
    imageUnderstandingModel: null,
    imageGenerationModel: null,
    imageEditModel: null,
  }
}

describe("composer model selection", () => {
  const alpha = profile("model-20260828aaaaaaa", "Alpha", "alpha-default")
  const beta = profile("model-20260828bbbbbbb", "Beta", "beta-default")
  const profiles = [alpha, beta]

  it("starts from the default profile when nothing is selected", () => {
    const selection = resolveComposerSelection({
      sessionModel: "profile-default",
      profiles,
      defaultProfileId: alpha.id,
      lastModelReference: null,
      current: null,
    })

    assert.deepEqual(selection, {
      profileId: alpha.id,
      profileLabel: "Alpha",
      modelId: "alpha-default",
    })
  })

  it("keeps a user-selected profile when the catalog refreshes", () => {
    const current = {
      profileId: beta.id,
      profileLabel: "Beta",
      modelId: "beta-other",
    }
    const refreshedBeta = profile(beta.id, "Beta", "beta-other")

    const selection = resolveComposerSelection({
      sessionModel: "profile-default",
      profiles: [alpha, refreshedBeta],
      defaultProfileId: alpha.id,
      lastModelReference: `${beta.id}:beta-other`,
      current,
    })

    assert.deepEqual(selection, current)
  })

  it("does not snap back to the old default after a profile switch", () => {
    const selection = resolveComposerSelection({
      sessionModel: "profile-default",
      profiles,
      defaultProfileId: alpha.id,
      lastModelReference: `${beta.id}:beta-other`,
      current: {
        profileId: beta.id,
        profileLabel: "Beta",
        modelId: "beta-other",
      },
    })

    assert.equal(selection?.profileId, beta.id)
    assert.equal(selection?.modelId, "beta-other")
  })

  it("restores the last-used reference only before the user selects", () => {
    assert.deepEqual(
      selectionFromLastUsed(profiles, `${beta.id}:beta-other`),
      {
        profileId: beta.id,
        profileLabel: "Beta",
        modelId: "beta-other",
      }
    )

    const selection = resolveComposerSelection({
      sessionModel: "last-used",
      profiles,
      defaultProfileId: alpha.id,
      lastModelReference: `${beta.id}:beta-other`,
      current: null,
    })

    assert.equal(selection?.profileId, beta.id)
    assert.equal(selection?.modelId, "beta-other")
  })

  it("falls back to the default profile when the current profile is gone", () => {
    const selection = resolveComposerSelection({
      sessionModel: "profile-default",
      profiles: [alpha],
      defaultProfileId: alpha.id,
      lastModelReference: null,
      current: {
        profileId: beta.id,
        profileLabel: "Beta",
        modelId: "beta-other",
      },
    })

    assert.deepEqual(selection, selectionFromProfile(alpha))
  })
})
