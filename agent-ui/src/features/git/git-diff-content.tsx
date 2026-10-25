import { useMemo } from "react"
import { FileCode2, FileWarning } from "lucide-react"
import { SourcePreview } from "@/features/files/preview/source-preview"
import type { GitDiff } from "@/lib/api/git-repository"
import { cn } from "@/lib/utils"
import { parseGitDiff, splitGitDiff, type GitDiffLine } from "./git-diff-lines"
import { GitEmpty, GitNotice } from "./git-ui-primitives"
import { useGitText } from "./git-ui-text"

function lineClass(line?: GitDiffLine) {
  return line?.kind === "added" ? "bg-status-success/[0.08]" : line?.kind === "removed" ? "bg-status-error/[0.08]" : ""
}

function DiffLineText({ line, side }: { line?: GitDiffLine; side: "left" | "right" }) {
  return <div className="flex min-h-5">
    <span aria-hidden="true" className="w-12 shrink-0 select-none pr-2 text-right text-muted-foreground/50 tabular-nums">{side === "left" ? line?.oldLine : line?.newLine}</span>
    <span className={cn("w-4 shrink-0 select-none text-center", line?.kind === "added" ? "text-status-success" : line?.kind === "removed" ? "text-status-error" : "text-muted-foreground")}>{line?.kind === "added" ? "+" : line?.kind === "removed" ? "−" : " "}</span>
    <span className="whitespace-pre pr-4">{line?.text}</span>
  </div>
}

export function GitDiffContent({ diff, source, split }: { diff: GitDiff; source: boolean; split: boolean }) {
  const t = useGitText()
  const lines = useMemo(() => parseGitDiff(diff.patch), [diff.patch])
  const splitRows = useMemo(() => splitGitDiff(lines), [lines])
  const maxLineLength = useMemo(() => lines.reduce((max, line) => line.kind === "meta" || line.kind === "hunk" ? max : Math.max(max, line.text.length), 0), [lines])
  const sourceContent = diff.newContent ?? diff.oldContent
  return <>
    {diff.truncated && <div className="shrink-0 border-b bg-status-warning/5"><GitNotice>{t.truncated}</GitNotice></div>}
    <div className="min-h-0 min-w-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [scrollbar-gutter:stable]" tabIndex={0} aria-label={`${source ? t.source : t.diff}: ${diff.path}`}>
      {diff.binary ? <GitEmpty icon={<FileWarning />} title={t.binary}>{t.binaryDescription}</GitEmpty> : source ? <>
        {diff.newContent === null && diff.oldContent !== null && <GitNotice>{t.sourceDeleted}</GitNotice>}
        {sourceContent ? <SourcePreview content={sourceContent} fileName={diff.path} /> : <GitEmpty icon={<FileCode2 />} title={t.emptySource} />}
      </> : !diff.patch ? <GitEmpty icon={<FileCode2 />} title={t.emptyDiff} /> : split ? <table className="min-w-full table-fixed border-collapse font-mono text-xs leading-5" style={{ width: `${Math.max(760, (maxLineLength * 7.3 + 80) * 2)}px` }}>
        <colgroup><col style={{ width: "50%" }} /><col style={{ width: "50%" }} /></colgroup>
        <thead><tr className="bg-muted/40 text-left text-[11px] font-normal text-muted-foreground"><th className="border-r px-3 py-1 font-normal">{diff.oldLabel}</th><th className="px-3 py-1 font-normal">{diff.newLabel}</th></tr></thead>
        <tbody>{splitRows.map((row, index) => row.heading ? <tr key={index}><td colSpan={2} className={cn("whitespace-pre px-3", row.heading.kind === "hunk" ? "bg-muted/60 py-1 text-muted-foreground" : "text-[11px] text-muted-foreground/70")}>{row.heading.text}</td></tr> : <tr key={index}><td className={cn("border-r p-0 align-top", lineClass(row.left))}><DiffLineText line={row.left} side="left" /></td><td className={cn("p-0 align-top", lineClass(row.right))}><DiffLineText line={row.right} side="right" /></td></tr>)}</tbody>
      </table> : <pre className="m-0 w-max min-w-full py-2 font-mono text-xs leading-5"><code>
        {lines.map((line, index) => line.kind === "meta" || line.kind === "hunk" ? <span key={index} className={cn("block whitespace-pre px-3", line.kind === "hunk" ? "my-1 bg-muted/60 py-1 text-muted-foreground" : "text-[11px] text-muted-foreground/70")}>{line.text}</span> : <span key={index} className={cn("flex min-h-5", lineClass(line))}>
          <span aria-hidden="true" className="w-11 shrink-0 select-none pr-2 text-right text-muted-foreground/50 tabular-nums">{line.oldLine}</span><span aria-hidden="true" className="w-11 shrink-0 select-none pr-2 text-right text-muted-foreground/50 tabular-nums">{line.newLine}</span><span className={cn("w-4 shrink-0 select-none text-center", line.kind === "added" ? "text-status-success" : line.kind === "removed" ? "text-status-error" : "text-muted-foreground")}>{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}</span><span className="whitespace-pre pr-4">{line.text}</span>
        </span>)}
      </code></pre>}
    </div>
  </>
}
