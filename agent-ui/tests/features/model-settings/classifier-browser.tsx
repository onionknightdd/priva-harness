import * as React from "react"
import { createRoot } from "react-dom/client"
import i18n from "../../../src/i18n"
import "../../../src/index.css"
import { ModelProfileEditor } from "../../../src/features/model-settings/model-profile-editor"
import type { ModelProfileSummary } from "../../../src/features/model-settings/model-profile-api"
import type { ProfileDraft } from "../../../src/features/model-settings/model-settings.types"

const host = document.querySelector<HTMLDivElement>("#page")!
const output = document.querySelector<HTMLPreElement>("#results")!
const params = new URLSearchParams(location.search)
document.documentElement.classList.toggle("dark", params.has("dark"))
await i18n.changeLanguage(params.has("zh") ? "zh-CN" : "en")
if (params.has("mobile") && !params.has("embed")) {
  const iframe = document.createElement("iframe")
  iframe.src = `${location.pathname}?${params.toString()}&embed`
  iframe.title = "390px classifier settings"
  iframe.style.cssText = "width:390px;height:1050px;border:1px solid #888"
  document.body.replaceChildren(iframe)
} else {
  const catalog = { imageUnderstanding: [], imageGeneration: [], imageEdit: [], classification: ["jev-latest"] }
  const profile: ModelProfileSummary = { id: "gateway", label: "Main connection", baseUrl: "https://gateway.example/v1", authTokenSet: true, modelCount: 2,
    defaultModel: "chat-model", imageUnderstandingModel: null, imageGenerationModel: null, imageEditModel: null,
    classifierApi: "typesafe-system-one", classifierModel: "jev-latest", classifierProfileId: "classification", modelCapabilities: catalog }
  const classifier = { ...profile, id: "classification", label: "Classification connection", baseUrl: "https://classifier.example" }
  const requests: Record<string, unknown>[] = []
  const fetchOriginal = window.fetch
  window.fetch = (input, init) => {
    if (String(input).includes("/api/sandbox/credentials/profiles/")) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      requests.push(body)
      return Promise.resolve(Response.json({ model_id: body.model_id, capability: body.capability, supported: true }))
    }
    return fetchOriginal(input, init)
  }
  let draft: ProfileDraft = { ...profile, authToken: "" }
  let saved: ProfileDraft | undefined
  function Fixture() {
    const [value, setValue] = React.useState(draft)
    draft = value
    return <ModelProfileEditor busyAction={null} canTest isCreating={false} isConnectionVerified isDefault={false} modelIds={["chat-model"]}
      draft={value} profile={profile} profiles={[profile, classifier]} profilesExist feedback={null} testFeedback={null} testStatus="idle"
      onCancel={() => {}} onDelete={() => {}} onSave={() => { saved = value }} onSetDefault={() => {}} onTest={() => {}}
      onCatalogChange={(modelCapabilities) => setValue((before) => ({ ...before, modelCapabilities }))}
      onDraftChange={(key, next) => setValue((before) => ({ ...before, [key]: next }))} />
  }
  createRoot(host).render(<Fixture />)
  const wait = () => new Promise((resolve) => setTimeout(resolve, 100))
  document.querySelector<HTMLButtonElement>("#run")!.onclick = async () => {
    const checks: string[] = []
    const check = (condition: unknown, name: string) => { if (!condition) throw new Error(name); checks.push(`PASS ${name}`) }
    try {
      await wait()
      const protocol = host.querySelector<HTMLElement>('[aria-labelledby="classifier-protocol-label"]')!
      const connection = host.querySelector<HTMLElement>('[aria-labelledby="classifier-connection-label"]')!
      const model = host.querySelector<HTMLInputElement>("#classifier-model")!
      check(protocol && connection && model, "Classification fields exist inside the existing editor")
      check(connection.textContent?.includes("Classification connection"), "Selected saved connection has its friendly label")
      check(model.value === "jev-latest", "Saved classifier model restored")
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(model, "custom-classifier")
      model.dispatchEvent(new Event("input", { bubbles: true }))
      await wait()
      check(draft.classifierModel === "custom-classifier", "Custom model ID accepted")
      const testButton = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === i18n.t("settings.models.classifierTest"))!
      testButton.click()
      for (let attempt = 0; attempt < 30 && !host.textContent?.includes(i18n.t("settings.models.supported")); attempt++) await wait()
      check(requests.at(-1)?.classifier_api === "typesafe-system-one", "Probe sends selected API")
      check(requests.at(-1)?.classifier_profile_id === "classification", "Probe sends selected connection")
      check(requests.at(-1)?.model_id === "custom-classifier", "Probe sends custom model ID")
      check(host.textContent?.includes(i18n.t("settings.models.supported")), "Probe success is visible")
      const save = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === i18n.t("settings.models.save"))!
      save.click()
      check(saved?.classifierModel === "custom-classifier" && saved.classifierProfileId === "classification", "Save preserves model and connection")
      const p = protocol.getBoundingClientRect(), c = connection.getBoundingClientRect()
      check(innerWidth < 640 ? c.top > p.bottom : Math.abs(c.top - p.top) < 2, innerWidth < 640 ? "Mobile connection fields use one column" : "Desktop connection fields use two columns")
      check(document.documentElement.scrollWidth <= innerWidth, "No horizontal overflow")
      output.textContent = `${checks.join("\n")}\n${checks.length} checks passed`
    } catch (error) { output.textContent = `${checks.join("\n")}\nFAIL ${String(error)}`; throw error }
  }
}
