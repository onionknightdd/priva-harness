import assert from 'node:assert/strict'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { z } from 'zod'
import { computerMcpServers } from '../../src/core/plugin/computer-use.js'

const [outputParent, ...extra] = process.argv.slice(2)
assert.equal(extra.length, 0, 'Usage: original-linux-desktop.ts [existing report directory]')
assert.equal(process.platform, 'linux', 'Run inside the isolated Linux desktop')
assert.ok(process.env['DISPLAY'] && process.env['PRIVA_CUA_RUNTIME'], 'Set DISPLAY and PRIVA_CUA_RUNTIME')
const launch = computerMcpServers([], { ...process.env, CUA_REPL_ENABLED_SURFACES: 'computer' })['cua_repl']
assert.ok(launch)
const client = new Client({ name: 'priva-linux-desktop-verification', version: '1.0.0' })
const transport = new StdioClientTransport({ ...launch, stderr: 'pipe', maxBufferSize: 16 * 1024 * 1024 })
transport.stderr?.on('data', () => undefined)
const options = { timeout: 25_000 }
const windowList = z.array(z.number().int())
const marker = 'Priva 桌面验证 ' + randomUUID()
const report = await mkdtemp(join(outputParent ?? tmpdir(), 'priva-sky-'))
const documentName = `priva-test-${randomUUID()}.txt`
const documentPath = join(report, documentName)
let fixture: ChildProcess | undefined

async function js(args: { code: string; title: string } | { completion_summary: string }) {
  const result = await client.callTool({ name: 'js', arguments: args }, options)
  const text = result.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
  if (result.isError) throw new Error(text.slice(-1800))
  return { text, content: result.content }
}

async function fixtureWindows() {
  const { text } = await js({ code: `nodeRepl.write("PRIVA=" + JSON.stringify(
    (await cua.listWindows({emit:false})).filter(w => w.app === "org.xfce.mousepad" && w.window_type === "normal" &&
      w.title?.includes(${JSON.stringify(documentName)})).map(w => w.id)));`,
    title: 'Finding the fixture window' })
  const line = text.split('\n').find((part) => part.startsWith('PRIVA='))
  assert.ok(line, 'Missing Mousepad inventory')
  return windowList.parse(JSON.parse(line.slice('PRIVA='.length)))
}

async function findNewEditor() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const windows = await fixtureWindows()
    if (windows[0] !== undefined) {
      assert.equal(windows.length, 1, 'Expected one Mousepad window for the unique fixture')
      return windows[0]
    }
    await delay(100)
  }
  throw new Error('The new Mousepad window did not appear')
}

async function closeEditor(windowId: number) {
  assert.deepEqual(await fixtureWindows(), [windowId], 'The captured window must still own the fixture')
  try {
    await js({ code: "await editor.pressKey('ctrl+w');", title: 'Closing the fixture' })
  } catch (error) {
    // X11 can destroy the window between key press and release.
    if (!(error instanceof Error && error.message.includes('X11Error'))) throw error
  }
  assert.deepEqual(await fixtureWindows(), [], 'The fixture window is still open')
}

try {
  await client.connect(transport, options)
  const { tools } = await client.listTools()
  assert.match(tools.find((tool) => tool.name === 'js')?.description ?? '', /cua\.getState\(\)/u)
  const initial = await js({ code: 'await cua.getState();', title: 'Reading native desktop instructions' })
  for (const method of ['listWindows', 'getApp', 'typeText', 'getAXState', 'getScreenshot', 'pressKey']) {
    assert.ok(initial.text.includes(method), `Installed runtime did not document ${method}`)
  }
  assert.ok(initial.text.includes('org.xfce.mousepad.desktop'), 'Mousepad is absent from the installed app inventory')
  await writeFile(documentPath, '', { flag: 'wx', mode: 0o600 })
  // Mousepad's standalone process opens only this file. All input and observations go through the original worker.
  fixture = spawn('mousepad', ['--disable-server', '--opening-mode=window', documentPath], { stdio: 'ignore' })
  await once(fixture, 'spawn')
  const windowId = await findNewEditor()
  const baseline = await js({ code: `let editor = await cua.getApp({windowId:${windowId}});`, title: 'Reading the new editor' })
  assert.match(baseline.text, /Accessibility source: at_spi/u)
  const observation = await js({ code: `await editor.typeText(${JSON.stringify(marker)});
    await editor.getAXState({disableDiffing:true}); await editor.getScreenshot();`, title: 'Verifying typed text and screenshot' })
  const line = observation.text.split('\n').find((part) => part.includes(marker) && part.includes('text'))
  assert.ok(line, 'The AT-SPI editor state did not contain the test input')
  const screenshot = observation.content.find((part) => part.type === 'image')
  assert.ok(screenshot, 'The native worker did not emit an image')
  const bytes = Buffer.from(screenshot.data, 'base64')
  const png = join(report, 'mousepad.png')
  if (screenshot.mimeType === 'image/jpeg') {
    assert.deepEqual(bytes.subarray(0, 2), Buffer.from([255, 216]))
    const jpeg = join(report, 'mousepad.jpg')
    await writeFile(jpeg, bytes, { mode: 0o600 })
    await promisify(execFile)('gdal_translate', ['-q', '-of', 'PNG', jpeg, png])
  } else {
    assert.equal(screenshot.mimeType, 'image/png')
    await writeFile(png, bytes, { mode: 0o600 })
  }
  const data = await readFile(png)
  assert.deepEqual(data.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  assert.ok(data.readUInt32BE(16) > 0 && data.readUInt32BE(20) > 0)
  await js({ code: "await editor.pressKey('ctrl+s');", title: 'Saving the fixture text' })
  const saved = await readFile(documentPath, 'utf8')
  assert.ok(saved === marker || saved === marker + '\n', 'The saved fixture must contain the typed marker')
  await closeEditor(windowId)
  await js({ completion_summary: 'Verified Linux Mousepad input' })
  console.log(JSON.stringify({ windowId, accessibility: line.trim(), source: screenshot.mimeType, sourceBytes: bytes.length,
    pngBytes: data.length, width: data.readUInt32BE(16), height: data.readUInt32BE(20),
    pngSha256: createHash('sha256').update(data).digest('hex'), closed: true, ...(outputParent ? { png } : {}) }))
} finally {
  if (fixture?.pid && fixture.exitCode === null && fixture.signalCode === null) {
    const exited = once(fixture, 'exit')
    fixture.kill()
    await exited
  }
  await client.close()
  await transport.close()
  if (!outputParent) await rm(report, { recursive: true, force: true })
}
