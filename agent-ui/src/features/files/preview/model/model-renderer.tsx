import * as React from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"
import { useTheme } from "next-themes"
import { CameraIcon, ChevronDownIcon, MessageSquarePlusIcon, MousePointer2Icon, PauseIcon, PlayIcon, RulerIcon, ScissorsIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/motion/switch"
import { TooltipHint } from "@/components/ui/tooltip"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useOptionalWorkspaceFiles } from "@/features/workspace/workspace-files-context"
import type { ModelAnchor, ModelFileAnnotation } from "@/features/agent-message/file-annotation"
import type { PreviewFile } from "@/features/files/model/file.types"
import { cn } from "@/lib/utils"
import { inspectModel, modelAssetUrl, type ModelSourceContext } from "./model-asset"
import { shouldStreamPointCloud } from "./model-pointcloud"
import { loadModel } from "./model-loader"
import { ModelScene } from "./model-scene"
import { METERS_PER_UNIT, displayDistance, measurementValue, type ModelUnits } from "./model-measurement"
import { ModelSelect, ModelSlider } from "./model-controls"
import { ModelConversionRequiredError, type LoadedModel, type ModelMetadata, type ModelProgress } from "./model-types"

type Tool = "select" | "distance" | "angle" | "clip" | "points"
export type ModelViewState = { revision: string; view: ModelFileAnnotation["view"]; units: ModelUnits }
const unknownUnits: ModelUnits = { metersPerUnit: null, source: "unknown", displayUnit: "model" }

