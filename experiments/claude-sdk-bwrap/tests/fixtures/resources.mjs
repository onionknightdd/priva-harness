import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { performance } from 'node:perf_hooks'

const directory = '/sys/fs/cgroup'
const read = (name) => readFileSync(`${directory}/${name}`, 'utf8').trim()
const pairs = (text) => Object.fromEntries(text.split('\n').filter(Boolean)
  .map((line) => { const [key, value] = line.split(/\s+/); return [key, Number(value)] }))
const pressure = (name) => Object.fromEntries(read(name).split('\n').map((line) => [
  line.split(' ')[0], Number(line.match(/total=(\d+)/)[1]),
]))

export function resourceLimits() {
  return { cpuMax: read('cpu.max'), memoryMax: read('memory.max'),
    memorySwapMax: read('memory.swap.max'), pidsMax: read('pids.max') }
}

export function sampleResources(phase, origin) {
  const memory = pairs(read('memory.stat'))
  return { phase, elapsedMs: performance.now() - origin,
    cpu: pairs(read('cpu.stat')), memoryBytes: Number(read('memory.current')),
    memoryPeakBytes: Number(read('memory.peak')), swapBytes: Number(read('memory.swap.current')),
    memoryAnonBytes: memory.anon, memoryFileBytes: memory.file,
    memoryShmemBytes: memory.shmem, memoryKernelBytes: memory.kernel,
    memoryEvents: pairs(read('memory.events')), pids: Number(read('pids.current')),
    pidsEvents: pairs(read('pids.events')), cpuPressure: pressure('cpu.pressure'),
    memoryPressure: pressure('memory.pressure'), ioPressure: pressure('io.pressure') }
}

export function summarizeResources(samples) {
  const first = samples[0]
  const last = samples.at(-1)
  const seconds = (last.elapsedMs - first.elapsedMs) / 1000
  const cpuSeconds = (last.cpu.usage_usec - first.cpu.usage_usec) / 1e6
  const cpuCores = samples.slice(1).map((sample, i) =>
    (sample.cpu.usage_usec - samples[i].cpu.usage_usec) / 1000 / (sample.elapsedMs - samples[i].elapsedMs))
  return { durationSeconds: seconds, cpuSeconds, averageCpuCores: seconds ? cpuSeconds / seconds : 0,
    peakSampleCpuCores: Math.max(0, ...cpuCores),
    peakMemoryMiB: Math.max(...samples.map((sample) => sample.memoryBytes)) / 2 ** 20,
    peakAnonMiB: Math.max(...samples.map((sample) => sample.memoryAnonBytes)) / 2 ** 20,
    peakFileMiB: Math.max(...samples.map((sample) => sample.memoryFileBytes)) / 2 ** 20,
    peakKernelMiB: Math.max(...samples.map((sample) => sample.memoryKernelBytes)) / 2 ** 20,
    peakThreads: Math.max(...samples.map((sample) => sample.pids)),
    cpuThrottledSeconds: ((last.cpu.throttled_usec ?? 0) - (first.cpu.throttled_usec ?? 0)) / 1e6,
    cpuPressureSomeSeconds: (last.cpuPressure.some - first.cpuPressure.some) / 1e6,
    memoryPressureSomeSeconds: (last.memoryPressure.some - first.memoryPressure.some) / 1e6,
    ioPressureSomeSeconds: (last.ioPressure.some - first.ioPressure.some) / 1e6,
    oomKills: last.memoryEvents.oom_kill - first.memoryEvents.oom_kill,
    pidsLimitHits: last.pidsEvents.max - first.pidsEvents.max }
}

// PSS apportions shared mappings; summed RSS alone would double-count them.
// Read once at phase boundaries rather than scanning every process each tick.
export function processMemory() {
  const groups = {}
  for (const entry of readdirSync('/proc').filter((name) => /^\d+$/.test(name))) {
    try {
      const command = readFileSync(`/proc/${entry}/cmdline`, 'utf8').replaceAll('\0', ' ')
      if (!command) continue
      const executable = command.split(' ')[0].split('/').at(-1)
      const kind = Number(entry) === process.pid ? 'fixtureAndSampler'
        : executable === 'bwrap' ? 'bubblewrap'
        : executable === 'node' && command.includes('/app/worker.mjs') ? 'sdkNode'
        : executable === 'claude' ? 'claudeCode' : 'other'
      const status = readFileSync(`/proc/${entry}/status`, 'utf8')
      const group = groups[kind] ??= { processes: 0, threads: 0, rssMiB: 0, pssMiB: 0, pssUnavailable: 0 }
      group.processes++
      group.threads += Number(status.match(/^Threads:\s+(\d+)/m)?.[1] ?? 0)
      group.rssMiB += Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0) / 1024
      try {
        const rollup = readFileSync(`/proc/${entry}/smaps_rollup`, 'utf8')
        group.pssMiB += Number(rollup.match(/^Pss:\s+(\d+)/m)?.[1] ?? 0) / 1024
      } catch (error) {
        if (!['EACCES', 'EPERM', 'ENOENT', 'ESRCH'].includes(error.code)) throw error
        group.pssUnavailable++
      }
    } catch (error) {
      if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error
    }
  }
  return groups
}

export function validateResourceFiles() {
  for (const name of ['memory.current', 'memory.peak', 'cpu.stat', 'memory.pressure', 'pids.events']) {
    if (!existsSync(`${directory}/${name}`)) throw new Error(`Required cgroup v2 metric missing: ${name}`)
  }
}
