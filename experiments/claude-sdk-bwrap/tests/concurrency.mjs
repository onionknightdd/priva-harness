import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { performance, monitorEventLoopDelay } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { arch, release as kernelRelease } from 'node:os'
import { replyMessage } from './fixtures/messages.mjs'
import { resourceLimits, sampleResources, summarizeResources, processMemory, validateResourceFiles } from './fixtures/resources.mjs'

assert.equal(process.platform, 'linux', 'Run in the dedicated Debian test container')
assert.notEqual(process.getuid(), 0, 'The worker and harness must run as non-root')
const count = Number(process.argv[2])
assert.ok(Number.isInteger(count) && count >= 1 && count <= 100, 'Usage: node tests/concurrency.mjs WORKERS [OUTPUT_DIR]')
validateResourceFiles()
const limits = resourceLimits()
assert.notEqual(limits.memoryMax, 'max', 'Set a container memory limit before running this load test')
const output = process.argv[3] ?? '/tmp/poc-concurrency'
await mkdir(output, { recursive: true })
const root = await mkdtemp('/tmp/claude-concurrency-')
const workers = Array.from({ length: count }, (_, id) => ({ id, tenant: `sb-${1000 + id}`,
  directory: `${root}/sb-${1000 + id}`, errors: [], results: new Map(), pending: new Set(), stderr: '', events: [] }))
for (const worker of workers) {
  await mkdir(worker.directory)
  await writeFile(`${worker.directory}/marker.txt`, `marker-${worker.tenant}`)
  const base = `/mnt/user/${worker.tenant}`
  worker.calls = [
    ['Bash', { command: `cat ${base}/marker.txt` }],
    ['Bash', { command: `printf poc > ${base}/Bash.txt` }],
    ['Read', { file_path: `${base}/marker.txt` }],
    ['Write', { file_path: `${base}/native.txt`, content: 'poc' }],
    ['mcp__probe__read_file', { path: `${base}/marker.txt` }],
    ['mcp__probe__write_file', { path: `${base}/MCP.txt`, content: 'poc' }],
  ].map(([name, input], i) => ({ type: 'tool_use', id: `toolu_load_${worker.id}_${i}`, name, input }))
}

const origin = performance.now()
const controllerCpuStart = process.cpuUsage()
const eventLoop = monitorEventLoopDelay({ resolution: 20 })
eventLoop.enable()
let phase = 'baseline'
let toolsReleased = false
let finishReleased = false
let fatalError
let maxLive = 0
let sampleTimer
let progressTimer
const samples = []
const snapshots = {}
const sample = () => {
  const value = sampleResources(phase, origin)
  samples.push(value)
  appendFileSync(`${output}/samples.jsonl`, `${JSON.stringify(value)}\n`)
  return value
}
const markPhase = (name) => {
  sample()
  phase = name
  sample()
  console.log(JSON.stringify({ event: 'phase', phase, elapsedMs: performance.now() - origin }))
}
const kill = (worker) => {
  if (worker.child && !worker.closed) worker.child.kill('SIGKILL')
}
const live = () => workers.filter((worker) => worker.child && !worker.closed)
function hold(worker, response, body, stage) {
  assert.ok(body.stream, 'The SDK must use streaming responses for the barrier')
  response.writeHead(200, { 'Content-Type': 'text/event-stream' })
  response.write(': waiting at benchmark barrier\n\n')
  const item = { response, body, stage }
  worker.pending.add(item)
  response.once('close', () => worker.pending.delete(item))
}
function release(stage) {
  for (const worker of workers) {
    for (const item of worker.pending) {
      if (item.stage !== stage || item.response.destroyed) continue
      replyMessage(item.response, item.body, stage === 'start' ? worker.calls
        : [{ type: 'text', text: 'Filesystem workload complete.' }])
      worker.pending.delete(item)
    }
  }
}

