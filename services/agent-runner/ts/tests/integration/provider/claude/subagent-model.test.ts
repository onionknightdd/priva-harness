import { query } from '@anthropic-ai/claude-agent-sdk'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { expect, it } from 'vitest'

import type { AgentEvent } from '../../../../src/core/event/agent-event.js'
import { resolveBundledClaudeExecutable } from '../../../../src/provider/claude/claude-executable.js'
import { ClaudeRuntime } from '../../../../src/provider/claude/claude-runtime.js'
import { modelMessage, type ModelRequest } from '../../../fixtures/terminal/claude-tui-fixture.js'
import { testRunSpec } from '../../../support/run-spec.js'

it.skipIf(!resolveBundledClaudeExecutable())('inherits the current model for default and unconfigured agents while preserving explicit models across a warm SDK switch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'claude-subagent-model-'))
  const configDir = join(root, 'claude')
  await mkdir(join(configDir, 'agents'), { recursive: true })
  for (const [name, model] of [['pinned-model', 'custom-pinned-model'], ['unconfigured-model', undefined], ['inherited-model', 'inherit']]) {
    await writeFile(join(configDir, 'agents', `${name}.md`), `---\nname: ${name}\ndescription: Model selection regression fixture\n${model ? `model: ${model}\n` : ''}---\nReply OK without tools.\n`)
  }
  const agentNames = ['Explore', 'Plan', 'general-purpose', 'pinned-model', 'unconfigured-model', 'inherited-model', 'explicit-haiku']
  const children: { turn: string; agent: string; model: string }[] = []
  const launched = new Set<string>()
  const server = Fastify()
  server.post('/v1/messages/count_tokens', () => ({ input_tokens: 10 }))
  server.post('/v1/messages', (request, reply) => {
    const body = request.body as ModelRequest
    const child = /subagent-model-child:(\w+):([\w-]+)/u.exec(JSON.stringify(body.messages.find((message) => message.role === 'user')?.content))
    if (child) {
      children.push({ turn: child[1] ?? '', agent: child[2] ?? '', model: body.model })
      return modelMessage(body, reply, [{ type: 'text', text: 'OK' }], `child-${children.length}`)
    }
    const turn = /subagent-model-parent:(\w+)/u.exec(JSON.stringify(body.messages.filter((message) => message.role === 'user').at(-1)?.content))?.[1]
    if (turn && !launched.has(turn) && body.tools?.some((tool) => tool['name'] === 'Agent')) {
      launched.add(turn)
      return modelMessage(body, reply, agentNames.map((agent) => ({
        type: 'tool_use', id: `${turn}-${agent}`, name: 'Agent',
        input: { subagent_type: agent === 'explicit-haiku' ? 'general-purpose' : agent,
          description: `Check ${agent}`, prompt: `subagent-model-child:${turn}:${agent} Reply OK without tools.`,
          ...(agent === 'explicit-haiku' ? { model: 'haiku' } : {}) },
      })), `launch-${turn}`)
    }
    return modelMessage(body, reply, [{ type: 'text', text: 'Model checks complete.' }])
  })
  let runtime: ClaudeRuntime | undefined
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25000)
  try {
    await server.listen({ host: '127.0.0.1', port: 0 })
    const spec = testRunSpec({ cwd: root, model: 'custom-model-first',
      baseUrl: `http://127.0.0.1:${server.addresses()[0]?.port ?? 0}`, authToken: 'fixture-token' })
    let starts = 0
    runtime = new ClaudeRuntime(spec, { kind: 'new', provider: 'claude' }, configDir, (args) => {
      starts += 1
      return query({ ...args, options: { ...args.options, tools: ['Agent'], env: {
        ...args.options.env, CLAUDE_CONFIG_DIR: configDir,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
      } } })
    })
    for (const turn of ['first', 'second']) {
      await runtime.applyRunSpec({ ...spec, model: `custom-model-${turn}` })
      const events: AgentEvent[] = []
      for await (const event of runtime.run({ text: `subagent-model-parent:${turn}` }, { signal: controller.signal })) events.push(event)
      expect(events.some((event) => event.type === 'run.completed')).toBe(true)
      const turnChildren = () => children.filter((child) => child.turn === turn)
      await expect.poll(() => turnChildren().map((child) => child.agent).sort()).toEqual([...agentNames].sort())
      for (const child of turnChildren()) {
        expect(child.model).toEqual(child.agent === 'pinned-model' ? 'custom-pinned-model'
          : child.agent === 'explicit-haiku' ? expect.stringMatching(/^claude-haiku-/u) : `custom-model-${turn}`)
      }
    }
    expect(starts).toBe(1)
  } finally {
    clearTimeout(timeout)
    await runtime?.release('dispose')
    await server.close()
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
}, 30000)
