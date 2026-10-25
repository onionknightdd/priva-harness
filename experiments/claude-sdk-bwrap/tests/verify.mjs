import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, readdir, symlink, readlink, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { replyMessage } from './fixtures/messages.mjs'

assert.equal(process.platform, 'linux', 'Run this probe on Linux (Debian 13 recommended)')
assert.notEqual(process.getuid(), 0, 'Run as a non-root user, including inside Docker')
const tenant = process.argv[2] ?? 'sb-1234'
assert.ok(['sb-1234', 'sb-5678'].includes(tenant), 'Choose sb-1234 or sb-5678')
const otherTenant = tenant === 'sb-1234' ? 'sb-5678' : 'sb-1234'
const root = await mkdtemp('/tmp/claude-bwrap-poc-')
const tenantA = join(root, tenant)
const tenantB = join(root, otherTenant)
const visibleA = `/mnt/user/${tenant}`
const visibleB = `/mnt/user/${otherTenant}`
const aMarker = `A-${randomUUID()}`
const bMarker = `B-${randomUUID()}`
const records = new Map()
let serverError
let worker

await mkdir(tenantA)
await mkdir(tenantB)
await writeFile(join(tenantA, 'marker.txt'), aMarker)
await writeFile(join(tenantB, 'marker.txt'), bMarker)
await symlink(`../${otherTenant}`, join(tenantA, 'escape'))