const server = createServer(async (request, response) => {
  let worker
  try {
    const match = request.url.match(/^\/worker\/(\d+)\/v1\/messages(\/count_tokens)?(?:\?|$)/)
    assert.ok(match, `Unexpected API path: ${request.url}`)
    worker = workers[Number(match[1])]
    assert.ok(worker, 'Unknown worker')
    let raw = ''
    for await (const chunk of request) raw += chunk
    const body = JSON.parse(raw)
    if (match[2]) { response.end(JSON.stringify({ input_tokens: 100 })); return }
    if (!body.tools?.some((tool) => tool.name === 'Bash')) {
      replyMessage(response, body, [{ type: 'text', text: '{"isNewTopic":false,"title":null}' }])
      return
    }
    worker.readyAt ??= performance.now()
    for (const call of worker.calls) assert.ok(body.tools.some((tool) => tool.name === call.name), `Missing tool ${call.name}`)
    for (const message of body.messages) {
      for (const block of Array.isArray(message.content) ? message.content : []) {
        if (block.type === 'tool_result' && worker.calls.some((call) => call.id === block.tool_use_id)) {
          worker.results.set(block.tool_use_id, block)
        }
      }
    }
    if (!worker.results.size) {
      if (toolsReleased) replyMessage(response, body, worker.calls)
      else hold(worker, response, body, 'start')
    } else {
      assert.equal(worker.results.size, worker.calls.length, 'Every filesystem tool must finish')
      for (const [id, result] of worker.results) {
        assert.ok(!result.is_error, `${id}: ${JSON.stringify(result.content)}`)
      }
      for (const index of [0, 2, 4]) {
        assert.ok(JSON.stringify(worker.results.get(worker.calls[index].id).content).includes(`marker-${worker.tenant}`))
      }
      worker.toolsDoneAt ??= performance.now()
      if (finishReleased) replyMessage(response, body, [{ type: 'text', text: 'Filesystem workload complete.' }])
      else hold(worker, response, body, 'finish')
    }
  } catch (error) {
    if (worker) { worker.errors.push(error.message); kill(worker) }
    else fatalError = error
    if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: error.message } }))
  }
})
server.requestTimeout = 0

async function waitFor(predicate, timeoutMs, label) {
  const deadline = performance.now() + timeoutMs
  while (!workers.every((worker) => worker.closed || predicate(worker))) {
    if (fatalError) throw fatalError
    if (performance.now() >= deadline) {
      for (const worker of live().filter((item) => !predicate(item))) {
        worker.errors.push(`${label} timeout after ${timeoutMs} ms`)
        kill(worker)
      }
      return
    }
    await delay(100)
  }
}

