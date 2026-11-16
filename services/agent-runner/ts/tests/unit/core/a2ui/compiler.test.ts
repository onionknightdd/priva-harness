import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { compileA2uiSource } from '../../../../src/core/a2ui/compiler.js'
import { salesDashboardSource } from '../../../fixtures/a2ui/sales-dashboard.source.js'
import { formActionSource } from '../../../fixtures/a2ui/form-action.source.js'
import { allChartsSource } from '../../../fixtures/a2ui/all-charts.source.js'

describe('A2UI compiler', () => {
  it.each([
    ['form-action', formActionSource], ['all-charts', allChartsSource],
  ])('keeps the real compiled %s browser fixture current', (name, source) => {
    const fixture: unknown = JSON.parse(readFileSync(
      new URL(`../../../../../../../agent-ui/tests/fixtures/a2ui/${name}.json`, import.meta.url), 'utf8',
    ))
    expect(compileA2uiSource(source)).toEqual(fixture)
  })

  it('compiles the sales dashboard to the canonical messages used by the browser fixture', () => {
    const output = compileA2uiSource(salesDashboardSource)
    const fixture: unknown = JSON.parse(readFileSync(
      new URL('../../../../../../../agent-ui/tests/fixtures/a2ui/sales-dashboard.json', import.meta.url), 'utf8',
    ))
    expect(output).toEqual(fixture)
    expect(output).toMatchObject({ format: 'a2ui', version: '1.0' })
    const message = output.messages[0]
    if (message === undefined || !('createSurface' in message)) throw new Error('Expected createSurface')
    expect(message.version).toBe('v1.0')
    expect(message.createSurface).toMatchObject({ surfaceId: 'main', catalogId: 'https://priva.app/a2ui/catalog/v1' })
    const components: Record<string, unknown>[] | undefined = message.createSurface.components
    expect(components?.find((component) => component['id'] === 'root')).toMatchObject({ component: 'Column' })
    expect(components?.find((component) => component['id'] === 'regional')).toMatchObject({
      component: 'BarChart', labels: ['North America', 'Europe', 'Asia Pacific', 'Latin America'],
    })
    expect(components?.find((component) => component['id'] === 'explore')).toMatchObject({
      component: 'Button', action: { event: {
        name: 'explore_region', context: { region: 'North America', quarter: 'Q3' }, userMessage: 'Explore North America',
      } },
    })
  })

  it('preserves initialized data bindings and structured event context', () => {
    const output = compileA2uiSource([
      '$/region = "Europe"',
      'root = Column(children=[field, button])',
      'field = TextField(label="Region", value=$/region)',
      'button = Button(label="Explore", action={event:{name:"explore",context:{region:{"@path":"/region"}},userMessage:"Explore this region"}})',
    ].join('\n'))
    const message = output.messages[0]
    if (message === undefined || !('createSurface' in message)) throw new Error('Expected createSurface')
    expect(message.createSurface.dataModel).toEqual({ region: 'Europe' })
    const components: Record<string, unknown>[] | undefined = message.createSurface.components
    expect(components?.find((component) => component['id'] === 'field'))
      .toMatchObject({ value: { '@path': '/region' } })
    expect(components?.find((component) => component['id'] === 'button'))
      .toMatchObject({ action: { event: { name: 'explore', context: { region: { '@path': '/region' } }, userMessage: 'Explore this region' } } })
  })

  it('rejects the named-surface attempt and accepts the same table on the host surface', () => {
    const table = 'Table(columns=["Service", "State"], rows=[["Example MCP", "Available"]])'
    const source = [
      'surface("mcp_status")',
      'title = Text("MCP status")',
      'desc = Text("Available services")',
      `tbl = ${table}`,
      'root = Column([title, desc, tbl])',
    ].join('\n')
    expect(() => compileA2uiSource(source)).toThrow('Use the default main surface; do not target another surface')
    expect(JSON.stringify(compileA2uiSource(`root = ${table}`))).not.toContain('mcp_status')
  })

  it('keeps literal path and component metadata in action context as user data', () => {
    const output = compileA2uiSource('root = Button(label="Open", action={event:{name:"open_report",context:{componentId:"report",path:"/report"},userMessage:"Open report"}})')
    expect(JSON.stringify(output)).toContain('"context":{"componentId":"report","path":"/report"}')
  })

  it.each([
    ['', /source is required/],
    ['root = UnknownComponent()', /UnknownComponent/],
    ['root = Column(children=[missing])', /missing/],
    ['root = Column(children=[root])', /cycle|recurs|root/i],
    ['root = Heading(text="Hello", unsupported="value")', /unsupported/],
    ['root = Grid(children=[], columns=9)', /columns|9|maximum/],
    ['root = Button(label="Continue")', /action/],
    ['root = Button(label="Continue", action="execute script")', /action/],
    ['root = Button(label="Continue", action=Event("continue"))', /readable userMessage/],
    ['root = Heading(text="Unclosed)', /syntax|parse|token|unterminated/i],
    ['surface("another")\nroot = Heading(text="Another")', /main surface/],
    ['root = BarChart(title="Sales", labels=["A", "B"], series=[{name:"Revenue", values:[1]}])', /exactly 2 values/],
    ['root = DonutChart(title="Share", labels=["A", "B"], values=[1])', /one non-negative value per label/],
    ['root = DonutChart(title="Share", labels=["A"], values=[0])', /total greater than zero/],
    ['root = Table(columns=["A", "B"], rows=[[1]])', /exactly 2 cells/],
    ['root = TextField(label="Title", value=$/missing)', /uninitialized/],
    ['$/title = 12\nroot = TextField(label="Title", value=$/title)', /initialized string/],
    ['root = TextField(label="Title", value="fixed")', /initialized string/],
    ['root = Heading(text=$/missing)', /uninitialized/],
    ['$/title = {bad:"object"}\nroot = Heading(text=$/title)', /initialized string/],
    ['$/title = 1\nroot = Stat(label="Sales", value=$/title)', /initialized string/],
    ['$/title = "Ready"\nroot = Heading(text=$title)', /relative binding/],
    ['$/items = [1]\nroot = Column(children=_template($/items,item))\nitem = Text(text="Item")', /dynamic list template/],
    ['$/region = "Unknown"\nroot = Select(label="Region", value=$/region, options=[{label:"Europe",value:"Europe"}])', /match one of the option values/],
  ])('rejects invalid source %s with an actionable error', (source, error) => {
    expect(() => compileA2uiSource(source)).toThrow(error)
  })

  it('does not leak data or failed source into later calls', () => {
    compileA2uiSource('$/secret = "first call"\nroot = Heading(text=$/secret)')
    expect(() => compileA2uiSource('root = Column(children=[missing])')).toThrow()
    const next = compileA2uiSource('root = Heading(text="Fresh")')
    expect(JSON.stringify(next)).not.toContain('secret')
    expect(JSON.stringify(next)).not.toContain('missing')
    expect(next.messages).toHaveLength(1)
  })

  it('does not compile when execution has been cancelled', () => {
    const controller = new AbortController()
    controller.abort()
    expect(() => compileA2uiSource(salesDashboardSource, controller.signal)).toThrow()
  })

  it('limits source and component counts before publishing', () => {
    expect(() => compileA2uiSource(' '.repeat(64_001))).toThrow('exceeds 64000 characters')
    const children = Array.from({ length: 200 }, (_, index) => `child${index}`)
    const source = [
      `root = Column(children=[${children.join(',')}])`,
      ...children.map((id) => `${id} = Text(text="Item")`),
    ].join('\n')
    expect(() => compileA2uiSource(source)).toThrow('at most 200 components')
  })

  it('bounds expansion of reused subtrees even when the component graph is small', () => {
    const source = [
      'root = Column(children=[branch,branch,branch,branch,branch,branch,branch,branch,branch,branch])',
      'branch = Column(children=[twig,twig,twig,twig,twig,twig,twig,twig,twig,twig])',
      'twig = Column(children=[leaf,leaf,leaf,leaf,leaf,leaf,leaf,leaf,leaf,leaf])',
      'leaf = Text(text="Repeated")',
    ].join('\n')
    expect(() => compileA2uiSource(source)).toThrow('1000 rendered nodes')
  })
})
