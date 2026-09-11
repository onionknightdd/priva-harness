import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ModelRuntime, type ExtensionContext } from '@earendil-works/pi-coding-agent'
import { workflowProjectPaths } from '@quintinshaw/pi-dynamic-workflows'
import { PiWorkflows } from '../../../../src/provider/pi/pi-workflows.js'
import { buildPiModelsConfig } from '../../../../src/provider/pi/pi-models-config.js'
import { readPiWorkflowAgent } from '../../../../src/provider/pi/pi-workflow-files.js'
import type { WorkflowState } from '../../../../src/core/resource/workflow.js'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), 'pi-workflow-bridge-'))
  const requests: string[] = []
  const server = createServer((request, response) => {
    request.setEncoding('utf8')
    let body = ''
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      const parsed = JSON.parse(body) as { model: string }
      requests.push(parsed.model)
      const text = body.includes('MARKER_B') ? 'B' : 'A'
      const item = { type: 'message', id: 'msg', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }
      const events = [
        { type: 'response.created', response: { id: 'resp', status: 'in_progress', output: [] } },
        { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
        { type: 'response.content_part.added', output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
        { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: text },
        { type: 'response.output_item.done', output_index: 0, item },
        { type: 'response.completed', response: { id: 'resp', status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11, input_tokens_details: { cached_tokens: 0 } } } },
      ]
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await rm(cwd, { recursive: true, force: true })
    await rm(workflowProjectPaths(cwd).rootDir, { recursive: true, force: true })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing HTTP test port')
  const config = join(cwd, 'models.json')
  await writeFile(config, JSON.stringify(buildPiModelsConfig(`http://127.0.0.1:${address.port}`, 'fixture-model', 'test-key')))
  const modelRuntime = await ModelRuntime.create({ modelsPath: config, authPath: join(cwd, 'auth.json'), modelsStorePath: join(cwd, 'catalog.json') })
  const bridge = new PiWorkflows({ cwd, agentDir: cwd, sessionId: 'session', modelRuntime, providerId: 'openai', modelId: 'fixture-model' })
  cleanups.push(() => { bridge.dispose(); return Promise.resolve() })
  const states: WorkflowState[] = []
  bridge.subscribe((event) => { if (event.workflow) states.push(event.workflow) })
  return { cwd, bridge, states, requests }
}

const context = { hasUI: false } as ExtensionContext

describe('Pi workflow bridge with Responses transport', () => {
  it('inherits the host model, separates identical labels and persists full details', async () => {
    const { cwd, bridge, states, requests } = await setup()
    const deliveries: string[] = []
    bridge.bindResultDelivery((_state, result) => { deliveries.push(result); return Promise.resolve() })
    const script = `export const meta={name:'Bridge',description:'Fixture only',phases:[{title:'Read'}]};phase('Read');return await parallel([()=>agent('MARKER_A',{label:'Same'}),()=>agent('MARKER_B',{label:'Same'})]);`
    await bridge.tool.execute('tool', { script, maxAgents: 2, agentRetries: 0 }, new AbortController().signal, undefined, context)
    await waitForTerminal(states)
    await bridge.flush()
    const state = states.at(-1)
    expect(state?.status).toBe('completed')
    expect(requests).toEqual(['fixture-model', 'fixture-model'])
    expect(state?.agents.map((a) => a.resultPreview).sort()).toEqual(['A', 'B'])
    const details = await Promise.all((state?.agents ?? []).map((a) => readPiWorkflowAgent(cwd, 'session', state?.workflowRunId ?? '', a.agentId ?? '')))
    expect(details.map((d) => d.process.filter((p) => p.kind === 'message').map((p) => p.text).join('')).sort()).toEqual(['A', 'B'])
    expect(deliveries).toHaveLength(1)
    expect(deliveries[0]).toContain('A')
    expect(deliveries[0]).toContain('B')
    const count = states.length
    await waitForTerminal(states)
    await bridge.flush()
    expect(states).toHaveLength(count)
  }, 15000)

  it('aborts a detached workflow and persists a terminal cancellation', async () => {
    const { bridge, states } = await setup()
    await bridge.tool.execute('cancel', { script: `export const meta={name:'Cancel',description:'Fixture only',phases:[]};return await agent('MARKER_A');`, agentRetries: 0 }, new AbortController().signal, undefined, context)
    bridge.abort()
    await waitForTerminal(states)
    await bridge.flush()
    expect(states.at(-1)?.status).toBe('cancelled')
    expect(states.at(-1)?.agents.every((a) => !['running', 'pending'].includes(a.state))).toBe(true)
  }, 15000)
})

async function waitForTerminal(states: readonly WorkflowState[]): Promise<void> {
  const start = Date.now()
  while (!states.length || ['running', 'pending'].includes(states.at(-1)?.status ?? 'running')) {
    if (Date.now() - start > 10000) throw new Error('Workflow did not finish')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
