import { readFile, writeFile, readlink, readdir } from 'node:fs/promises'
import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

const namespace = await readlink('/proc/self/ns/mnt')
const emit = (event) => console.log(JSON.stringify(event))
emit({ event: 'worker', pid: process.pid, uid: process.getuid(), namespace,
  cwd: process.cwd(), tenants: await readdir('/mnt/user'), root: await readdir('/') })

// Intentionally no path checks: the kernel, not a tool allowlist, must prevent
// access to another tenant. These handlers execute INSIDE the SDK worker.
const filesystem = createSdkMcpServer({
  name: 'probe', version: '1.0.0', alwaysLoad: true,
  tools: [
    tool('read_file', 'Read a file using Node fs', { path: z.string() },
      ({ path }) => access('read', path)),
    tool('write_file', 'Write a file using Node fs', { path: z.string(), content: z.string() },
      ({ path, content }) => access('write', path, content)),
  ],
})

async function access(operation, path, content) {
  emit({ event: 'mcp_call', operation, path, pid: process.pid,
    namespace: await readlink('/proc/self/ns/mnt') })
  try {
    const text = operation === 'read' ? await readFile(path, 'utf8')
      : (await writeFile(path, content), 'written')
    return { content: [{ type: 'text', text }] }
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR', 'EROFS', 'EACCES'].includes(error.code)) throw error
    return { isError: true, content: [{ type: 'text', text: `${error.code}: ${error.message}` }] }
  }
}

for await (const message of query({
  prompt: 'Execute the filesystem verification tool calls supplied by the test endpoint.',
  options: {
    cwd: process.cwd(), model: 'claude-sonnet-4-6',
    tools: ['Bash', 'Read', 'Write'], mcpServers: { probe: filesystem },
    permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true,
    sandbox: { enabled: false }, settingSources: [], persistSession: false,
    maxTurns: 50,
    stderr: (text) => process.stderr.write(text),
  },
})) {
  if (message.type === 'system' && message.subtype === 'init') {
    emit({ event: 'sdk_init' })
  }
  if (message.type === 'user' && Array.isArray(message.message.content)) {
    for (const block of message.message.content) {
      if (block.type === 'tool_result') emit({ event: 'tool_result', ...block })
    }
  }
  if (message.type === 'result') {
    emit({ event: 'result', subtype: message.subtype, permission_denials: message.permission_denials })
    if (message.subtype !== 'success') throw new Error(JSON.stringify(message))
  }
}
