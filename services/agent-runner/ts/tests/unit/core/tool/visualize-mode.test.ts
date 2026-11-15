import { describe, expect, it } from 'vitest'

import { isRenderUiToolName } from '../../../../src/core/event/tool-names.js'
import { productTools } from '../../../../src/core/tool/product-tools.js'
import { toolsForVisualizeMode, VISUALIZE_MODE_REMINDER, withVisualizeInstructions } from '../../../../src/core/tool/visualize-mode.js'

describe('visualize mode tools', () => {
  it('enables render_ui in visualize mode and hides the JSX tool', () => {
    const off = toolsForVisualizeMode(productTools, false).map((tool) => tool.name)
    const on = toolsForVisualizeMode(productTools, true).map((tool) => tool.name)
    expect(off).toContain('visualize')
    expect(off).not.toContain('render_ui')
    expect(on).not.toContain('visualize')
    expect(on).toEqual(expect.arrayContaining(['render_ui', 'canvas']))
    expect(productTools.map((tool) => tool.name)).not.toEqual(expect.arrayContaining(['static_visualize', 'interactive_visualize']))
    expect(isRenderUiToolName('mcp__agentWorkshop__render_ui')).toBe(true)
    expect(isRenderUiToolName('interactive_visualize')).toBe(false)
  })

  it('appends one complete reminder and preserves the structured action contract', () => {
    const instructions = withVisualizeInstructions('Stay brief.', true)
    expect(instructions.startsWith('Stay brief.')).toBe(true)
    expect(instructions).toContain(VISUALIZE_MODE_REMINDER)
    expect(instructions).toContain('action.context')
    expect(instructions).toContain('</system-reminder>')
    expect(withVisualizeInstructions(instructions, true)).toBe(instructions)
    expect(withVisualizeInstructions(instructions, false)).toBe('Stay brief.')
  })
})
