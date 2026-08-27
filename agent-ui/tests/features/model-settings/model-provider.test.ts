import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { displayModelName } from "../../../src/features/model-settings/model-provider.ts"

describe("displayModelName", () => {
  it("returns the last segment after splitting on /", () => {
    assert.equal(displayModelName("openai/gpt-4o"), "gpt-4o")
    assert.equal(
      displayModelName("qwen/qwen3.5-plus"),
      "qwen3.5-plus"
    )
    assert.equal(
      displayModelName("meta-llama/llama-3.1-70b-instruct"),
      "llama-3.1-70b-instruct"
    )
  })

  it("keeps names that have no slash", () => {
    assert.equal(displayModelName("claude-sonnet-4-5"), "claude-sonnet-4-5")
  })

  it("uses the last segment of nested paths", () => {
    assert.equal(displayModelName("org/team/model-id"), "model-id")
  })
})