try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  sample()
  sampleTimer = setInterval(sample, 250)
  progressTimer = setInterval(() => {
    const current = samples.at(-1)
    console.log(JSON.stringify({ event: 'progress', phase, live: live().length,
      ready: workers.filter((worker) => worker.readyAt).length,
      toolsDone: workers.filter((worker) => worker.toolsDoneAt).length,
      memoryMiB: +(current.memoryBytes / 2 ** 20).toFixed(1), oomKills: current.memoryEvents.oom_kill }))
    for (const worker of workers) for (const item of worker.pending) {
      if (!item.response.destroyed) item.response.write(': keepalive\n\n')
    }
  }, 5000)
  await delay(1000)
  markPhase('startup')
  for (const worker of workers) {
    worker.launchedAt = performance.now()
    worker.child = spawn('bash', [fileURLToPath(new URL('../sandbox.sh', import.meta.url)), worker.directory,
      `http://127.0.0.1:${server.address().port}/worker/${worker.id}`], { stdio: ['ignore', 'pipe', 'pipe'] })
    let buffer = ''
    worker.child.stdout.on('data', (chunk) => {
      buffer += chunk
      let end
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
        try {
          const event = JSON.parse(line)
          worker.events.push(event)
          if (event.event === 'worker') { worker.importedAt = performance.now(); worker.identity = event }
          if (event.event === 'sdk_init') worker.initializedAt = performance.now()
          if (event.event === 'result') worker.result = event
        } catch (error) { worker.errors.push(`Invalid worker output: ${error.message}`); kill(worker) }
      }
    })
    worker.child.stderr.on('data', (chunk) => { worker.stderr = (worker.stderr + chunk).slice(-16000) })
    worker.child.once('error', (error) => { worker.errors.push(error.message) })
    worker.closedPromise = new Promise((resolve) => worker.child.once('close', (code, signal) => {
      worker.closed = true; worker.exitCode = code; worker.signal = signal; worker.closedAt = performance.now()
      resolve()
    }))
    maxLive = Math.max(maxLive, live().length)
  }
  await waitFor((worker) => worker.readyAt, 180000, 'Startup')
  snapshots.readyWorkersAlive = live().filter((worker) => worker.readyAt).length
  markPhase('idle')
  await delay(10000)
  snapshots.idle = processMemory()
  snapshots.idleResources = sample()
  markPhase('tools')
  toolsReleased = true
  const toolsStart = performance.now()
  for (const worker of workers) worker.toolsReleasedAt = toolsStart
  release('start')
  await waitFor((worker) => worker.toolsDoneAt, 180000, 'Tools')
  snapshots.toolsCompleteWorkersAlive = live().filter((worker) => worker.toolsDoneAt).length
  snapshots.afterTools = processMemory()
  snapshots.afterToolsResources = sample()
  markPhase('exit')
  finishReleased = true
  release('finish')
  await waitFor(() => false, 30000, 'Exit')
  await Promise.all(workers.map((worker) => worker.closedPromise))
  for (const worker of workers) {
    if (worker.exitCode !== 0) continue
    try {
      assert.equal(worker.result?.subtype, 'success')
      assert.deepEqual(worker.result.permission_denials, [])
      assert.deepEqual(worker.identity.tenants, [worker.tenant])
      const mcp = worker.events.filter((event) => event.event === 'mcp_call')
      assert.equal(mcp.length, 2)
      assert.ok(mcp.every((event) => event.pid === worker.identity.pid && event.namespace === worker.identity.namespace))
      for (const lane of ['Bash', 'native', 'MCP']) assert.equal(await readFile(`${worker.directory}/${lane}.txt`, 'utf8'), 'poc')
    } catch (error) { worker.errors.push(error.message) }
  }
} catch (error) {
  fatalError = error
} finally {
  for (const worker of live()) kill(worker)
  await Promise.all(workers.map((worker) => worker.closedPromise))
  clearInterval(sampleTimer)
  clearInterval(progressTimer)
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  sample()
  eventLoop.disable()
  const distribution = (values) => {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
    const quantile = (p) => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null
    return { count: sorted.length, p50Ms: quantile(0.5), p95Ms: quantile(0.95), maxMs: quantile(1) }
  }
  const successful = workers.filter((worker) => worker.exitCode === 0 && !worker.errors.length && worker.toolsDoneAt)
  const cpu = process.cpuUsage(controllerCpuStart)
  const report = { requestedWorkers: count, successfulWorkers: successful.length, maxLive,
    status: !fatalError && successful.length === count ? 'PASS' : 'FAILED', fatalError: fatalError?.message,
    environment: { debian: readFileSync('/etc/os-release', 'utf8').match(/^PRETTY_NAME=(.*)$/m)[1],
      kernel: kernelRelease(), arch: arch(), node: process.version, limits,
      bubblewrap: execFileSync('bwrap', ['--version'], { encoding: 'utf8' }).trim(),
      sdk: JSON.parse(readFileSync(new URL('../node_modules/@anthropic-ai/claude-agent-sdk/package.json', import.meta.url))).version },
    timing: {
      launchSpreadMs: workers.at(-1).launchedAt - workers[0].launchedAt,
      workerImport: distribution(workers.map((worker) => worker.importedAt - worker.launchedAt)),
      sdkInit: distribution(workers.map((worker) => worker.initializedAt - worker.launchedAt)),
      firstModelRequest: distribution(workers.map((worker) => worker.readyAt - worker.launchedAt)),
      sixToolCalls: distribution(workers.map((worker) => worker.toolsDoneAt - worker.toolsReleasedAt)),
    }, resources: summarizeResources(samples),
    phases: Object.fromEntries([...new Set(samples.map((item) => item.phase))]
      .map((name) => [name, summarizeResources(samples.filter((item) => item.phase === name))])),
    kernelMemoryPeakMiB: samples.at(-1).memoryPeakBytes / 2 ** 20,
    snapshots, fixtureAndSamplerCpuSeconds: (cpu.user + cpu.system) / 1e6,
    fixtureEventLoopP95Ms: eventLoop.percentile(95) / 1e6, fixtureEventLoopMaxMs: eventLoop.max / 1e6,
    workers: workers.map((worker) => ({ tenant: worker.tenant, exitCode: worker.exitCode, signal: worker.signal,
      importedMs: worker.importedAt - worker.launchedAt, initializedMs: worker.initializedAt - worker.launchedAt,
      readyMs: worker.readyAt - worker.launchedAt, toolsMs: worker.toolsDoneAt - worker.toolsReleasedAt,
      toolResults: worker.results.size, errors: worker.errors, stderr: worker.stderr })),
    scope: 'Real SDK + Claude Code + six filesystem tool calls per worker. Local deterministic model fixture. No inference, heavy builds, or long-session history. CPU cores: 1 = 100% of one logical CPU. Cgroup memory includes fixture, kernel and charged file cache; RSS sums may double-count shared mappings.',
  }
  writeFileSync(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ event: 'summary', requested: count, success: successful.length,
    readyWorkersAlive: snapshots.readyWorkersAlive, startup: report.timing.firstModelRequest,
    memoryPeakMiB: report.kernelMemoryPeakMiB, cpuSeconds: report.resources.cpuSeconds,
    oomKills: report.resources.oomKills, status: report.status, output }))
  await rm(root, { recursive: true, force: true })
  if (report.status !== 'PASS') process.exitCode = 1
}
