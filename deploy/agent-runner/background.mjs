import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createConnection } from 'node:net'

const action = process.argv[2]
if (process.platform !== 'darwin' || !['install', 'status', 'uninstall'].includes(action)) {
  throw new Error('Usage on macOS: node deploy/agent-runner/background.mjs {install|status|uninstall}')
}
const root = resolve(import.meta.dirname, '../..')
const domain = `gui/${process.getuid()}`
const agents = join(homedir(), 'Library/LaunchAgents')
const logs = join(homedir(), 'Library/Logs/priva-harness')
const services = [
  { name: 'forward', ports: [18001, 19229] },
  { name: 'ui', ports: [15173] },
].map((service) => ({ ...service, label: `com.priva-harness.xfce.${service.name}` }))
const loaded = (label) => spawnSync('/bin/launchctl', ['print', `${domain}/${label}`], { stdio: 'ignore' }).status === 0
const launchctl = (...args) => execFileSync('/bin/launchctl', args, { stdio: 'inherit' })

async function listening(port) {
  return await new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const finish = (value) => { socket.destroy(); resolve(value) }
    socket.setTimeout(1000, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

if (action === 'install') {
  // A launch agent does not read interactive shell / nvm configuration. Pin the
  // selected executable directories, never persist the shell's full environment.
  const kubectl = execFileSync('/usr/bin/which', ['kubectl'], { encoding: 'utf8' }).trim()
  const npm = execFileSync('/usr/bin/which', ['npm'], { encoding: 'utf8' }).trim()
  const path = [...new Set([dirname(process.execPath), dirname(npm), dirname(kubectl), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'])].join(':')
  for (const service of services) {
    if (!loaded(service.label)) {
      for (const port of service.ports) {
        if (await listening(port)) throw new Error(`Port ${port} is already in use. Stop the existing Xfce development process before installing background services.`)
      }
    }
  }
  mkdirSync(agents, { recursive: true, mode: 0o700 })
  mkdirSync(logs, { recursive: true, mode: 0o700 })
  for (const service of services) {
    const file = join(agents, `${service.label}.plist`)
    const config = {
      Label: service.label,
      ProgramArguments: ['/bin/bash', join(root, 'deploy/agent-runner/dev.sh'), service.name],
      WorkingDirectory: root,
      EnvironmentVariables: { PATH: path, MINIKUBE_PROFILE: process.env.MINIKUBE_PROFILE ?? 'minikube' },
      RunAtLoad: true,
      KeepAlive: true,
      ThrottleInterval: 10,
      StandardOutPath: join(logs, `xfce-${service.name}.log`),
      StandardErrorPath: join(logs, `xfce-${service.name}.log`),
    }
    const xml = execFileSync('/usr/bin/plutil', ['-convert', 'xml1', '-o', '-', '-'], { input: JSON.stringify(config) })
    writeFileSync(`${file}.tmp`, xml, { mode: 0o600 })
    if (loaded(service.label)) launchctl('bootout', `${domain}/${service.label}`)
    renameSync(`${file}.tmp`, file)
    launchctl('enable', `${domain}/${service.label}`)
    launchctl('bootstrap', domain, file)
    console.log(`Installed ${service.label}; log: ${config.StandardOutPath}`)
  }
} else {
  for (const service of services) {
    if (action === 'status') {
      if (loaded(service.label)) launchctl('print', `${domain}/${service.label}`)
      else console.log(`${service.label}: not loaded`)
    } else {
      if (loaded(service.label)) launchctl('bootout', `${domain}/${service.label}`)
      rmSync(join(agents, `${service.label}.plist`), { force: true })
      console.log(`Removed ${service.label}; logs retained in ${logs}`)
    }
  }
}
