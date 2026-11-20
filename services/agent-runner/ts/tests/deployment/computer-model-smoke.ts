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
const prompt = `Use the Runner's original cua_repl.js to operate the Xfce desktop in the Computer tab.
Start with cua.getState() and use the Linux instructions returned by the tool. Use only the CUA desktop API for interaction with applications.
Open the existing empty file ${proofPath} in Mousepad using its graphical Open dialog or the file manager. Verify its unique filename in the target window before editing.
Enter this exact text through the window and save via the graphical application:
${JSON.stringify(expected)}
Read the edit back from the window's accessibility state.${textOnly ? ' Use text accessibility state for observations.' : ' Inspect a screenshot of that window as well.'}
Leave the saved proof window visible.
Use the original CUA application API for the entire edit. File and shell tools would invalidate this test.`
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
        cwd: '/data/workspace', runId: nonce, text: prompt, effort: 'low', promptSuggestions: false, enabledPluginIds: ['computer-use'] }))
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
const uiCalls = successful.filter((call) => call.name === 'mcp__cua_repl__js')
assert.ok(uiCalls.some((call) => typeof call.input === 'object' && call.input !== null && 'code' in call.input),
  'Expected a successful original cua_repl.js desktop operation')
assert.ok(!successful.some((call) => /^(bash|write|edit|writefile|editfile|apply_patch|mcp__node_repl__js)$/iu.test(call.name)),
  'The proof file must be written through the CUA desktop API')
const response = await fetch(`${origin}/api/sandbox/files/preview?path=${encodeURIComponent(proofPath)}`)
assert.equal(response.status, 200)
const file = await response.json() as { content: string }
assert.equal(file.content, expected, 'Saved editor text must match all Unicode characters and the nonce')
console.log('Runner model → original CUA/Sky → Mousepad → saved Unicode proof passed')
