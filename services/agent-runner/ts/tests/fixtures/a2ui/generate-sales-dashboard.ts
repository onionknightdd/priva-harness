import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { compileA2uiSource } from '../../../src/core/tool/a2ui-render.js'
import { salesDashboardSource } from './sales-dashboard.source.js'
import { formActionSource } from './form-action.source.js'
import { allChartsSource } from './all-charts.source.js'
import { rootTableSource } from './root-table.source.js'

for (const [name, source] of Object.entries({ 'sales-dashboard': salesDashboardSource, 'form-action': formActionSource, 'all-charts': allChartsSource, 'root-table': rootTableSource })) {
  const target = fileURLToPath(new URL(`../../../../../../agent-ui/tests/fixtures/a2ui/${name}.json`, import.meta.url))
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify(compileA2uiSource(source), null, 2)}\n`)
}
