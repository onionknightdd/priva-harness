import { describe, expect, it } from 'vitest'

import { isRenderUiToolName } from '../../../../src/core/event/tool-names.js'
import { interactiveVisualizeTool, staticVisualizeTool } from '../../../../src/core/tool/render-ui.js'
import { productTools } from '../../../../src/core/tool/product-tools.js'
import { toolsForVisualizeMode, VISUALIZE_MODE_REMINDER, withVisualizeInstructions } from '../../../../src/core/tool/visualize-mode.js'

const context = {
  cwd: '/work',
  session: { provider: 'claude' as const, id: 'sess-1' },
  signal: new AbortController().signal,
}

describe('visualize mode tools', () => {
  it('hides the component tools until the mode is on, then hides JSX visualize', () => {
    const off = toolsForVisualizeMode(productTools, false).map((tool) => tool.name)
    const on = toolsForVisualizeMode(productTools, true).map((tool) => tool.name)
    expect(off).toContain('visualize')
    expect(off).not.toContain('static_visualize')
    expect(on).not.toContain('visualize')
    expect(on).toEqual(expect.arrayContaining(['static_visualize', 'interactive_visualize', 'canvas']))
  })

  it('appends one closed system reminder', () => {
    const instructions = withVisualizeInstructions('Stay brief.', true)
    expect(instructions.startsWith('Stay brief.')).toBe(true)
    expect(instructions).toContain(VISUALIZE_MODE_REMINDER)
    expect(instructions).toContain('</system-reminder>')
    expect(withVisualizeInstructions(instructions, false)).toBe('Stay brief.')
  })

  it('accepts a static chart and an interactive button', async () => {
    const chart = [
      'root = Stack([title, chart])',
      'title = Text("Revenue", "large")',
      'labels = ["Jul", "Aug"]',
      'series = Series("Revenue", [380, 410])',
      'chart = BarChart(labels, [series])',
    ].join('\n')
    await expect(staticVisualizeTool.execute({ lang: chart }, context)).resolves.toMatchObject({ ok: true })

    const choice = [
      'root = Stack([title, action])',
      'title = Text("Raise the budget?", "body")',
      'action = Button("Use 350", @ToAssistant("Make it under $350 a night"))',
    ].join('\n')
    await expect(interactiveVisualizeTool.execute({ lang: choice }, context)).resolves.toMatchObject({ ok: true })
    expect(isRenderUiToolName('mcp__agentWorkshop__static_visualize')).toBe(true)
    expect(interactiveVisualizeTool.description).toContain('@ToAssistant')
    expect(staticVisualizeTool.description).toContain('interactive_visualize')
  })
})