export function ModelRenderer({ file, active = true, sourceContext, viewStates }: {
  file: PreviewFile; active?: boolean; sourceContext?: ModelSourceContext; viewStates?: Map<string, ModelViewState>
}) {
  const { t } = useTranslation()
  const label = (key: string) => t(`modelPreview.${key}`)
  const translate = React.useRef(t)
  translate.current = t
  const { resolvedTheme } = useTheme()
  const reducedMotion = useReducedMotion()
  const workspace = useOptionalWorkspaceFiles()
  const host = React.useRef<HTMLDivElement>(null)
  const scene = React.useRef<ModelScene | null>(null)
  const abort = React.useRef<AbortController | null>(null)
  const canonicalPath = React.useRef(file.path)
  const sourceKey = JSON.stringify(sourceContext ?? { kind: "file", path: file.path })
  const source = React.useMemo(() => JSON.parse(sourceKey) as ModelSourceContext, [sourceKey])
  const [attempt, setAttempt] = React.useState(0)
  const [status, setStatus] = React.useState<"loading" | "ready" | "error" | "cancelled">("loading")
  const [error, setError] = React.useState("")
  const [notice, setNotice] = React.useState("")
  const [progress, setProgress] = React.useState<ModelProgress>({ phase: "download" })
  const [metadata, setMetadata] = React.useState<ModelMetadata | null>(null)
  const [revision, setRevision] = React.useState("")
  const [tool, setTool] = React.useState<Tool>("select")
  const [panel, setPanel] = React.useState(false)
  const [anchors, setAnchors] = React.useState<ModelAnchor[]>([])
  const [units, setUnits] = React.useState<ModelUnits>(unknownUnits)
  const unitsRef = React.useRef(units)
  unitsRef.current = units
  const [question, setQuestion] = React.useState("")
  const [includeScreenshot, setIncludeScreenshot] = React.useState(true)
  const [sending, setSending] = React.useState(false)
  const [pointBudget, setPointBudget] = React.useState(2_000_000)
  const [displayedPoints, setDisplayedPoints] = React.useState(0)
  const [clipping, setClipping] = React.useState<ModelFileAnnotation["view"]["clipping"]>()
  const [clipAxis, setClipAxis] = React.useState("z")
  const [clipPosition, setClipPosition] = React.useState(50)
  const [clipReverse, setClipReverse] = React.useState(false)
  const [pointSize, setPointSize] = React.useState(2)
  const [pointColor, setPointColor] = React.useState("original")
  const [animated, setAnimated] = React.useState(false)
  const [playing, setPlaying] = React.useState(false)
  const pointer = React.useRef<{ id: number; x: number; y: number; cancelled: boolean } | null>(null)
  const nextSelectionIndex = React.useRef(1)
  const activeRef = React.useRef(active)
  activeRef.current = active

  React.useEffect(() => {
    const container = host.current
    if (!container) return
    const controller = new AbortController()
    abort.current = controller
    let viewport: ModelScene | null = null
    let loaded: LoadedModel | null = null
    let loadedMetadata: ModelMetadata | null = null
    let loadedRevision = ""
    setStatus("loading"); setError(""); setNotice(""); setAnchors([]); setMetadata(null); setClipping(undefined); setPlaying(false); setAnimated(false)
    const lost = (event: Event) => { event.preventDefault(); setError(translate.current("modelPreview.webglLost")); setStatus("error") }
    const reportProgress = (value: ModelProgress) => { if (!controller.signal.aborted) setProgress(value) }
    const saveView = () => {
      if (viewport && loadedRevision && viewStates) viewStates.set(file.id, { revision: loadedRevision, view: viewport.view(), units: unitsRef.current })
    }
    const run = async () => {
      const inspection = await inspectModel(source, controller.signal)
      controller.signal.throwIfAborted()
      canonicalPath.current = inspection.path
      const openCloud = async () => {
        // The point-cloud adapter owns its renderer and streaming lifecycle.
        const { openPointCloudScene } = await import("./model-pointcloud-scene")
        const result = await openPointCloudScene(container, source, inspection, controller.signal, reportProgress, saveView, (reason) => { if (!controller.signal.aborted) { setError(reason.message); setStatus("error"); viewport?.setVisible(false) } })
        if (controller.signal.aborted) { result.scene.dispose(); controller.signal.throwIfAborted() }
        viewport = result.scene
        loadedRevision = result.revision
        loadedMetadata = result.metadata
        setMetadata(result.metadata)
      }
      if (await shouldStreamPointCloud(source, inspection, controller.signal)) await openCloud()
      else {
        viewport = new ModelScene(container, undefined, saveView)
        viewport.setVisible(activeRef.current)
        try {
          loaded = await loadModel({ name: file.name, url: modelAssetUrl(source), resourceUrl: (uri) => modelAssetUrl(source, uri), signal: controller.signal, renderer: viewport.renderer, onProgress: reportProgress })
          if (controller.signal.aborted) { viewport.dispose(); loaded.dispose(); loaded = null; return }
          viewport.setModel(loaded)
          loadedRevision = loaded.revision
          loadedMetadata = loaded.metadata
          setMetadata(loaded.metadata)
          setAnimated(loaded.animations.length > 0)
        } catch (reason) {
          if (!(reason instanceof ModelConversionRequiredError)) throw reason
          viewport.dispose(); viewport = null
          await openCloud()
        }
      }
      if (!viewport) return
      if (controller.signal.aborted) { viewport.dispose(); viewport = null; return }
      scene.current = viewport
      viewport.renderer.domElement.addEventListener("webglcontextlost", lost)
      viewport.setTheme()
      viewport.setVisible(activeRef.current)
      const saved = viewStates?.get(file.id)
      if (saved?.revision === loadedRevision) {
        viewport.restore(saved.view); setUnits(saved.units); setClipping(saved.view.clipping)
      } else {
        const unit = loadedMetadata?.unit
        setUnits(unit ? { ...unit, displayUnit: unit.metersPerUnit === 1 ? "m" : unit.metersPerUnit === 0.001 ? "mm" : "model" } : unknownUnits)
      }
      setRevision(loadedRevision)
      setStatus("ready")
    }
    void run().catch((reason: unknown) => {
      const failedViewport = viewport
      failedViewport?.dispose()
      if (scene.current === failedViewport) scene.current = null
      viewport = null
      loaded?.dispose(); loaded = null
      if (controller.signal.aborted) return
      setError(reason instanceof Error ? reason.message : String(reason)); setStatus("error")
    })
    return () => {
      controller.abort()
      saveView()
      viewport?.renderer.domElement.removeEventListener("webglcontextlost", lost)
      viewport?.dispose()
      loaded?.dispose()
      if (scene.current === viewport) scene.current = null
    }
    // Language/theme changes must preserve the loaded scene and its GPU resources.
  }, [source, file.id, file.name, file.revision, file.previewGeneration, attempt, viewStates])

  React.useEffect(() => { scene.current?.setVisible(active); if (!active) pointer.current = null }, [active])
  React.useEffect(() => { scene.current?.setTheme() }, [resolvedTheme])
  React.useEffect(() => { scene.current?.setClip(clipping ?? null) }, [clipping, status])
  React.useEffect(() => {
    if (!clipping || !metadata) return
    const index = clipping.normal.reduce((best, value, axis) => Math.abs(value) > Math.abs(clipping.normal[best]) ? axis : best, 0)
    const normal = clipping.normal[index]
    const min = metadata.bounds.min.toArray()[index] + metadata.origin[index]
    const span = metadata.bounds.max.toArray()[index] + metadata.origin[index] - min
    setClipAxis(["x", "y", "z"][index])
    setClipReverse(normal < 0)
    setClipPosition(span ? Math.max(0, Math.min(100, (-clipping.constant / normal - min) / span * 100)) : 50)
  }, [clipping, metadata])
  React.useEffect(() => { scene.current?.showAnchors(anchors); scene.current?.select(tool === "select" ? anchors[0] ?? null : null) }, [anchors, tool, status])
  React.useEffect(() => { scene.current?.setPlaying(playing && active) }, [playing, active])
  React.useEffect(() => { scene.current?.setPointSize(pointSize) }, [pointSize, status])
  React.useEffect(() => { scene.current?.setPointColor(pointColor as "original" | "solid" | "height") }, [pointColor, status])
  React.useEffect(() => { scene.current?.setPointBudget(pointBudget) }, [pointBudget, status])
  React.useEffect(() => {
    if (!active || status !== "ready" || metadata?.kind !== "pointcloud") return
    const update = () => setDisplayedPoints(scene.current?.displayedPointCount() ?? metadata.pointCount)
    update()
    if (metadata.format !== "copc") return
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [active, status, metadata])

  const pending = workspace?.pendingAnnotation
  React.useEffect(() => {
    if (status !== "ready" || pending?.kind !== "model" || (pending.filePath !== file.path && pending.filePath !== canonicalPath.current) || !scene.current) return
    if (pending.fileRevision !== revision) setNotice(t("modelPreview.stale"))
    else {
      scene.current.restore(pending.view)
      setUnits(pending.units); setClipping(pending.view.clipping); setAnchors(pending.selection.anchors)
      setTool(pending.selection.kind === "distance" || pending.selection.kind === "angle" ? pending.selection.kind : "select"); setPanel(true)
    }
    workspace?.clearPendingAnnotation(pending.selectionId)
  }, [pending, status, revision, file.path, workspace, t])

  const changeTool = (next: Tool) => { scene.current?.setPlaying(false); setPlaying(false); setTool(next); setPanel(true); setAnchors([]); pointer.current = null; setNotice("") }
  const takePoint = (event: React.PointerEvent) => {
    const down = pointer.current
    pointer.current = null
    if (!down || down.id !== event.pointerId || down.cancelled || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5 || !["select", "distance", "angle"].includes(tool)) return
    const anchor = scene.current?.pick(event.clientX, event.clientY)
    if (!anchor) return
    scene.current?.setPlaying(false); setPlaying(false)
    const count = tool === "angle" ? 3 : tool === "distance" ? 2 : 1
    setAnchors((current) => current.length >= count ? [anchor] : [...current, anchor]); setPanel(true); setNotice("")
  }
  const updateClip = (enabled: boolean, axis = clipAxis, position = clipPosition, reverse = clipReverse) => {
    setClipAxis(axis); setClipPosition(position); setClipReverse(reverse)
    if (!enabled || !metadata) { setClipping(undefined); return }
    const index = axis === "x" ? 0 : axis === "y" ? 1 : 2
    const min = metadata.bounds.min.toArray()[index] + metadata.origin[index]
    const max = metadata.bounds.max.toArray()[index] + metadata.origin[index]
    const sign = reverse ? -1 : 1
    const normal: [number, number, number] = [0, 0, 0]; normal[index] = sign
    setClipping({ normal, constant: -(min + (max - min) * position / 100) * sign })
  }
  const measurement = tool === "distance" || tool === "angle" ? measurementValue(anchors, tool) : null
  const formattedMeasurement = measurement === null ? "" : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 5 }).format(tool === "distance" ? displayDistance(measurement, units) : measurement)} ${tool === "angle" ? "°" : units.displayUnit === "model" || units.metersPerUnit === null ? label("modelUnit") : units.displayUnit}`
  const saveScreenshot = async () => {
    try {
      const blob = await scene.current?.screenshot()
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a"); link.href = url; link.download = `${file.name}.png`; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch { setNotice(label("screenshotFailed")) }
  }
  const addToChat = async () => {
    if (!scene.current || !workspace || !anchors.length) return
    const currentScene = scene.current
    const kind = tool === "distance" || tool === "angle" ? tool : "object"
    if ((kind === "distance" || kind === "angle") && measurement === null) return
    const annotation: ModelFileAnnotation = {
      kind: "model", filePath: canonicalPath.current, fileRevision: revision, selectionId: crypto.randomUUID(), index: nextSelectionIndex.current++, selectedText: formattedMeasurement || label("selection"), coordinateSpace: "model-world", units,
      selection: { kind, anchors, ...(kind === "distance" ? { distance: measurement! } : kind === "angle" ? { angle: measurement! } : {}) },
      view: scene.current.view(),
    }
    setSending(true)
    try {
      if (includeScreenshot && workspace.canAttachFiles) {
        const blob = await currentScene.screenshot()
        if (scene.current !== currentScene) return
        if (!workspace.addAttachmentFiles([new File([blob], `${file.name}.png`, { type: "image/png" })])) { setNotice(label("sendFailed")); return }
      }
      const inserted = workspace.insertFileAnnotation(annotation, question.trim() || label("askDefault"))
      setNotice(label(inserted ? "sent" : "sendFailed"))
      if (inserted) setQuestion("")
    } catch { setNotice(label("screenshotFailed")) }
    finally { setSending(false) }
  }
  const ready = status === "ready"
  const toolOptions: Tool[] = ["select", "distance", "angle", "clip", ...(metadata?.kind === "pointcloud" ? ["points" as const] : [])]
  const unitOptions = Object.keys(METERS_PER_UNIT).map((value) => ({ value, label: value === "model" ? label("unknown") : value }))
  const stage = progress.phase === "download" ? label("downloadPhase") : label(progress.phase)
  const progressText = progress.total ? ` ${Math.min(100, Math.round((progress.loaded ?? 0) / progress.total * 100))}%` : ""

  return <div data-model-preview data-model-status={status} className="@container/model flex h-full min-h-0 min-w-0 flex-col bg-card text-card-foreground">
    <div role="toolbar" aria-label={label("title")} className="flex min-h-10 shrink-0 items-center gap-1 border-b px-2 py-1">
      <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="sm" disabled={!ready} />}>{label("view")}<ChevronDownIcon /></DropdownMenuTrigger>
        <DropdownMenuContent>{(["fit", "front", "top", "right"] as const).map((view) => <DropdownMenuItem key={view} onClick={() => scene.current?.fit(view)}>{label(view)}</DropdownMenuItem>)}</DropdownMenuContent>
      </DropdownMenu>
      <div className="hidden items-center gap-1 @min-[640px]/model:flex">
        {toolOptions.map((item) => <Button key={item} size="sm" variant={tool === item && panel ? "secondary" : "ghost"} aria-pressed={tool === item && panel} disabled={!ready} onClick={() => changeTool(item)}>{item === "select" ? <MousePointer2Icon /> : item === "clip" ? <ScissorsIcon /> : item === "distance" ? <RulerIcon /> : null}{label(item)}</Button>)}
      </div>
      <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="@min-[640px]/model:hidden" disabled={!ready} />}>{label("tools")}<ChevronDownIcon /></DropdownMenuTrigger>
        <DropdownMenuContent>{toolOptions.map((item) => <DropdownMenuItem key={item} onClick={() => changeTool(item)}>{label(item)}</DropdownMenuItem>)}</DropdownMenuContent>
      </DropdownMenu>
      <span className="flex-1" />
      {animated && <TooltipHint content={label(playing ? "pause" : "play")}><Button size="icon-sm" variant="ghost" aria-label={label(playing ? "pause" : "play")} onClick={() => setPlaying(!playing)}>{playing ? <PauseIcon /> : <PlayIcon />}</Button></TooltipHint>}
      <TooltipHint content={label("screenshot")}><Button size="icon-sm" variant="ghost" disabled={!ready} aria-label={label("screenshot")} onClick={() => void saveScreenshot()}><CameraIcon /></Button></TooltipHint>
      {workspace && <TooltipHint content={label("ask")}><Button size="sm" variant="ghost" disabled={sending || !ready || !anchors.length || ((tool === "distance" || tool === "angle") && measurement === null)} onClick={() => void addToChat()} aria-label={label("ask")}><MessageSquarePlusIcon /><span className="hidden @min-[640px]/model:inline">{label("ask")}</span></Button></TooltipHint>}
    </div>
    <div className="relative flex min-h-0 flex-1 flex-col @min-[640px]/model:flex-row">
      <div className="relative min-h-32 min-w-0 flex-1">
        <div ref={host} className="absolute inset-0 bg-muted outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" role="application" aria-label={`${label("title")}. ${label("navigateHint")}`} tabIndex={ready ? 0 : -1}
          onPointerDown={(event) => { if (pointer.current) { pointer.current.cancelled = true; return }; if (event.button === 0) pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, cancelled: false } }}
          onPointerMove={(event) => { const down = pointer.current; if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) down.cancelled = true }}
          onPointerUp={takePoint} onPointerCancel={() => { pointer.current = null }}
          onKeyDown={(event) => { if (event.key === "Escape") { setAnchors([]); setPanel(false) } else if (event.key === "Home") { event.preventDefault(); scene.current?.fit() } else if (event.key === "+" || event.key === "=") { event.preventDefault(); scene.current?.zoom(0.8) } else if (event.key === "-") { event.preventDefault(); scene.current?.zoom(1.25) } }} />
        {!ready && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/90 p-6 text-center text-sm">
          <p role={status === "error" ? "alert" : "status"}>{status === "error" ? error : status === "cancelled" ? label("cancelled") : `${stage}${progressText}`}</p>
          <div className="flex gap-2">{status === "loading" ? <Button size="sm" variant="outline" onClick={() => { abort.current?.abort(); setStatus("cancelled") }}>{label("cancel")}</Button> : <Button size="sm" variant="outline" onClick={() => setAttempt((value) => value + 1)}>{label("retry")}</Button>}
            <Button size="sm" variant="ghost" render={<a href={modelAssetUrl(source)} download={file.name} />}>{label("download")}</Button>
          </div>
        </div>}
        {ready && formattedMeasurement && <output className="pointer-events-none absolute bottom-3 left-3 rounded-md border bg-background/90 px-3 py-1.5 text-sm font-medium tabular-nums">{formattedMeasurement}</output>}
      </div>
      <AnimatePresence>{ready && panel && <motion.aside aria-label={label(tool)} initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : 0.16 }} className="max-h-[45%] shrink-0 space-y-3 overflow-auto border-t bg-card p-3 @min-[640px]/model:max-h-none @min-[640px]/model:w-56 @min-[640px]/model:border-t-0 @min-[640px]/model:border-l">
        <div className="flex items-center justify-between text-sm font-medium"><span>{label(tool)}</span><Button size="icon-xs" variant="ghost" aria-label={label("close")} onClick={() => setPanel(false)}><XIcon /></Button></div>
        {tool === "clip" ? <>
          <label className="flex items-center justify-between gap-2 text-xs">{label("clipEnabled")}<Switch size="sm" checked={Boolean(clipping)} onCheckedChange={(checked) => updateClip(checked)} /></label>
          <ModelSelect label={label("axis")} value={clipAxis} options={["x", "y", "z"].map((value) => ({ value, label: value.toUpperCase() }))} onChange={(value) => updateClip(true, value)} />
          <ModelSlider label={label("position")} min={0} max={100} step={0.1} value={clipPosition} onChange={(value) => updateClip(true, clipAxis, value)} />
          <Button size="sm" variant="outline" aria-pressed={clipReverse} onClick={() => updateClip(true, clipAxis, clipPosition, !clipReverse)}>{label("reverse")}</Button>
        </> : tool === "points" ? <>
          <ModelSlider label={label("pointSize")} min={1} max={10} step={0.5} value={pointSize} onChange={setPointSize} />
          {metadata?.format === "copc" && <ModelSlider label={label("budget")} min={100_000} max={4_000_000} step={100_000} value={pointBudget} onChange={setPointBudget} />}
          <ModelSelect label={label("color")} value={pointColor} options={["original", "solid", "height"].map((value) => ({ value, label: label(value) }))} onChange={setPointColor} />
        </> : <>
          {anchors.length ? <div className="space-y-2 text-xs"><p className="text-muted-foreground">{label("sourceCoordinates")}</p>{anchors.map((anchor, index) => <p key={index} className="break-all font-mono tabular-nums">{String.fromCharCode(65 + index)}: {anchor.position.map((value) => Number(value.toPrecision(10))).join(", ")}</p>)}{formattedMeasurement && <p className="font-medium">{formattedMeasurement}</p>}</div> : <p className="text-xs text-muted-foreground">{label(tool === "select" ? "noSelection" : tool === "angle" ? "angleHint" : "distanceHint")}</p>}
          {tool === "select" && metadata?.kind !== "pointcloud" && <div className="flex flex-wrap gap-1">{(["hide", "isolate", "showAll"] as const).map((action) => <Button key={action} size="xs" variant="outline" disabled={action !== "showAll" && !anchors.length} onClick={() => scene.current?.setObjectVisibility(anchors[0]?.locator.sourceNodePath ?? [], action)}>{label(action)}</Button>)}</div>}
          <ModelSelect label={label("unit")} value={units.metersPerUnit === null ? "model" : units.displayUnit} disabled={units.metersPerUnit === null} options={unitOptions} onChange={(value) => setUnits((current) => ({ ...current, displayUnit: value as ModelUnits["displayUnit"] }))} />
          {metadata?.unit.source === "unknown" && <ModelSelect label={label("sourceUnit")} value={Object.entries(METERS_PER_UNIT).find(([key, scale]) => key !== "model" && scale === units.metersPerUnit)?.[0] ?? "model"} options={unitOptions} onChange={(value) => setUnits({ metersPerUnit: value === "model" ? null : METERS_PER_UNIT[value as keyof typeof METERS_PER_UNIT], source: value === "model" ? "unknown" : "user", displayUnit: value as ModelUnits["displayUnit"] })} />}
          {units.metersPerUnit === null && <p className="text-xs text-muted-foreground">{label("declareUnit")}</p>}
          {workspace && <Input aria-label={label("askPlaceholder")} placeholder={label("askPlaceholder")} value={question} onChange={(event) => setQuestion(event.target.value)} className="text-xs" />}
          {workspace?.canAttachFiles && <label className="flex items-center justify-between gap-2 text-xs">{label("includeScreenshot")}<Switch size="sm" checked={includeScreenshot} onCheckedChange={setIncludeScreenshot} /></label>}
          <Button size="xs" variant="ghost" disabled={!anchors.length} onClick={() => setAnchors([])}>{label("clear")}</Button>
        </>}
        <p className="text-xs leading-relaxed text-muted-foreground">{label(metadata?.kind === "pointcloud" ? "pointsApproximate" : "approximate")}</p>
        {metadata?.warnings.map((warning) => <p key={warning} className="text-xs text-muted-foreground">{warning}</p>)}
      </motion.aside>}</AnimatePresence>
    </div>
    <div className={cn("flex min-h-7 shrink-0 items-center gap-2 border-t px-3 py-1 text-xs text-muted-foreground", notice && "text-foreground")} aria-live="polite">
      <span className="min-w-0 flex-1 truncate" title={notice || label(tool === "distance" ? "distanceHint" : tool === "angle" ? "angleHint" : "navigateHint")}>{notice || (ready ? label(tool === "distance" ? "distanceHint" : tool === "angle" ? "angleHint" : "navigateHint") : label("loading"))}</span>
      {metadata && <span className="shrink-0 tabular-nums">{metadata.kind === "pointcloud" && <>{new Intl.NumberFormat(undefined, { notation: "compact" }).format(displayedPoints)} / </>}{new Intl.NumberFormat(undefined, { notation: "compact" }).format(metadata.kind === "pointcloud" ? metadata.pointCount : metadata.triangleCount)} {label(metadata.kind === "pointcloud" ? "pointCount" : "objects")} · {units.metersPerUnit === null ? label("modelUnit") : units.displayUnit}</span>}
    </div>
  </div>
}
