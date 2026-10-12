import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { WebSocket } from 'ws'

import type { StreamFrame } from '../../src/core/event/agent-event.js'

// Opt-in: this probe makes a real model request and leaves a proof file/session.
// Run from the Mac through the UI proxy to exercise the same path as the browser.
const harness = process.argv[2]
assert.ok(harness === 'claude' || harness === 'pi', 'Pass claude or pi')
const origin = process.argv[3] ?? 'http://127.0.0.1:15173'
interface Profile { id: string; default_model: string | null }
const profilesResponse = await fetch(`${origin}/api/sandbox/credentials/profiles`)
assert.equal(profilesResponse.status, 200)
const profiles = await profilesResponse.json() as { profiles: Profile[]; default_profile_id: string }
const profile = profiles.profiles.find((entry) => entry.id === (process.argv[4] ?? profiles.default_profile_id))
assert.ok(profile?.default_model, 'The selected profile needs a default model')
const nonce = randomUUID()
const proofPath = `/data/workspace/debian-proof-${harness}-${nonce}.json`
const python = [
  'import json, os, platform, pathlib',
  `proof = dict(nonce=${JSON.stringify(nonce)}, system=platform.system(), cwd=os.getcwd(), uid=os.getuid(), pid=os.getpid(), hostname=platform.node(), os_release=pathlib.Path('/etc/os-release').read_text())`,
  `pathlib.Path(${JSON.stringify(proofPath)}).write_text(json.dumps(proof))`,
  'print(json.dumps(proof))',
].join('\n')
const prompt = `Container verification task. Use your shell tool to execute the following exact command, then confirm completion in one sentence. Do not read any credentials or other user files.\n\npython3 - <<'PY'\n${python}\nPY`
const url = new URL('/api/sandbox/agent/ws/session', origin)
url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
let sessionId: string | undefined
let toolsCompleted = 0
const ws = new WebSocket(url)
try {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'run.abort', harness, runId: nonce, ...(sessionId ? { sessionId } : {}) }))
      reject(new Error('Model probe exceeded 180 seconds'))
    }, 180_000)
    const finish = (error?: Error) => {
      clearTimeout(timeout)
      if (error) reject(error)
      else resolve()
    }
    ws.once('error', finish)
    ws.once('close', () => { finish(new Error('WebSocket closed before completion')) })
    ws.once('open', () => {
      ws.send(JSON.stringify({ type: 'run.start', harness, model: `${profile.id}:${profile.default_model}`,
        cwd: '/data/workspace', runId: nonce, text: prompt, effort: 'low', promptSuggestions: false }))
    })
    ws.on('message', (raw: Buffer) => {
      const frame = JSON.parse(raw.toString('utf8')) as StreamFrame
      sessionId = frame.sessionId ?? sessionId
      if (frame.type === 'tool.completed' && frame.ok) toolsCompleted++
      if (frame.type === 'tool.started') console.log(`Tool started: ${frame.name}`)
      if (frame.type === 'run.completed') finish()
      if (frame.type === 'error' || frame.type === 'run.failed') finish(new Error(frame.message))
      if (frame.type === 'run.aborted') finish(new Error('Model run aborted'))
    })
  })
} finally {
  ws.close()
}
assert.ok(toolsCompleted > 0, 'The model must successfully invoke a tool')
const response = await fetch(`${origin}/api/sandbox/files/preview?path=${encodeURIComponent(proofPath)}`)
assert.equal(response.status, 200)
const file = await response.json() as { content: string }
const proof = JSON.parse(file.content) as { nonce: string; system: string; cwd: string; uid: number; pid: number; hostname: string; os_release: string }
assert.equal(proof.nonce, nonce)
assert.equal(proof.system, 'Linux')
assert.equal(proof.cwd, '/data/workspace')
assert.equal(proof.uid, 1000)
assert.match(proof.os_release, /^VERSION_ID="13"$/mu)
console.log(JSON.stringify({ harness, sessionId, model: profile.default_model, toolsCompleted, proofPath, proof }, null, 2))
