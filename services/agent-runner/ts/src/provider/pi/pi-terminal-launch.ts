import { randomBytes, randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProviderRunSpec, SessionTarget } from '../../core/contract/agent-provider.js'
import type { TerminalLaunchContext, TerminalLaunchSpec } from '../../core/contract/terminal-service.js'
import { PI_TERMINAL_FILES, type PiTerminalLaunchConfig } from './pi-terminal-protocol.js'

export async function piTerminalLaunch(agentDir: string, target: SessionTarget, spec: ProviderRunSpec, context: TerminalLaunchContext): Promise<TerminalLaunchSpec> {
  const config: PiTerminalLaunchConfig = { agentDir, target, spec, scratchDir: context.scratchDir,
    instanceId: randomUUID(), token: randomBytes(32).toString('hex'), theme: context.colorScheme ?? 'dark' }
  // A fresh pane must not adopt a previous host's ready/session snapshots.
  for (const name of Object.values(PI_TERMINAL_FILES)) {
    await rm(join(context.scratchDir, name), { force: true })
    await rm(join(context.scratchDir, `${name}.next`), { force: true })
  }
  const path = join(context.scratchDir, PI_TERMINAL_FILES.launch)
  await writeFile(path, JSON.stringify(config), { mode: 0o600 })
  await writeFile(join(context.scratchDir, PI_TERMINAL_FILES.spec), JSON.stringify(spec), { mode: 0o600 })
  await writeFile(join(context.scratchDir, PI_TERMINAL_FILES.events), '', { mode: 0o600 })
  const source = import.meta.url.endsWith('.ts')
  return { command: process.execPath,
    args: [...(source ? ['--import', import.meta.resolve('tsx')] : []), fileURLToPath(new URL(source ? './pi-terminal-host.ts' : './pi-terminal-host.js', import.meta.url)), path],
    cwd: spec.cwd, env: { PI_CODING_AGENT_DIR: agentDir, PI_SKIP_VERSION_CHECK: '1' }, cols: context.cols, rows: context.rows }
}
