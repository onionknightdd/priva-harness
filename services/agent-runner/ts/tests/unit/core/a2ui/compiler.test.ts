import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { compileA2uiSource } from '../../../../src/core/a2ui/compiler.js'
import { salesDashboardSource } from '../../../fixtures/a2ui/sales-dashboard.source.js'
import { formActionSource } from '../../../fixtures/a2ui/form-action.source.js'
import { allChartsSource } from '../../../fixtures/a2ui/all-charts.source.js'
import { tabsSource } from '../../../fixtures/a2ui/tabs.source.js'
import { mediaSource } from '../../../fixtures/a2ui/media.source.js'
import { gallerySource } from '../../../fixtures/a2ui/gallery.source.js'

describe('A2UI compiler', () => {
  it.each([
    ['form-action', formActionSource], ['all-charts', allChartsSource],
    ['tabs', tabsSource], ['media', mediaSource], ['gallery', gallerySource],
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

  it('compiles tab children and their initialized form values on the same surface', () => {
    const output = compileA2uiSource(tabsSource)
    const message = output.messages[0]
    if (message === undefined || !('createSurface' in message)) throw new Error('Expected createSurface')
    expect(message.createSurface.dataModel).toEqual({ title: 'Q3 plan', region: 'Europe' })
    const components: Record<string, unknown>[] | undefined = message.createSurface.components
    expect(components?.find((component) => component['id'] === 'root')).toMatchObject({
      component: 'Tabs', tabs: [
        { title: 'Overview', child: 'overview' },
        { title: 'Regions', child: 'regions' },
        { title: 'Report', child: 'report' },
      ],
    })
    expect(components?.find((component) => component['id'] === 'submit')).toMatchObject({
      action: { event: { name: 'update_report', context: { title: { '@path': '/title' }, region: { '@path': '/region' } } } },
    })
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

  it('preserves image and icon bindings in the compiled media fixture', () => {
    const output = compileA2uiSource(mediaSource)
    const message = output.messages[0]
    if (message === undefined || !('createSurface' in message)) throw new Error('Expected createSurface')
    const components: Record<string, unknown>[] | undefined = message.createSurface.components
    expect(components?.find((component) => component['id'] === 'localImage')).toMatchObject({
      component: 'Image', url: 'sandbox:/a2ui-media-fixtures/landscape.svg',
      description: 'Illustrative landscape orientation image',
    })
    expect(components?.find((component) => component['id'] === 'remoteImage')).toMatchObject({
      component: 'Image', url: { '@path': '/image' }, description: { '@path': '/description' }, fit: 'cover',
    })
    expect(components?.find((component) => component['id'] === 'growth')).toMatchObject({
      component: 'Icon', name: 'trending-up', tone: 'positive', label: { '@path': '/status' },
    })
  })

  it.each([
    'https://images.example.com/photo?signature=a%2Fb%2B&width=600',
    'http://127.0.0.1:5188/a2ui-media-fixtures/portrait.svg',
    'sandbox:/workspace/image%20one.png',
    'sandbox:C:/workspace/image.png',
  ])('accepts an explicit image source %s', (url) => {
    expect(() => compileA2uiSource(`root = Image(url=${JSON.stringify(url)}, description="An image")`)).not.toThrow()
    expect(() => compileA2uiSource(`root = ImageGallery(images=[{url:${JSON.stringify(url)},description:"An image"}])`)).not.toThrow()
  })

  it.each([
    '', '/workspace/image.png', 'images/photo.png', '//images.example.com/photo.png',
    'file:///workspace/image.png', 'data:image/png;base64,AAAA', 'blob:https://example.com/image',
    'javascript:alert(1)', 'https://', 'https://[invalid', ' https://example.com/photo ',
    'https://example.com/\nphoto', 'sandbox:relative.png', 'sandbox://example.com/photo.png',
    'sandbox:%2F%2Fexample.com/photo.png', 'sandbox:/workspace/%not-encoded.png',
    'sandbox:/workspace/image%00.png',
  ])('rejects invalid literal and bound image source %s', (url) => {
    const literal = JSON.stringify(url)
    expect(() => compileA2uiSource(`root = Image(url=${literal}, description="An image")`)).toThrow(/Image root: url must/)
    expect(() => compileA2uiSource(`$/image = ${literal}\nroot = Image(url=$/image, description="An image")`)).toThrow(/Image root: url must/)
    expect(() => compileA2uiSource(`root = ImageGallery(images=[{url:${literal},description:"An image"}])`)).toThrow(/ImageGallery root\.images\[0\]: url must/)
    expect(() => compileA2uiSource(`$/image = ${literal}\nroot = ImageGallery(images=[{url:$/image,description:"An image"}])`)).toThrow(/ImageGallery root\.images\[0\]: url must/)
  })

  it('preserves nested image gallery bindings and image order in the canonical surface', () => {
    const output = compileA2uiSource(gallerySource)
    const message = output.messages[0]
    if (message === undefined || !('createSurface' in message)) throw new Error('Expected createSurface')
    const components: Record<string, unknown>[] | undefined = message.createSurface.components
    expect(components?.find((component) => component['id'] === 'gallery')).toMatchObject({
      component: 'ImageGallery', title: { '@path': '/title' }, images: [
        { url: 'sandbox:/a2ui-media-fixtures/landscape.svg', description: 'Illustrative landscape orientation image', title: 'Landscape' },
        { url: { '@path': '/image' }, description: { '@path': '/description' }, title: { '@path': '/caption' } },
        { url: 'http://127.0.0.1:5188/a2ui-media-fixtures/landscape.svg', title: 'Landscape detail' },
      ],
    })
    expect(message.createSurface.dataModel).toMatchObject({
      title: 'Illustrative image gallery', image: 'http://127.0.0.1:5188/a2ui-media-fixtures/portrait.svg',
      description: 'Illustrative portrait orientation image', caption: 'Portrait',
    })
  })

  it('accepts the gallery image limit', () => {
    const images = Array(12).fill('{url:"sandbox:/workspace/image.png",description:"Known image"}').join(',')
    expect(() => compileA2uiSource(`root = ImageGallery(images=[${images}])`)).not.toThrow()
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
    ['root = Image(url="https://example.com/photo.png")', /description/],
    ['root = Image(url="https://example.com/photo.png", description="Photo", fit="fill")', /fit|enum/],
    ['$/image = 42\nroot = Image(url=$/image, description="Photo")', /initialized string/],
    ['root = Image(url="https://example.com/photo.png", description=$/missing)', /uninitialized/],
    ['root = ImageGallery(images=[])', /images|minimum/],
    [`root = ImageGallery(images=[${Array(13).fill('{url:"sandbox:/workspace/image.png",description:"Known image"}').join(',')}])`, /images|maximum|12/],
    ['root = ImageGallery(images=[{url:"sandbox:/workspace/image.png"}])', /description/],
    ['root = ImageGallery(images=[{url:"sandbox:/workspace/image.png",description:"Image",fit:"cover"}])', /fit|additional/],
    ['root = ImageGallery(images=[{url:"sandbox:/workspace/image.png",description:"Image"}],autoplay=true)', /autoplay|additional/],
    ['$/images = [{url:"sandbox:/workspace/image.png",description:"Image"}]\nroot = ImageGallery(images=$/images)', /static literal|dynamic data bindings/],
    ['root = ImageGallery(images=[{url:"sandbox:/workspace/image.png",description:"Image"},{url:"file:///workspace/other.png",description:"Other image"}])', /ImageGallery root\.images\[1\]: url must/],
    ['root = ImageGallery(images=[{url:$/missing,description:"Image"}])', /uninitialized/],
    ['$/image = 42\nroot = ImageGallery(images=[{url:$/image,description:"Image"}])', /images\[0\]\.url.*initialized string/],
    ['$/description = 42\nroot = ImageGallery(images=[{url:"sandbox:/workspace/image.png",description:$/description}])', /images\[0\]\.description.*initialized string/],
    ['$/title = {bad:"object"}\nroot = ImageGallery(images=[{url:"sandbox:/workspace/image.png",description:"Image",title:$/title}])', /images\[0\]\.title.*initialized string/],
    ['root = ImageGallery(images=[{url:"sandbox:/workspace/image.png",description:$missing}])', /relative binding/],
    ['root = Icon(name="made-up-icon")', /name|enum/],
    ['root = Icon(name="search", size="huge")', /size|enum/],
    ['root = Icon(name="search", tone="blue")', /tone|enum/],
    ['root = Icon(name="search", svgPath="M0 0")', /svgPath|additional/],
    ['$/label = 42\nroot = Icon(name="search", label=$/label)', /initialized string/],
    ['root = Grid(children=[], columns=9)', /columns|9|maximum/],
    ['root = Tabs(tabs=[])', /tabs|minimum/],
    ['root = Tabs(tabs=[{title:"Missing",child:missing}])', /missing/],
    ['root = Tabs(tabs=[{title:"Loop",child:root}])', /cycle|circular|self-reference/i],
    ['root = Tabs(tabs=[{title:"Loop",child:panel}])\npanel = Column(children=[root])', /cycle|circular/i],
    ['root = Tabs(tabs=[{title:"   ",child:panel}])\npanel = Text(text="Panel")', /title|pattern/],
    [`root = Tabs(tabs=[{title:"${'a'.repeat(81)}",child:panel}])\npanel = Text(text="Panel")`, /title|80/],
    ['root = Tabs(tabs=[{title:"Panel",child:panel,unknown:true}])\npanel = Text(text="Panel")', /unknown|additional/],
    ['$/title = "Panel"\nroot = Tabs(tabs=[{title:$/title,child:panel}])\npanel = Text(text="Panel")', /static literal|dynamic data bindings/],
    [`root = Tabs(tabs=[${Array.from({ length: 9 }, (_, index) => `{title:"Tab ${index + 1}",child:panel}`).join(',')}])\npanel = Text(text="Panel")`, /tabs|8|maximum/],
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

  it('counts tab child references when limiting repeated subtree expansion', () => {
    const source = [
      `root = Tabs(tabs=[${Array.from({ length: 8 }, (_, index) => `{title:"Tab ${index + 1}",child:branch}`).join(',')}])`,
      `branch = Column(children=[${Array(8).fill('twig').join(',')}])`,
      `twig = Column(children=[${Array(8).fill('bud').join(',')}])`,
      `bud = Column(children=[${Array(8).fill('leaf').join(',')}])`,
      'leaf = Text(text="Repeated")',
    ].join('\n')
    expect(() => compileA2uiSource(source)).toThrow('1000 rendered nodes')
  })
})
