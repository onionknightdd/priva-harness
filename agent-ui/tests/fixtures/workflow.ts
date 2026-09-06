import type { WorkflowCard } from "../../src/features/agent-message/workflow-data"

export const workflowFixture: WorkflowCard = {
  workflowToolUseId: "fixture-tool",
  workflowRunId: "wf_fixture",
  name: "Agent Workflow Pipeline",
  summary: "Refactoring authentication module · JWT to session tokens",
  status: "running",
  phases: [
    { index: 1, title: "Plan", detail: "Analyze requirements" },
    { index: 2, title: "Execute", detail: "Apply code changes" },
    { index: 3, title: "Validate", detail: "Run tests and checks" },
    { index: 4, title: "Deploy", detail: "Ship to production" },
  ],
  agents: [
    { index: 1, phaseIndex: 1, label: "Parse user intent", lastToolSummary: "Extract key requirements from the prompt", lastToolName: "intent_parser", durationMs: 800, state: "completed", agentId: "a1" },
    { index: 2, phaseIndex: 1, label: "Search codebase", lastToolSummary: "Find relevant files and dependencies", lastToolName: "code_search", durationMs: 2100, state: "completed", agentId: "a2" },
    { index: 3, phaseIndex: 2, label: "Generate migration", lastToolSummary: "Create schema and token migration scripts", lastToolName: "StructuredOutput", durationMs: 3200, state: "completed", agentId: "a3" },
    { index: 4, phaseIndex: 2, label: "Update auth middleware", lastToolSummary: "Replace JWT verification with session lookup", lastToolName: "file_editor", state: "running", agentId: "a4" },
    { index: 5, phaseIndex: 3, label: "Unit tests", lastToolSummary: "Run the auth module test suite", lastToolName: "test_runner", state: "pending", agentId: "a5" },
    { index: 6, phaseIndex: 4, label: "Create pull request", lastToolSummary: "Open a PR with migration notes and changelog", state: "pending", agentId: "a6" },
  ],
}
