import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { release, arch } from 'node:os'
import { performance } from 'node:perf_hooks'

assert.equal(process.platform, 'linux')
assert.notEqual(process.getuid(), 0)
const root = mkdtempSync('/tmp/bwrap-overhead-')
const small = `${root}/small`
const large = `${root}/large`
mkdirSync(small)
mkdirSync(large)
const run = (command, args) => {
  const start = performance.now()
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30000 })
  assert.equal(result.status, 0, result.stderr || String(result.error))
  return { ms: performance.now() - start, stdout: result.stdout }
}
const common = [
  '--unshare-user', '--unshare-pid', '--unshare-ipc', '--unshare-uts', '--disable-userns',
  '--die-with-parent', '--new-session', '--cap-drop', 'ALL', '--clearenv',
  '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin',
  '--symlink', 'usr/sbin', '/sbin', '--symlink', 'usr/lib', '/lib',
  '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--tmpfs', '/home',
  '--dir', '/home/worker', '--dir', '/etc',
  ...['passwd', 'group', 'nsswitch.conf', 'resolv.conf', 'hosts', 'ssl/certs']
    .flatMap((path) => ['--ro-bind', `/etc/${path}`, `/etc/${path}`]),
  '--dir', '/app', '--ro-bind', '/opt/poc/worker.mjs', '/app/worker.mjs',
  '--ro-bind', '/opt/poc/node_modules', '/app/node_modules',
  '--dir', '/mnt', '--dir', '/mnt/user',
  '--setenv', 'HOME', '/home/worker', '--setenv', 'PATH', '/usr/local/bin:/usr/bin:/bin',
]
if (existsSync('/usr/lib64')) common.push('--symlink', 'usr/lib64', '/lib64')
const wrapped = (source, count = 1, program = ['/usr/bin/true']) => ['bwrap', [
  ...common,
  ...Array.from({ length: count }, (_, i) => ['--bind', source, `/mnt/user/sb-${i}`]).flat(),
  '--chdir', '/mnt/user/sb-0', '--remount-ro', '/', '--', ...program,
]]
const summarize = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b)
  return { samples: samples.length, medianMs: +sorted[Math.floor(sorted.length / 2)].toFixed(3),
    p95Ms: +sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(3) }
}

try {
  const creationStart = performance.now()
  let directories = 0
  for (let user = 0; user < 50; user++) {
    const userPath = `${large}/user-${user}`
    mkdirSync(userPath); directories++
    for (let agent = 0; agent < 100; agent++) {
      const agentPath = `${userPath}/agent-${agent}`
      mkdirSync(agentPath); directories++
      for (let tenant = 0; tenant < 20; tenant++) {
        mkdirSync(`${agentPath}/tenant-${tenant}`); directories++
      }
    }
  }
  writeFileSync(`${small}/data`, Buffer.alloc(4096, 42))
  console.log(JSON.stringify({ event: 'fixtures', directories,
    creationSeconds: +((performance.now() - creationStart) / 1000).toFixed(2) }))
  const startup = [
    { name: 'direct true', command: ['/usr/bin/true', []], values: [] },
    { name: 'bwrap: 1 bind, small directory', command: wrapped(small), values: [] },
    { name: 'bwrap: 1 bind, tree with 105050 subdirectories', command: wrapped(large), values: [] },
    { name: 'bwrap: 1 bind, one leaf in large tree', command: wrapped(`${large}/user-49/agent-99/tenant-19`), values: [] },
    { name: 'bwrap: 10 explicit data binds', command: wrapped(small, 10), values: [] },
    { name: 'bwrap: 100 explicit data binds', command: wrapped(small, 100), values: [] },
  ]
  // Interleave cases to reduce drift; all timings include process spawn + exit.
  for (let round = -5; round < 40; round++) {
    for (let offset = 0; offset < startup.length; offset++) {
      const test = startup[(offset + round + 6) % startup.length]
      const result = run(...test.command)
      if (round >= 0) test.values.push(result.ms)
    }
  }
  const ioCode = `const fs=require('node:fs'); const p=process.argv[1];
    for(let i=0;i<1000;i++)fs.readFileSync(p);
    const t=performance.now();
    for(let i=0;i<10000;i++)fs.readFileSync(p);
    console.log(performance.now()-t);`
  const io = [
    { name: 'direct cached 4KiB read x10000', command: ['/usr/local/bin/node', ['-e', ioCode, `${small}/data`]], values: [] },
    { name: 'bwrap cached 4KiB read x10000', command: wrapped(small, 1, ['/usr/local/bin/node', '-e', ioCode, '/mnt/user/sb-0/data']), values: [] },
  ]
  for (let round = 0; round < 12; round++) {
    for (let offset = 0; offset < io.length; offset++) {
      const test = io[(offset + round) % io.length]
      test.values.push(Number(run(...test.command).stdout.trim()))
    }
  }
  console.log(JSON.stringify({ environment: {
    os: readFileSync('/etc/os-release', 'utf8').match(/^PRETTY_NAME=(.*)$/m)[1],
    kernel: release(), arch: arch(), node: process.version, uid: process.getuid(),
    bubblewrap: run('bwrap', ['--version']).stdout.trim(),
    filesystem: run('stat', ['-f', '-c', '%T', root]).stdout.trim(),
    hostMounts: readFileSync('/proc/self/mountinfo', 'utf8').trim().split('\n').length,
  }, fixtureDirectories: directories, startupAndExit: startup.map(({ name, values }) => ({ name, ...summarize(values) })),
    warmCachedReadsExcludingStartup: io.map(({ name, values }) => ({ name, ...summarize(values) })),
    limitations: 'Docker Desktop Debian VM; warm-cache serial microbenchmark; no Claude worker/model inference or concurrent-load test; not full 500k-1.5m directory scale',
  }, null, 2))
} finally {
  rmSync(root, { recursive: true, force: true })
}
