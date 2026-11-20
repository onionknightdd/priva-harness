import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const launcher = fileURLToPath(new URL('../../../../../src/resources/plugins/computer-use/mcp/cua-repl.mjs', import.meta.url))
const worker = fileURLToPath(new URL('../../../../fixtures/resources/confirming-mcp-server.ts', import.meta.url))

describe('computer-use cua_repl launcher', () => {
  let runtime: string
  let packageDir: string

  // A stand-in runtime: the package's environment builder, and a worker that confirms before acting.
  beforeEach(async () => {
    runtime = await mkdtemp(join(tmpdir(), 'priva-cua-launcher-'))
    packageDir = join(runtime, 'lib', 'node_modules', '@oai', 'cua-repl')
    await mkdir(join(packageDir, 'instructions'), { recursive: true })
    await mkdir(join(runtime, 'bin'))
    await writeFile(join(packageDir, 'package.json'), JSON.stringify({
      name: '@oai/cua-repl', type: 'module', exports: { './environment': './environment.js' },
    }))
    await writeFile(join(packageDir, 'environment.js'), `export function create_launch_environment({ env, instructions_directory, platform }) {
  return { ...env, NODE_REPL_JS_COMPLETION_SUMMARY: 'enabled', FIXTURE_PLATFORM: platform, FIXTURE_INSTRUCTIONS: String(instructions_directory) }
}
`)
    await writeFile(join(runtime, 'bin', 'node_repl'), `#!/bin/sh
printf '%s|%s|%s|%s|%s|%s' "\${NODE_REPL_JS_COMPLETION_SUMMARY-unset}" "$FIXTURE_PLATFORM" "$FIXTURE_INSTRUCTIONS" \\
  "$CUA_REPL_ENABLED_SURFACES" "$NODE_REPL_NODE_PATH" "$NODE_REPL_TRUSTED_CODE_PATHS" > "${join(runtime, 'launch.txt')}"
exec "${process.execPath}" --import "${createRequire(import.meta.url).resolve('tsx')}" "${worker}"
`, { mode: 0o755 })
  })
  afterEach(async () => { await rm(runtime, { recursive: true, force: true }) })

  /** A host that announces no elicitation support and has no handler for it, like Pi. */
  async function callTools(args: string[], tools: string[]): Promise<{ text: string; isError: boolean }[]> {
    const transport = new StdioClientTransport({ command: process.execPath, args, stderr: 'pipe' })
    const client = new Client({ name: 'no-confirmation-host', version: '1.0.0' })
    try {
      await client.connect(transport)
      const results = []
      for (const name of tools) {
        const result = await client.callTool({ name, arguments: {} })
        const content = result.content as { type: string; text?: string }[]
        results.push({ text: content.map((part) => part.text ?? '').join('\n'), isError: result.isError === true })
      }
      return results
    } finally {
      await client.close()
      await transport.close()
    }
  }

  it('starts the worker from the package environment, with its paths taken from the runtime and no completion summary', async () => {
    await callTools([launcher, runtime], [])
    expect(await readFile(join(runtime, 'launch.txt'), 'utf8')).toBe([
      'unset', process.platform, pathToFileURL(join(packageDir, 'instructions') + '/').href,
      'computer', join(runtime, 'bin', 'node'), join(runtime, 'lib', 'node_modules'),
    ].join('|'))
  })

  it('accepts the worker\'s yes-or-no confirmations and leaves requests for values to the host', async () => {
    const [confirmed, form] = await callTools([launcher, runtime], ['confirm', 'form'])
    // Empty content and nothing else: no value the worker could store as a standing approval.
    expect(confirmed).toEqual({ text: JSON.stringify({ result: { action: 'accept', content: {} } }), isError: false })
    const answer = JSON.parse(form?.text ?? '{}') as { result?: unknown; error?: { code?: number } }
    expect(answer.result).toBeUndefined()
    expect(answer.error?.code).toBe(-32601)
  })

  it('shows that the same worker fails such a host when nothing answers for it', async () => {
    const direct = ['--import', createRequire(import.meta.url).resolve('tsx'), worker]
    expect(await callTools(direct, ['confirm'])).toEqual([{ text: 'The MCP client does not support form elicitation', isError: true }])
  })

  it('exits with a usage error when no runtime directory is given', async () => {
    const transport = new StdioClientTransport({ command: process.execPath, args: [launcher], stderr: 'pipe' })
    await expect(new Client({ name: 'no-runtime', version: '1.0.0' }).connect(transport)).rejects.toThrow()
    await transport.close()
  })
})
