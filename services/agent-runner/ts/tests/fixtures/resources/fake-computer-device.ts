// Stands in for a registered computer's tray: it registers over SSH, reports status and runs a
// desktop worker whose MCP lines travel on the same channel.
//
//   fake-computer-device.ts <worker script> <ssh arguments...>
//
// SIGUSR1 makes the console "lock": the worker stops and the Runner is told why.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createInterface } from 'node:readline'

const [workerScript, ...sshArguments] = process.argv.slice(2)
if (!workerScript || sshArguments.length === 0) throw new Error('Usage: fake-computer-device.ts <worker script> <ssh arguments...>')

const ssh = spawn('ssh', sshArguments, { stdio: ['pipe', 'pipe', 'inherit'] })
const send = (message: unknown) => ssh.stdin.write(JSON.stringify(message) + '\n')
const startWorker = (script: string) => spawn(process.execPath, ['--import', createRequire(import.meta.url).resolve('tsx'), script], { stdio: ['pipe', 'pipe', 'inherit'] })
let worker: ReturnType<typeof startWorker> | undefined
// Signal handlers change it between loop iterations.
const desktop = { locked: false }

function stopWorker(reason?: string): void {
  const running = worker
  worker = undefined
  if (!running) return
  running.kill()
  if (reason !== undefined) send({ type: 'worker-exit', reason })
}

process.on('SIGUSR1', () => { desktop.locked = true; stopWorker('The console locked.') })
process.on('SIGUSR2', () => { desktop.locked = false })
process.on('SIGTERM', () => { stopWorker(); ssh.kill() })
ssh.once('close', (code) => { stopWorker(); process.exit(code ?? 1) })

send({ type: 'hello', version: 2, name: 'Fixture Mac', platform: 'darwin' })
for await (const line of createInterface({ input: ssh.stdout })) {
  if (line.startsWith('=')) { worker?.stdin.write(line.slice(1) + '\n'); continue }
  const message = JSON.parse(line) as { type: string; id?: string; method?: string }
  if (message.type === 'close') stopWorker()
  if (message.type !== 'request') continue
  if (message.method === 'status') send({ type: 'result', id: message.id, ok: true, value: { platform: 'darwin', unlocked: !desktop.locked } })
  if (message.method === 'open') {
    if (desktop.locked) { send({ type: 'result', id: message.id, ok: false, error: 'Unlock the console first.' }); continue }
    const started = startWorker(workerScript)
    worker = started
    createInterface({ input: started.stdout }).on('line', (output) => { if (worker === started) ssh.stdin.write(`=${output}\n`) })
    started.once('close', () => { if (worker === started) { worker = undefined; send({ type: 'worker-exit', reason: 'The desktop worker stopped.' }) } })
    send({ type: 'result', id: message.id, ok: true, value: {} })
  }
}
