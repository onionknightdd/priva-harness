import assert from "node:assert/strict"
import { test } from "node:test"

import { interactiveVisualizeLibrary, staticVisualizeLibrary } from "../../../src/features/agent-message/render-ui/library.tsx"
import { interactiveVisualizeSpec } from "../../../../services/agent-runner/ts/src/core/tool/interactive-visualize.spec.ts"
import { staticVisualizeSpec } from "../../../../services/agent-runner/ts/src/core/tool/static-visualize.spec.ts"

test("committed specs match the frontend libraries", () => {
  const staticPrompt = staticVisualizeLibrary.toSpec()
  const interactivePrompt = interactiveVisualizeLibrary.toSpec()
  assert.deepEqual(staticVisualizeSpec.components, staticPrompt.components)
  assert.deepEqual(staticVisualizeSpec.schema, staticVisualizeLibrary.toJSONSchema())
  assert.deepEqual(interactiveVisualizeSpec.components, interactivePrompt.components)
  assert.equal(interactivePrompt.components["Button"]?.signature.includes("ActionExpression"), true)
  assert.deepEqual(interactiveVisualizeSpec.schema, interactiveVisualizeLibrary.toJSONSchema())
})
