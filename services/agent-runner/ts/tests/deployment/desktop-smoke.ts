import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'

const exec = promisify(execFile)
assert.equal(process.platform, 'linux', 'Run this probe inside the Debian desktop container')
assert.notEqual(process.getuid?.(), 0)
assert.match(await readFile('/etc/os-release', 'utf8'), /^VERSION_ID="13"$/mu)
assert.equal(process.env['DISPLAY'], ':99')
assert.equal(process.env['COMPUTER_VNC_HOST'], '127.0.0.1')
assert.equal(process.env['COMPUTER_VNC_PORT'], '5900')
assert.equal(process.env['DBUS_SESSION_BUS_ADDRESS'], 'unix:path=/tmp/priva-desktop/bus')

const display = (await exec('xdpyinfo')).stdout
assert.match(display, /dimensions:\s+1440x900 pixels/u)
await exec('dbus-send', ['--session', '--type=method_call', '--print-reply', '--dest=org.freedesktop.DBus', '/', 'org.freedesktop.DBus.ListNames'])
await exec('pgrep', ['-x', 'xfce4-session'])
await exec('pgrep', ['-x', 'xfwm4'])
await exec('pgrep', ['-x', 'xfdesktop'])
await exec('chromium', ['--version'])
await exec('mousepad', ['--version'])
await exec('Thunar', ['--version'])
assert.match((await exec('fc-match', ['sans:lang=zh-cn'])).stdout, /NotoSansCJK/iu)

// Complete the RFB handshake instead of counting a listening port as a desktop.
const framebuffer = await new Promise<{ width: number, height: number }>((resolve, reject) => {
  const socket = createConnection({ host: '127.0.0.1', port: 5900 })
  let input = Buffer.alloc(0)
  let phase = 0
  const timeout = setTimeout(() => socket.destroy(new Error('VNC handshake timed out')), 5_000)
  socket.once('error', reject)
  socket.once('close', () => {
    clearTimeout(timeout)
    if (phase !== 4) reject(new Error('VNC closed before completing the handshake'))
  })
  socket.on('data', (chunk: Buffer) => {
    input = Buffer.concat([input, chunk])
    try {
      if (phase === 0 && input.length >= 12) {
        assert.equal(input.subarray(0, 12).toString(), 'RFB 003.008\n')
        input = input.subarray(12)
        socket.write('RFB 003.008\n')
        phase = 1
      }
      if (phase === 1 && input.length >= 1) {
        const count = input[0] ?? 0
        assert.ok(count > 0, 'VNC refused the connection')
        if (input.length < count + 1) return
        assert.ok(input.subarray(1, count + 1).includes(1), 'The private loopback VNC requires an unexpected credential')
        input = input.subarray(count + 1)
        socket.write(Buffer.from([1]))
        phase = 2
      }
      if (phase === 2 && input.length >= 4) {
        assert.equal(input.readUInt32BE(), 0, 'VNC security negotiation failed')
        input = input.subarray(4)
        socket.write(Buffer.from([1]))
        phase = 3
      }
      if (phase === 3 && input.length >= 24) {
        phase = 4
        resolve({ width: input.readUInt16BE(), height: input.readUInt16BE(2) })
        socket.end()
      }
    } catch (error) {
      socket.destroy()
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
})
assert.deepEqual(framebuffer, { width: 1440, height: 900 })
const listeners = (await readFile('/proc/net/tcp', 'utf8')).split('\n').filter((line) => /:170C\s/u.test(line) && /\s0A\s/u.test(line))
assert.equal(listeners.length, 1, 'Expected exactly one IPv4 VNC listener')
assert.match(listeners[0] ?? '', /0100007F:170C/u, 'VNC must listen only on 127.0.0.1')

assert.equal(await realpath(process.env['HOME'] ?? ''), '/data/home')
assert.equal(await realpath(process.env['WORKSPACE_DIR'] ?? ''), '/data/workspace')
const workspace = await mkdtemp('/data/workspace/.desktop-smoke-')
const home = await mkdtemp('/data/home/.desktop-smoke-')
const title = `desktop-smoke-${process.pid}`
const app = spawn('xterm', ['-title', title, '-geometry', '40x5', '-e', 'sleep', '15'], { stdio: 'ignore' })
try {
  for (const directory of [workspace, home]) {
    const proof = join(directory, 'proof.txt')
    await writeFile(proof, 'Debian 13 desktop persistent directory\n')
    assert.equal(await readFile(proof, 'utf8'), 'Debian 13 desktop persistent directory\n')
  }
  let visible = false
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await exec('xdotool', ['search', '--onlyvisible', '--name', `^${title}$`]).catch(() => null)
    if (result?.stdout.trim()) { visible = true; break }
    await delay(100)
  }
  assert.ok(visible, 'The test application did not create a visible X11 window')
  const screenshot = await exec('maim', [], { encoding: 'buffer', maxBuffer: 10 * 1024 * 1024 })
  assert.equal(screenshot.stdout.subarray(1, 4).toString(), 'PNG')
  assert.equal(screenshot.stdout.readUInt32BE(16), 1440)
  assert.equal(screenshot.stdout.readUInt32BE(20), 900)
  console.log(JSON.stringify({ os: 'Debian 13', display: ':99', framebuffer, checks: ['Xfce session and window manager', 'session D-Bus', 'Chromium, Mousepad and Thunar', 'Chinese fonts', 'VNC RFB handshake and loopback listener', 'visible test application', 'PNG screenshot', 'writable persistent HOME and workspace'] }, null, 2))
} finally {
  app.kill('SIGTERM')
  await rm(workspace, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
}
