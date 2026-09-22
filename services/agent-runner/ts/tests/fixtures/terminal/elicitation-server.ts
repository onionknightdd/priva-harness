import { inputRequired, inputResponse, McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'

const server = new McpServer({ name: 'migrationForm', version: '1.0.0' })
server.registerTool('form', { inputSchema: z.object({}) }, (_input, request) => {
  const result = inputResponse(request.mcpReq.inputResponses, 'form')
  if (result.kind === 'missing') return inputRequired({ inputRequests: { form: inputRequired.elicit({ message: 'Choose the native test count', requestedSchema: {
    type: 'object', properties: { count: { type: 'integer', minimum: 1 }, enabled: { type: 'boolean' } }, required: ['count', 'enabled'],
  } }) } })
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
})
await server.connect(new StdioServerTransport())
