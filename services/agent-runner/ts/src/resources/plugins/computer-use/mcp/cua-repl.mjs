// Starts the runtime's node_repl worker with the `cua` API preloaded.
//
// The runtime's own @oai/cua-repl launcher is not used, for two reasons.
//
// It always turns on the completion-summary call. That gives the `js` tool a
// top-level `oneOf` input schema, and Claude does not offer a tool with such a
// schema to the model. This entry asks the same package for the same launch
// environment and leaves that one setting out, so the tool descriptions and
// bootstrap still come from the runtime.
//
// On macOS the worker asks its MCP client before using each application.
// Sessions here use applications without asking the user, and one of the
// supported hosts cannot answer such a request at all, so this entry accepts
// the worker's yes-or-no confirmations itself. Every other message passes
// through untouched.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'

const [runtime, ...extra] = process.argv.slice(2)
if (!runtime || extra.length > 0) {
  process.stderr.write('Usage: cua-repl.mjs <runtime directory>\n')
  process.exit(2)
}

const packageDir = join(runtime, 'lib', 'node_modules', '@oai', 'cua-repl')
// The package exports its environment builder; resolving by name follows that export.
const environmentModule = createRequire(join(packageDir, 'package.json')).resolve('@oai/cua-repl/environment')
const { create_launch_environment: createLaunchEnvironment } = await import(pathToFileURL(environmentModule).href)
// Everything the worker needs comes from the runtime directory, so a host only has to name it.
const modules = join(runtime, 'lib', 'node_modules')
const env = createLaunchEnvironment({
  env: {
    ...process.env,
    CUA_REPL_ENABLED_SURFACES: 'computer',
    NODE_REPL_NODE_PATH: join(runtime, 'bin', 'node'),
    NODE_REPL_NODE_MODULE_DIRS: modules,
    NODE_REPL_TRUSTED_CODE_PATHS: modules,
  },
  instructions_directory: pathToFileURL(join(packageDir, 'instructions') + '/'),
  platform: process.platform,
})
delete env.NODE_REPL_JS_COMPLETION_SUMMARY

const worker = spawn(join(runtime, 'bin', 'node_repl'), [], { env, stdio: ['pipe', 'pipe', 'inherit'] })

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
const parse = (line) => {
  try {
    const message = JSON.parse(line)
    return isObject(message) ? message : undefined
  } catch {
    return undefined
  }
}
/** A form without fields asks only yes or no. Requests for values or a URL are not confirmations. */
const isConfirmation = (params) => isObject(params) && params.mode !== 'url'
  && (!isObject(params.requestedSchema) || !isObject(params.requestedSchema.properties)
    || Object.keys(params.requestedSchema.properties).length === 0)

// Host to worker. The worker only sends confirmations to a client that says it can answer them.
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = line.includes('"initialize"') ? parse(line) : undefined
  if (message?.method !== 'initialize' || !isObject(message.params)) {
    worker.stdin.write(`${line}\n`)
    return
  }
  const capabilities = isObject(message.params.capabilities) ? message.params.capabilities : {}
  const elicitation = isObject(capabilities.elicitation) ? capabilities.elicitation : {}
  worker.stdin.write(`${JSON.stringify({ ...message, params: { ...message.params,
    capabilities: { ...capabilities, elicitation: { ...elicitation, form: {} } } } })}\n`)
}).on('close', () => { worker.stdin.end() })

// Worker to host.
createInterface({ input: worker.stdout }).on('line', (line) => {
  const message = line.includes('"elicitation/create"') ? parse(line) : undefined
  if (message?.method === 'elicitation/create' && message.id !== undefined && isConfirmation(message.params)) {
    // No persistence choice: the desktop service stores "always" approvals for every host on the
    // machine, so this answer holds for this worker only.
    worker.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { action: 'accept', content: {} } })}\n`)
    return
  }
  process.stdout.write(`${line}\n`)
})

const signals = ['SIGINT', 'SIGTERM', 'SIGHUP']
const forward = (signal) => { worker.kill(signal) }
for (const signal of signals) process.on(signal, forward)
const [code, signal] = await once(worker, 'close').finally(() => {
  for (const name of signals) process.off(name, forward)
})
if (signal) process.kill(process.pid, signal)
else process.exitCode = code ?? 1
