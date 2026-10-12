import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { WebSocket } from 'ws'

import type { StreamFrame } from '../../src/core/event/agent-event.js'

// Opt-in: real model calls and visible desktop input. Run one probe at a time.
const harness = process.argv[2]
assert.ok(harness === 'claude' || harness === 'pi', 'Pass claude or pi')
const origin = process.argv[3] ?? 'http://127.0.0.1:15173'
const textOnly = process.argv.includes('--text-only')
const requestedProfile = process.argv[4] === '--text-only' ? undefined : process.argv[4]
const profilesResponse = await fetch(`${origin}/api/sandbox/credentials/profiles`)
assert.equal(profilesResponse.status, 200)
const profiles = await profilesResponse.json() as {
  profiles: { id: string; default_model: string | null }[]; default_profile_id: string
}
const profile = profiles.profiles.find((item) => item.id === (requestedProfile ?? profiles.default_profile_id))
assert.ok(profile?.default_model, 'Select a configured model profile')
const nonce = randomUUID()
const filename = `computer-proof-${harness}-${nonce}.txt`
const proofPath = `/data/workspace/${filename}`
const expected = `Runner MCP desktop proof\n中文输入验证：电脑操作成功。\n${nonce}\n`
const form = new FormData()
form.set('directory', '/data/workspace')
form.set('file', new Blob([''], { type: 'text/plain' }), filename)
const upload = await fetch(`${origin}/api/sandbox/files/upload`, { method: 'POST', body: form })
assert.ok(upload.ok, `Cannot prepare empty editor fixture: ${upload.status}`)
const prompt = `Validate the computer MCP through this Runner session. Read the computer-desktop skill first.
Use only the computer MCP for desktop actions and for writing the proof content; do not use shell, file-write tools, scripts, or terminal commands to write it.
1. Call get_desktop_state${textOnly ? ` with screenshot_out_file="/data/workspace/computer-proof-${nonce}.png" (this is a text-only model; use accessibility trees with include_screenshot:false for further observations)` : ' and inspect its screenshot'}.
2. Call launch_app with name="mousepad", additional_arguments=["--disable-server",${JSON.stringify(proofPath)}]. This unique file is currently empty. Do not change other windows or files.
3. Discover its actual pid/window through list_windows. Use foreground input without element_token to type this exact text, then press Ctrl+S to save:
${JSON.stringify(expected)}
4. Inspect the editor${textOnly ? ' with get_window_state(include_screenshot:false)' : ''} and confirm the Chinese text and nonce. Leave this saved window open so the person can see it in the Computer tab. Reply briefly.
Do not claim success if a tool refuses or input is incomplete. Do not browse external sites or access credentials.`
const url = new URL('/api/sandbox/agent/ws/session', origin)
url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
const ws = new WebSocket(url)
let sessionId: string | undefined
const calls = new Map<string, { name: string; input?: unknown; ok?: boolean }>()
try {
  await new Promise<void>((resolve, reject) => {
    let finished = false
    const timeout = setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'run.abort', harness, runId: nonce, ...(sessionId ? { sessionId } : {}) }))
      finish(new Error('Computer model probe exceeded 300 seconds'))
    }, 300_000)
    function finish(error?: Error) {
      if (finished) return
      finished = true
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
      if (frame.type === 'tool.started' || frame.type === 'tool.updated') {
        calls.set(frame.id, { ...calls.get(frame.id), name: frame.name, input: frame.input })
        if (frame.type === 'tool.started') console.log(`Tool started: ${frame.name}`)
      }
      if (frame.type === 'tool.completed') {
        calls.set(frame.id, { ...calls.get(frame.id), name: frame.name, ok: frame.ok })
        console.log(`Tool completed: ${frame.name} (${frame.ok ? 'ok' : 'failed'})`)
      }
      if (frame.type === 'run.completed') finish()
      if (frame.type === 'error' || frame.type === 'run.failed') finish(new Error(frame.message))
      if (frame.type === 'run.aborted') finish(new Error('Model run aborted'))
    })
  })
} finally {
  ws.close()
  console.log(JSON.stringify({ harness, sessionId, model: profile.default_model, textOnly, proofPath }))
}
const successful = [...calls.values()].filter((call) => call.ok)
// Saving may use press_key, hotkey, or an accessible Save control. The exact
// persisted file below proves the result without prescribing a GUI route.
for (const name of ['get_desktop_state', 'launch_app', 'type_text']) {
  assert.ok(successful.some((call) => call.name === `mcp__computer__${name}`
    || (typeof call.input === 'object' && call.input !== null
      && (call.name === 'mcp__computer' || (call.name === 'mcp' && 'server' in call.input && call.input.server === 'computer'))
      && 'tool' in call.input && [name, `computer_${name}`].includes(String(call.input.tool)))), `Missing successful computer MCP call: ${name}`)
}
assert.ok(!successful.some((call) => /^(bash|write|edit|writefile|editfile|apply_patch)$/iu.test(call.name)), 'Proof must be written by desktop MCP')
const response = await fetch(`${origin}/api/sandbox/files/preview?path=${encodeURIComponent(proofPath)}`)
assert.equal(response.status, 200)
const file = await response.json() as { content: string }
assert.equal(file.content, expected, 'Saved editor text must match all Unicode characters and the nonce')
console.log('Runner model → computer MCP → Mousepad → saved Unicode proof passed')
