import { useCallback, useEffect, useState } from "react"
import { MotionConfig } from "motion/react"
import { I18nextProvider, initReactI18next } from "react-i18next"
import i18next from "i18next"
import { en } from "../../src/i18n/locales/en"
import { WorkflowOverview } from "../../src/features/agent-message/components/workflow-overview"
import type { LoadWorkflowAgent } from "../../src/features/agent-message/components/workflow-agent-detail"
import { WorkspaceShell } from "../../src/features/workspace/workspace-shell"
import { useWorkspaceWorkflow } from "../../src/features/workspace/use-workspace-workflow"
import { Button } from "../../src/components/ui/button"
import type { WorkflowAgent, WorkflowCard } from "../../src/features/agent-message/workflow-data"
import { workflowFixture } from "./workflow"

const i18n = i18next.createInstance()
void i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en } } })

export function WorkflowPreview() {
  const [workflow, setWorkflow] = useState<WorkflowCard>(workflowFixture)
  const [dark, setDark] = useState(false)
  const [reduce, setReduce] = useState(false)
  const [failDetail, setFailDetail] = useState(false)
  const [mount, setMount] = useState(0)
  const load = useCallback(async (agent: WorkflowAgent, signal: AbortSignal) => {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(resolve, 300)
      signal.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")) }, { once: true })
    })
    if (failDetail) throw new Error("Fixture detail failure")
    return { process: [{ id: "thinking-0", kind: "thinking" as const, text: "Inspect the existing authentication flow before updating the session lookup." }, { id: "structured-output", kind: "tool" as const, name: "StructuredOutput", text: '{"accepted":false}' }, ...Array.from({ length: 8 }, (_, index) => ({ id: `tool-${index}`, kind: "tool" as const, name: "Read", text: JSON.stringify({ path: `src/auth-${index}.ts` }), output: "export const auth = createSessionAuth()" }))], prompt: `Full prompt for ${agent.label}.`, result: JSON.stringify({ accepted: false, reason: "A rejected proposal is a successful execution." }, null, 2) }
  }, [failDetail])
  return (
    <I18nextProvider i18n={i18n}>
      <MotionConfig reducedMotion={reduce ? "always" : "user"}>
        <main className={`${dark ? "dark" : ""} flex h-screen flex-col bg-background p-4 text-foreground sm:p-8`}>
          <div className="mb-6 flex shrink-0 flex-wrap gap-2">
            <Button onClick={() => { setWorkflow(workflowFixture); setMount((value) => value + 1) }}>Reset live</Button>
            <Button onClick={() => setWorkflow((value) => ({ ...value, agents: [...value.agents, { index: value.agents.length + 1, label: "Dynamic agent", phaseIndex: 3, state: "running", agentId: "dynamic" }] }))}>Add agent</Button>
            <Button onClick={() => setWorkflow((value) => ({ ...value, status: "completed", agents: value.agents.map((agent) => ({ ...agent, state: "completed" })) }))}>Complete</Button>
            <Button onClick={() => setWorkflow((value) => ({ ...value, status: "failed", agents: value.agents.map((agent) => ({ ...agent, state: agent.index === 4 ? "failed" : agent.state === "pending" ? "unknown" : agent.state })) }))}>Fail</Button>
            <Button onClick={() => { setWorkflow({ ...workflowFixture, status: "unknown", phases: [], agents: [], detailsUnavailable: true }); setMount((value) => value + 1) }}>Missing snapshot</Button>
            <Button aria-pressed={dark} onClick={() => setDark((value) => !value)}>Dark theme</Button>
            <Button aria-pressed={reduce} onClick={() => setReduce((value) => !value)}>Reduced motion</Button>
            <Button aria-pressed={failDetail} onClick={() => setFailDetail((value) => !value)}>Detail error</Button>
          </div>
          <div className="min-h-0 flex-1">
            <WorkspaceShell><PreviewMessage key={mount} workflow={workflow} loadDetail={load} /></WorkspaceShell>
          </div>
        </main>
      </MotionConfig>
    </I18nextProvider>
  )
}

function PreviewMessage({ workflow, loadDetail }: { workflow: WorkflowCard; loadDetail: LoadWorkflowAgent }) {
  const { openWorkflow, syncWorkflows } = useWorkspaceWorkflow()
  useEffect(() => { syncWorkflows("fixture", [workflow]) }, [workflow, syncWorkflows])
  return <div className="min-w-0 overflow-auto px-2"><WorkflowOverview workflow={workflow} onOpenAgent={(agentIndex) => openWorkflow({ sourceKey: "fixture", workflow, agentIndex, loadDetail: (_runId, agent, signal) => loadDetail(agent, signal) })} /></div>
}
