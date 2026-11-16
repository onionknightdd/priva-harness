import { describe, expect, it } from 'vitest'

import { agentApiJsonSchema } from '../../../../src/core/agent-api/json-schema.js'

describe('agentApiJsonSchema', () => {
  // Regenerate with: npx vitest run tests/unit/core/agent-api/json-schema.test.ts -u
  it('matches the published schema file', async () => {
    await expect(`${JSON.stringify(agentApiJsonSchema(), null, 2)}\n`)
      .toMatchFileSnapshot('../../../../../../../docs/api/agent-api-v1.schema.json')
  })

  it('references shared definitions instead of inlining them', () => {
    const text = JSON.stringify(agentApiJsonSchema())
    expect(text).toContain('"$ref":"#/$defs/Run"')
    expect(text).toContain('"$ref":"#/$defs/Item"')
  })
})
