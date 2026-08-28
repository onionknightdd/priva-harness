import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  cachedModelCapability,
  catalogModelIds,
  emptyModelCapabilityCatalog,
  withProbedCapability,
} from "../../../src/features/model-settings/model-profile-api.ts"

describe("model capability catalog", () => {
  it("treats a listed model as supported and everything else as unknown", () => {
    const catalog = withProbedCapability(
      emptyModelCapabilityCatalog(),
      "image_generation",
      "gen-a",
      true
    )
    assert.equal(cachedModelCapability(catalog, "gen-a", "image_generation"), true)
    assert.equal(cachedModelCapability(catalog, "gen-a", "image_edit"), null)
    assert.equal(cachedModelCapability(catalog, "other", "image_generation"), null)
    assert.deepEqual(catalogModelIds(catalog), ["gen-a"])
  })

  it("ignores failed probes", () => {
    const catalog = withProbedCapability(
      emptyModelCapabilityCatalog(),
      "image_understanding",
      "vision-a",
      false
    )
    assert.deepEqual(catalog, emptyModelCapabilityCatalog())
  })
})
