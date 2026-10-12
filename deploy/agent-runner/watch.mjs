import { watch } from 'node:fs'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

const root = resolve(import.meta.dirname, '../..')
const runner = resolve(root, 'services/agent-runner/ts')
const script = resolve(root, 'deploy/agent-runner/dev.sh')
const configFiles = new Set(['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'eslint.config.js'])
let dirty = false
let stopped = false
let child
let timer

function sync() {
  if (stopped || child || !dirty) return
  dirty = false
  child = spawn('bash', [script, 'sync'], { stdio: 'inherit' })
  child.once('error', (error) => { console.error(error.message) })
  child.once('close', (code) => {
    child = undefined
    if (code !== 0 && !stopped) console.error('Sync failed; fix the reported error, then save a file or restart watch to retry.')
    if (dirty) schedule()
  })
}

function schedule() {
  dirty = true
  clearTimeout(timer)
  timer = setTimeout(sync, 300)
}

const watchers = ['src', 'tests'].map((directory) => watch(resolve(runner, directory), { recursive: true }, schedule))
watchers.push(watch(runner, (_event, name) => { if (name && configFiles.has(String(name))) schedule() }))
for (const watcher of watchers) watcher.on('error', (error) => { console.error(error.message); stop(1) })

function stop(code) {
  stopped = true
  clearTimeout(timer)
  for (const watcher of watchers) watcher.close()
  child?.kill('SIGTERM')
  process.exitCode = code
}
process.once('SIGINT', () => { stop(0) })
process.once('SIGTERM', () => { stop(0) })
console.log('Watching Runner source and tests; Ctrl+C stops automatic synchronization.')
schedule()