// Positive host control: same Unix user can read and write B without bwrap.
assert.equal(await readFile(join(tenantA, 'escape/marker.txt'), 'utf8'), bMarker)
await writeFile(join(tenantB, 'host-control.txt'), 'host can write B')
const hostNamespace = await readlink('/proc/self/ns/mnt')
const cases = []
const add = (label, name, input, denied = false, marker) => {
  cases.push({ label, name, input, denied, marker, id: `toolu_poc_${cases.length}` })
}
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`
add('ls: sandbox root', 'Bash', { command: 'ls -1 /' }, false, 'mnt')
add('ls: visible tenants', 'Bash', { command: 'ls -1 /mnt/user' }, false, tenant)
add('ls: other tenant absent', 'Bash', { command: `ls -ld -- ${quote(visibleB)}` }, true)
add('ls: original own host path absent', 'Bash', { command: `ls -ld -- ${quote(tenantA)}` }, true)
add('ls: original other host path absent', 'Bash', { command: `ls -ld -- ${quote(tenantB)}` }, true)
for (const [lane, readTool, writeTool] of [
  ['Bash', 'Bash', 'Bash'], ['native', 'Read', 'Write'],
  ['MCP', 'mcp__probe__read_file', 'mcp__probe__write_file'],
]) {
  for (const [target, directory, denied] of [
    ['own', visibleA, false], ['other', visibleB, true],
    ['symlink', `${visibleA}/escape`, true],
  ]) {
    const readPath = `${directory}/marker.txt`
    const writePath = `${directory}/${lane}-${target}.txt`
    const readInput = lane === 'Bash' ? { command: `cat -- ${quote(readPath)}` }
      : lane === 'native' ? { file_path: readPath } : { path: readPath }
    const writeInput = lane === 'Bash' ? { command: `printf poc > ${quote(writePath)}` }
      : lane === 'native' ? { file_path: writePath, content: 'poc' } : { path: writePath, content: 'poc' }
    add(`${lane}: ${target} read`, readTool, readInput, denied, denied ? undefined : aMarker)
    add(`${lane}: ${target} write`, writeTool, writeInput, denied)
  }
}
add('Bash: original host path hidden', 'Bash', { command: `cat -- ${quote(join(tenantB, 'marker.txt'))}` }, true)
add('Read: /proc/1/root cannot reach B', 'Read', { file_path: `/proc/1/root${tenantB}/marker.txt` }, true)
add('MCP: original host path hidden', 'mcp__probe__read_file', { path: join(tenantB, 'marker.txt') }, true)
add('Bash: runtime mount is read-only', 'Bash', { command: 'touch /app/should-not-exist' }, true)

// Only the model response is scripted. The installed Claude SDK, its bundled
// Claude Code binary, built-in tools and in-process MCP server all execute.
const server = createServer(async (request, response) => {
  try {
    let raw = ''
    for await (const chunk of request) raw += chunk
    const body = JSON.parse(raw || '{}')
    if (request.url.startsWith('/v1/messages/count_tokens')) {
      response.end(JSON.stringify({ input_tokens: 100 }))
      return
    }
    assert.ok(request.url.startsWith('/v1/messages'), `Unexpected API path: ${request.url}`)
    if (!body.tools?.some((tool) => tool.name === 'Bash')) {
      replyMessage(response, body, [{ type: 'text', text: '{"isNewTopic":false,"title":null}' }])
      return
    }
    for (const message of body.messages) {
      for (const block of Array.isArray(message.content) ? message.content : []) {
        if (block.type === 'tool_result' && cases.some((test) => test.id === block.tool_use_id)) {
          records.set(block.tool_use_id, block)
        }
      }
    }
    const pending = cases.filter((test) => !records.has(test.id))
    if (pending.length) {
      for (const test of pending) {
        assert.ok(body.tools.some((tool) => tool.name === test.name), `Tool not registered: ${test.name}`)
      }
      // Calls use distinct output files and immutable markers, so they are independent.
      replyMessage(response, body, pending.map((test) => ({
        type: 'tool_use', id: test.id, name: test.name, input: test.input,
      })))
    } else {
      replyMessage(response, body, [{ type: 'text', text: 'All filesystem probe calls completed.' }])
    }
  } catch (error) {
    serverError = error
    response.writeHead(500, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: error.message } }))
  }
})

try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  console.log(`RUN ${tenant}: ${tenantA} -> ${visibleA}; ${otherTenant} is not mounted`)
  worker = spawn('bash', [fileURLToPath(new URL('../sandbox.sh', import.meta.url)), tenantA,
    `http://127.0.0.1:${server.address().port}`], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  worker.stdout.on('data', (chunk) => { stdout += chunk })
  worker.stderr.on('data', (chunk) => { stderr += chunk })
  const timeout = setTimeout(() => worker.kill('SIGKILL'), 180_000)
  const code = await new Promise((resolve, reject) => {
    worker.once('error', reject)
    worker.once('close', resolve)
  }).finally(() => clearTimeout(timeout))
  if (serverError) throw serverError
  assert.equal(code, 0, `Worker failed:\n${stderr}\n${stdout}`)
  const events = stdout.trim().split('\n').map((line) => JSON.parse(line))
  const ready = events.find((event) => event.event === 'worker')
  assert.ok(ready, 'SDK worker must start')
  assert.equal(ready.uid, process.getuid())
  assert.notEqual(ready.namespace, hostNamespace)
  assert.deepEqual(ready.tenants, [tenant])
  assert.equal(ready.cwd, visibleA)
  assert.equal(records.size, cases.length, 'Every tool call must execute')
  assert.ok(!stdout.includes(bMarker) && !JSON.stringify([...records.values()]).includes(bMarker), 'B marker must never reach the SDK')
  assert.ok(events.some((event) => event.event === 'result' && event.subtype === 'success'))
  for (const event of events.filter((event) => event.event === 'result')) {
    assert.deepEqual(event.permission_denials, [], 'Permission gates must not be the isolation boundary')
  }
  const sdkSymlinkGuards = []
  const listings = []
  for (const test of cases) {
    const result = records.get(test.id)
    const text = typeof result.content === 'string' ? result.content : JSON.stringify(result.content)
    assert.equal(Boolean(result.is_error), test.denied, `${test.label}: ${text}`)
    // Write can reject a dangling parent symlink before attempting the syscall.
    // Record this separately; direct B access and MCP/Bash prove the OS boundary.
    const sdkGuard = test.label === 'native: symlink write'
      && /parent-directory symlink resolution changed/.test(text)
    if (sdkGuard) sdkSymlinkGuards.push(test.label)
    if (test.denied && !sdkGuard) {
      assert.match(text, /ENOENT|ENOTDIR|EROFS|EACCES|No such file|does not exist|read-only file system|not a directory/i, test.label)
    }
    if (test.marker) assert.ok(text.includes(test.marker), test.label)
    if (test.label.startsWith('ls:')) {
      const output = text.split('<system-reminder>')[0].trim()
      listings.push({ command: test.input.command, output, isError: Boolean(result.is_error) })
      if (test.label === 'ls: visible tenants') assert.equal(output, tenant)
    }
    console.log(`PASS ${test.label}${sdkGuard ? ' (SDK symlink guard, not OS evidence)' : ''}`)
  }
  const mcpCalls = events.filter((event) => event.event === 'mcp_call')
  assert.equal(mcpCalls.length, cases.filter((test) => test.name.startsWith('mcp__')).length)
  assert.ok(mcpCalls.every((event) => event.pid === ready.pid && event.namespace === ready.namespace))
  for (const lane of ['Bash', 'native', 'MCP']) {
    assert.equal(await readFile(join(tenantA, `${lane}-own.txt`), 'utf8'), 'poc')
  }
  assert.equal(await readFile(join(tenantB, 'marker.txt'), 'utf8'), bMarker)
  assert.equal(await readFile(join(tenantB, 'host-control.txt'), 'utf8'), 'host can write B')
  assert.deepEqual((await readdir(tenantB)).sort(), ['host-control.txt', 'marker.txt'])
  console.log(JSON.stringify({ status: 'PASS', tenant, otherTenant, toolChecks: cases.length,
    sdk: JSON.parse(await readFile(new URL('../node_modules/@anthropic-ai/claude-agent-sdk/package.json', import.meta.url))).version,
    bubblewrap: execFileSync('bwrap', ['--version'], { encoding: 'utf8' }).trim(),
    debian: (await readFile('/etc/os-release', 'utf8')).match(/^PRETTY_NAME=(.*)$/m)?.[1],
    uid: ready.uid, hostNamespace, workerNamespace: ready.namespace,
    visibleTenants: ready.tenants, visibleRoot: ready.root.sort(),
    mcpRunsInWorker: true, otherTenantUnchanged: true, sdkSymlinkGuards, listings,
    model: 'deterministic local Messages API fixture (no real inference)',
  }, null, 2))
} finally {
  worker?.kill('SIGTERM')
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await rm(root, { recursive: true, force: true })
}
