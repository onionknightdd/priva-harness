export const workflowLaunch = {
  status: 'async_launched', taskId: 'task-one', runId: 'wf_test',
  workflowName: 'two-stage-test', summary: 'Generate and verify two proposals',
}

export const workflowSnapshot = {
  ...workflowLaunch,
  status: 'completed', durationMs: 14000, totalTokens: 200, totalToolCalls: 4,
  phases: [
    { title: 'Generate', detail: 'Two proposals in parallel' },
    { title: 'Verify', detail: 'Review the proposals' },
  ],
  workflowProgress: [
    { type: 'workflow_phase', index: 1, title: 'Generate' },
    { type: 'workflow_phase', index: 2, title: 'Verify' },
    ...[1, 2, 3, 4].map((index) => ({
      type: 'workflow_agent', index, agentId: `agent${String(index)}`,
      label: `Agent ${String(index)}`, phaseIndex: index < 3 ? 1 : 2,
      state: 'done', model: 'test-model', durationMs: 2000,
      lastToolName: 'StructuredOutput', promptPreview: 'Review a proposal…',
      resultPreview: index === 3 ? '{"accepted":false}' : '{"accepted":true}',
    })),
  ],
}

export const workflowTranscript = [
  { type: 'user', uuid: 'u1', timestamp: '2026-09-05T10:00:00Z', message: { role: 'user', content: 'Test a workflow' } },
  { type: 'assistant', uuid: 'a1', timestamp: '2026-09-05T10:00:01Z', message: { role: 'assistant',
    content: [{ type: 'tool_use', id: 'tool-one', name: 'Workflow', input: { script: 'not evaluated' } }] } },
  { type: 'user', uuid: 'r1', timestamp: '2026-09-05T10:00:02Z', toolUseResult: workflowLaunch,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-one', content: 'Workflow launched in background.' }] } },
  { type: 'assistant', uuid: 'a2', timestamp: '2026-09-05T10:00:03Z', message: { role: 'assistant', content: [{ type: 'text', text: 'The workflow is running.' }] } },
  { type: 'user', uuid: 'u2', timestamp: '2026-09-05T10:00:04Z', message: { role: 'user', content: 'Another turn' } },
  { type: 'assistant', uuid: 'a3', timestamp: '2026-09-05T10:00:05Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Another answer.' }] } },
  { type: 'user', uuid: 'notice', origin: { kind: 'task-notification' }, timestamp: '2026-09-05T10:00:14Z', message: { role: 'user',
    content: '<task-notification>\n<task-id>task-one</task-id>\n<tool-use-id>tool-one</tool-use-id>\n<status>completed</status>\n<summary>Dynamic workflow completed</summary>\n</task-notification>' } },
]
