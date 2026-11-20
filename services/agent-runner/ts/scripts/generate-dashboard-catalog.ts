import { writeFile } from 'node:fs/promises'
import { a2uiCatalogDefinition } from '../src/core/a2ui/catalog.generated.js'

const components = a2uiCatalogDefinition['components']
const document = [
  '# Component catalog',
  '',
  'Generated from the renderer catalog by scripts/generate-dashboard-catalog.ts. Do not edit the schema below by hand.',
  '',
  'Use named Express arguments matching these properties. Omit the protocol-only `component` field. `required` lists required arguments; other arguments are optional. Unknown properties are rejected.',
  '',
  '`DynamicString` means a literal string or an initialized absolute string binding such as `$/title`. `ChildList` must be an explicit list of component references. `Action` must use the explicit event map shown in interactions.md, including a readable userMessage. Input values must bind to initialized strings. Chart series lengths and table row widths must match their labels or columns.',
  '',
  'The host always creates the main surface: assign `root = Component(...)`; never emit `surface(...)`.',
  '',
  '```json',
  JSON.stringify(components, null, 2),
  '```',
  '',
].join('\n')
await writeFile(new URL('../src/resources/plugins/agent-dashboard/skills/agent-dashboard/resource/catalog.md', import.meta.url), document)
