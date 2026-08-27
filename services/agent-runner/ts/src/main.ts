import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

import { AgentHarness } from './harness/agent-harness.js'
import { AgentProfileService } from './harness/config/agent-profile-service.js'
import { ConfigDistributor } from './harness/config/config-distributor.js'
import { ModelProfileService } from './harness/config/model-profile-service.js'
import { LiveRunRegistry } from './harness/run/live-run-registry.js'
import { SessionService } from './harness/session/session-service.js'
import { JsonSessionMetadataStore } from './infrastructure/session/json-session-metadata-store.js'
import { NodeUserFileSystem } from './infrastructure/filesystem/node-user-file-system.js'
import { CompatibleModelEndpointClient } from './infrastructure/model-profile/compatible-model-endpoint-client.js'
import { JsonModelProfileStore } from './infrastructure/model-profile/json-model-profile-store.js'
import { JsonRuntimeSettingsStore } from './infrastructure/settings/json-runtime-settings-store.js'
import { claudeGlobalDir } from './provider/claude/claude-paths.js'
import { ClaudeConfigAdapter } from './provider/claude/config-adapter/claude-config-adapter.js'
import { ClaudeProvider } from './provider/claude/claude-provider.js'
import { ClaudeSessionStore } from './provider/claude/session/claude-session-store.js'
import { piGlobalDir, piSessionsRoot } from './provider/pi/pi-paths.js'
import { PiConfigAdapter } from './provider/pi/config-adapter/pi-config-adapter.js'
import { PiProvider } from './provider/pi/pi-provider.js'
import { PiSessionStore } from './provider/pi/pi-session-store.js'
import { CodingAgentSessionFactory } from './provider/pi/pi-session-factory.js'
import { productTools } from './core/tool/product-tools.js'
import {
  createRuntimeConfig,
  resolveRuntimeHome,
  RUNTIME_HOME_ENV,
} from './runtime-config.js'
import { buildHttpServer } from './transport/http/server.js'

const DEFAULT_PORT = 8000

export async function startServer(): Promise<void> {
  const runtimeConfig = createRuntimeConfig(
    resolveRuntimeHome(process.env[RUNTIME_HOME_ENV]),
  )
  const claudeConfigDir = claudeGlobalDir(runtimeConfig.harnessHome)
  const piConfigDir = piGlobalDir(runtimeConfig.harnessHome)
  process.env['CLAUDE_CONFIG_DIR'] = claudeConfigDir
  process.env['PI_CODING_AGENT_DIR'] = piConfigDir
  const initialDirectory = process.env['WORKSPACE_DIR'] ?? homedir()
  await Promise.all([
    mkdir(initialDirectory, { recursive: true }),
    mkdir(runtimeConfig.runtimeHome, { recursive: true, mode: 0o700 }),
    mkdir(runtimeConfig.harnessHome, { recursive: true, mode: 0o700 }),
    mkdir(claudeConfigDir, { recursive: true, mode: 0o700 }),
    mkdir(piConfigDir, { recursive: true, mode: 0o700 }),
    mkdir(piSessionsRoot(piConfigDir), { recursive: true, mode: 0o700 }),
  ])
  const fileSystem = new NodeUserFileSystem({
    initialDirectory,
  })
  const runtimeSettings = new JsonRuntimeSettingsStore({
    filePath: runtimeConfig.settingsFilePath,
  })
  const modelProfileService = new ModelProfileService(
    new JsonModelProfileStore({
      settings: runtimeSettings,
      runtimeHome: runtimeConfig.runtimeHome,
    }),
    new CompatibleModelEndpointClient(),
  )
  const agentProfileService = new AgentProfileService(runtimeSettings)
  const liveRuns = new LiveRunRegistry()
  const sessionMetadata = new JsonSessionMetadataStore({
    runtimeHome: runtimeConfig.runtimeHome,
  })
  const claudeProvider = new ClaudeProvider({
    globalConfigDir: claudeConfigDir,
    sessions: new ClaudeSessionStore({ globalConfigDir: claudeConfigDir }),
    tools: productTools,
  })
  const piProvider = new PiProvider(
    new CodingAgentSessionFactory(piConfigDir, productTools),
    new PiSessionStore({ agentDir: piConfigDir }),
  )
  const providers = {
    claude: claudeProvider,
    pi: piProvider,
  }
  const sessionService = new SessionService({
    providers,
    metadata: sessionMetadata,
    liveRuns,
    modelProfiles: modelProfileService,
    activeCwd: initialDirectory,
  })
  const agentHarness = new AgentHarness({
    providers,
    cwd: initialDirectory,
    liveRuns,
    sessions: sessionService,
  })
  const configDistributor = new ConfigDistributor([
    new ClaudeConfigAdapter(),
    new PiConfigAdapter(),
  ])
  const server = buildHttpServer({
    userFileSystem: fileSystem,
    modelProfileService,
    agentProfileService,
    agentHarness,
    sessionService,
    configDistributor,
    logger: true,
  })
  const port = parsePort(process.env['PORT'])
  const host = process.env['HOST'] ?? '0.0.0.0'

  const close = async (): Promise<void> => {
    await server.close()
  }
  process.once('SIGINT', () => { void close() })
  process.once('SIGTERM', () => { void close() })

  await server.listen({ host, port })
}

function parsePort(rawPort: string | undefined): number {
  if (rawPort === undefined) return DEFAULT_PORT
  const port = Number(rawPort)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError(`Invalid PORT: ${rawPort}`)
  }
  return port
}

const entrypoint = process.argv[1]
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  startServer().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
