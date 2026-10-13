import { appendFileSync, renameSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'
import { AgentSessionRuntime, InteractiveMode, ProjectTrustStore, SettingsManager, hasTrustRequiringProjectResources, type ExtensionUIContext, type CreateAgentSessionRuntimeFactory, type ExtensionFactory } from '@earendil-works/pi-coding-agent'
import type { AgentEvent } from '../../core/event/agent-event.js'
import { isRunResultEvent } from '../../core/event/agent-event.js'
import type { TerminalActivity, TerminalSessionState, TerminalStatus } from '../../core/contract/terminal-service.js'
import { mapPiContextUsage } from '../../core/resource/context-usage.js'
import { isContextWindow } from '../../core/resource/model-context.js'
import { asRecord } from '../../core/event/json-record.js'
import { loadWorkspaceImage } from '../../core/tool/image-artifact.js'
import { productTools } from '../../core/tool/product-tools.js'
import { CodingAgentSessionFactory, type SdkPiAgentSession } from './pi-session-factory.js'
import { createPiSessionManager } from './pi-session-open.js'
import { PiEventMapper, type PiSessionEvent } from './pi-event-mapper.js'
import { PI_BUILTIN_SLASH_COMMANDS } from './pi-builtin-slash-commands.js'
import { PI_TERMINAL_FILES, piTerminalCommandSchema, type PiTerminalCommand, type PiTerminalLaunchConfig, type PiTerminalState } from './pi-terminal-protocol.js'

/** One owner for the native session, terminal renderer and structured Chat commands. */
async function main(): Promise<void> {
  const path = process.argv[2]
  if (!path) throw new Error('Pi terminal host requires its private launch file')
  const config = JSON.parse(await readFile(path, 'utf8')) as PiTerminalLaunchConfig
  const factory = new CodingAgentSessionFactory(config.agentDir, productTools)
  let spec = config.spec
  let current: SdkPiAgentSession | undefined
  let unsubscribe: (() => void) | undefined
  let mapper: PiEventMapper | undefined
  let activeRunId: string | undefined
  let newSessionRunId: string | undefined
  let phase: TerminalSessionState['phase'] = 'idle'
  let promptText = ''
  let updatedAt = 0
  let eventOffset = 0
  let ready = false
  let commandPending = false
  let closed = false
  let startupComplete = false
  const controlEndpoint: { port?: number; shutdown?: () => Promise<void> } = {}
  let terminalUi: ExtensionUIContext | undefined

  const writeJson = (file: keyof typeof PI_TERMINAL_FILES, value: unknown) => {
    const destination = join(config.scratchDir, PI_TERMINAL_FILES[file])
    const temporary = `${destination}.next`
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 })
    renameSync(temporary, destination)
  }
  const setReady = (value: boolean) => {
    ready = value
    if (controlEndpoint.port !== undefined) writeJson('control', { port: controlEndpoint.port, token: config.token, instanceId: config.instanceId, ready })
  }
  const publish = (event: AgentEvent, sessionId = current?.sessionId) => {
    if (!sessionId) return
    const activity: TerminalActivity = { sessionId, instanceId: config.instanceId, cwd: current?.services.cwd ?? spec.cwd,
      ...(activeRunId ? { runId: activeRunId } : {}), event }
    const line = `${JSON.stringify(activity)}\n`
    appendFileSync(join(config.scratchDir, PI_TERMINAL_FILES.events), line, { mode: 0o600 })
    eventOffset += Buffer.byteLength(line)
  }
  const state = (event: TerminalSessionState['event'], source?: string) => {
    if (!current) return
    updatedAt = Math.max(Date.now(), updatedAt + 1)
    writeJson('state', { sessionId: current.sessionId, instanceId: config.instanceId, cwd: current.services.cwd,
      phase, event, updatedAt, eventOffset, ...(source ? { source } : {}), ...(promptText ? { prompt: promptText } : {}) } satisfies PiTerminalState)
  }
  const status = () => {
    if (!current) return
    writeJson('status', { instanceId: config.instanceId, sessionId: current.sessionId, model: current.native.model?.id ?? spec.model,
      cwd: current.services.cwd, context: mapPiContextUsage(current.getContextUsage()), updatedAt: Date.now(),
      ...(spec.profileId ? { profileId: spec.profileId } : {}), effort: current.native.thinkingLevel,
      effortLevels: current.native.getAvailableThinkingLevels() } satisfies TerminalStatus)
  }
  const begin = (text: string, id?: string, userMessage = true) => {
    if (!current || activeRunId) return
    activeRunId = id ?? randomUUID()
    promptText = text
    phase = 'running'
    mapper = new PiEventMapper({ sessionId: current.sessionId, model: current.native.model?.id ?? spec.model })
    publish({ type: 'run.started', model: current.native.model?.id ?? spec.model, driver: 'terminal',
      ...(userMessage ? { userMessage: { id: `${activeRunId}:user`, role: 'user' as const, content: text, createdAt: new Date().toISOString(), status: 'complete' as const } } : {}) })
    state('prompt')
  }
  const finish = (event: AgentEvent, expectedRunId = activeRunId) => {
    if (!activeRunId || activeRunId !== expectedRunId) return
    publish(event)
    activeRunId = undefined
    phase = 'idle'
    status()
    // Structured run outcomes carry their own error/usage; the state file is only a liveness snapshot.
    state('ready')
  }
  const receive = (event: PiSessionEvent) => {
    if (!current) return
    if (event.type === 'agent_start') begin('', undefined, false)
    if (event.type === 'permission.requested' || event.type === 'permission.resolved' || event.type === 'terminal.focus' || event.type === 'error') {
      publish(event as AgentEvent)
      return
    }
    mapper ??= new PiEventMapper({ sessionId: current.sessionId, model: current.modelId })
    for (const mapped of mapper.push(event)) {
      if (isRunResultEvent(mapped)) finish(mapped)
      else publish(mapped)
    }
    if (event.type === 'agent_settled' || event.type === 'message_end' || event.type === 'model_select') status()
  }
  const bridge: ExtensionFactory = (pi) => {
    pi.on('before_agent_start', (event) => { if (event.messageType === 'user') { promptText = event.prompt; begin(event.prompt) } })
    pi.on('session_start', (_event, ctx) => {
      // This first extension binds synchronously so later startup dialogs share Chat.
      terminalUi = current?.bindTerminalUI(ctx.ui)
      status()
    })
    pi.on('session_shutdown', async (event) => {
      setReady(false)
      if (event.reason === 'quit') await controlEndpoint.shutdown?.()
    })
    pi.on('resources_discover', () => {
      // Pi emits discovery after every extension's session_start has completed.
      if (startupComplete && !closed) { setReady(true); state('ready'); status() }
    })
    pi.on('model_select', (event) => {
      spec = { ...spec, model: event.model.id, ...(current ? { effort: current.native.thinkingLevel } : {}) }
      writeJson('spec', spec)
      status()
    })
    pi.on('thinking_level_select', (event) => {
      spec = { ...spec, effort: event.level }
      writeJson('spec', spec)
      status()
    })
    pi.on('session_info_changed', () => { status() })
  }
  const ensureProjectTrust = async (cwd: string): Promise<boolean> => {
    if (!hasTrustRequiringProjectResources(cwd)) return true
    const trust = new ProjectTrustStore(config.agentDir)
    const decision = trust.get(cwd)
    if (decision !== null) return decision
    const settings = SettingsManager.create(cwd, config.agentDir, { projectTrusted: false })
    if (settings.getDefaultProjectTrust() !== 'ask') return settings.getDefaultProjectTrust() === 'always'
    if (!terminalUi) throw new Error('Pi project trust requires an initialized terminal UI')
    const answer = await terminalUi.select(`Trust project resources in ${cwd}?`, ['Trust this project', 'Continue without project resources'])
    if (answer === undefined) return false
    const trusted = answer === 'Trust this project'
    trust.set(cwd, trusted)
    return trusted
  }
  const createRuntime: CreateAgentSessionRuntimeFactory = async (options) => {
    const previous = current
    setReady(false)
    if (previous) await ensureProjectTrust(options.cwd)
    unsubscribe?.()
    if (previous) await previous.disposeResources()
    spec = { ...spec, cwd: options.cwd }
    const next = await factory.open(spec, { kind: 'resume', session: { provider: 'pi', id: options.sessionManager.getSessionId() } },
      { sessionManager: options.sessionManager, extensions: [{ name: 'priva-terminal', factory: bridge }],
        ...(options.sessionStartEvent ? { sessionStartEvent: options.sessionStartEvent } : {}) })
    // A successful Chat /new belongs to the outgoing session; open errors must still fail it.
    if (previous && activeRunId) {
      finish(activeRunId === newSessionRunId
        ? { type: 'run.completed', model: previous.modelId, durationMs: 0 }
        : { type: 'run.aborted', message: 'Session changed in Pi terminal' })
    }
    current = next
    const subscribed = current
    unsubscribe = current.subscribe((event) => { if (current === subscribed) receive(event) })
    if (previous && previous.sessionId !== current.sessionId) {
      publish({ type: 'session.rebound', nextSessionId: current.sessionId }, previous.sessionId)
      phase = 'idle'
      promptText = ''
      state('ready', options.sessionStartEvent?.reason ?? 'resume')
    } else state('ready')
    status()
    return { session: current.native, services: current.services, diagnostics: [], extensionsResult: current.services.resourceLoader.getExtensions() }
  }
  const manager = await createPiSessionManager(config.agentDir, spec, config.target)
  const initial = await createRuntime({ cwd: spec.cwd, agentDir: config.agentDir, sessionManager: manager })
  const runtime = new AgentSessionRuntime(initial.session, initial.services, createRuntime)
  const tui = new InteractiveMode(runtime, { initialThemeSetting: config.theme })

  const runPrompt = async (command: Extract<PiTerminalCommand, { type: 'prompt' }>) => {
    const session = current
    if (!session) throw new Error('Pi session is unavailable')
    begin(command.text, command.runId)
    const runId = activeRunId
    try {
      const name = /^\/([\w-]+)/u.exec(command.text.trim())?.[1]
      if (name === 'compact') await session.compact(command.text.trim().slice('/compact'.length).trim() || undefined)
      else if (name === 'new') {
        newSessionRunId = runId
        const result = await runtime.newSession()
        if (result.cancelled) finish({ type: 'run.aborted', message: 'Session change cancelled' }, runId)
      }
      else if (name && PI_BUILTIN_SLASH_COMMANDS.some((item) => item.name === name)) {
        session.native.extensionRunner.getUIContext().setEditorText(command.text)
        publish({ type: 'terminal.focus', reason: `Run ${command.text} in the Pi terminal` })
      } else {
        const images = await Promise.all((command.imagePaths ?? []).map(async (file) => {
          const image = await loadWorkspaceImage(session.services.cwd, file)
          return { type: 'image' as const, data: Buffer.from(image.bytes).toString('base64'), mimeType: image.mime }
        }))
        await session.prompt(command.text, images)
      }
      // Extension commands may complete without starting a model turn.
      if (current === session && !session.isStreaming) finish({ type: 'run.completed', model: session.native.model?.id ?? spec.model, durationMs: 0 }, runId)
    } catch (error) {
      finish({ type: 'run.failed', code: 'provider_error', message: error instanceof Error ? error.message : String(error) }, runId)
    } finally { commandPending = false; newSessionRunId = undefined }
  }
  const command = async (input: PiTerminalCommand) => {
    if (!current || closed) throw new Error('Pi session is unavailable')
    if (input.type === 'respond') { current.respondPermission(input.response); return }
    if (input.type === 'abort') { await current.abort(); return }
    if (input.type === 'stop-task') { await current.stopTask(input.taskId); return }
    if (!ready) throw new Error('Pi is waiting for startup or project trust. Continue in Chat or Terminal.')
    if (activeRunId || commandPending || !current.native.isIdle) throw new Error('Pi is busy; wait for the current turn')
    if (input.type === 'prompt') {
      commandPending = true
      // A prompt may wait on a question. Acknowledge before the model loop so abort/respond remain usable.
      void runPrompt(input)
      return
    }
    commandPending = true
    try {
      if (input.type === 'configure') {
        if (!isContextWindow(input.contextWindow)) throw new Error('Unsupported context window')
        await current.setRunModel(input.model, input.contextWindow)
        if (input.effort !== undefined) current.native.setThinkingLevel(input.effort)
        spec = { ...spec, model: input.model, contextWindow: input.contextWindow, effort: current.native.thinkingLevel }
        writeJson('spec', spec)
      } else {
        await current.native.reload()
        current.bindTerminalUI()
      }
    } finally { commandPending = false }
    status()
  }
  const server = createServer((request, response) => {
    void serve(request, response, config.token, command).catch((error: unknown) => {
      response.writeHead(400, { 'content-type': 'text/plain' }).end(error instanceof Error ? error.message : String(error))
    })
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Pi command server has no TCP address')
  controlEndpoint.port = address.port
  setReady(false)
  const shutdown = async (fromNative = false) => {
    if (closed) return
    closed = true
    setReady(false)
    server.closeAllConnections()
    server.close()
    try {
      await current?.abort()
      if (activeRunId) finish({ type: 'run.aborted', message: 'Pi terminal exited' })
      if (!fromNative) await runtime.dispose()
    } finally {
      unsubscribe?.()
      await current?.disposeResources()
      phase = 'exited'
      state('exit')
    }
  }
  // InteractiveMode exits the process after awaited extension shutdown hooks.
  controlEndpoint.shutdown = () => shutdown(true)
  try {
    await tui.init()
    if (current) {
      const trusted = await ensureProjectTrust(current.services.cwd)
      if (trusted !== current.services.settingsManager.isProjectTrusted()) {
        current.services.settingsManager.setProjectTrusted(trusted)
        await current.native.reload()
      }
    }
    startupComplete = true
    setReady(true)
    state('ready')
    status()
    await tui.run()
  } finally {
    await shutdown()
  }
}

async function serve(request: IncomingMessage, response: ServerResponse, token: string, handle: (command: PiTerminalCommand) => Promise<void>): Promise<void> {
  const provided = Buffer.from(request.headers.authorization ?? '')
  const expected = Buffer.from(`Bearer ${token}`)
  if (request.method !== 'POST' || request.url !== '/command' || provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    response.writeHead(403).end('Forbidden')
    return
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += bytes.length
    if (size > 4 * 1024 * 1024) throw new Error('Pi command is too large')
    chunks.push(bytes)
  }
  const raw: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  const command = piTerminalCommandSchema.parse(asRecord(raw))
  await handle(command)
  response.writeHead(200, { 'content-type': 'application/json' }).end('{"accepted":true}')
}

void main().catch((error: unknown) => { process.stderr.write(`Pi terminal failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exitCode = 1 })
