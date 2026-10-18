import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Dialog } from '@base-ui/react/dialog'
import { motion, MotionConfig, useReducedMotion } from 'motion/react'
import { Search, ChevronRight, ChevronDown, Copy, Check, Sun, Moon, ArrowUpRight, ArrowRight, BookOpen, Radio, FileJson2, X, Download, Braces } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import StreamExplorer from './components/StreamExplorer'
import { fieldProvenance, provenanceText } from './lib/provenance.mjs'
import reference from './data/reference.json'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './styles.css'

const pages = reference.pages.map(page => page.id === 'send-message' ? {
  ...page,
  sections: ['request', 'response', 'headers', 'flow', 'continue', 'errors'].map(id => page.sections.find(section => section.id === id)).filter(Boolean),
} : page)
const groups = [...new Set(pages.map(page => page.group))]
const playground = { id: 'stream-playground', title: '流式事件演示', group: '交互演示', subtitle: 'Stream playground' }
const allPages = [...pages, playground]
const flattenFields = (fields = []) => fields.flatMap(field => [field, ...flattenFields(field.children)])
function fieldSearchHint(field) {
  const { label, source, convention, note } = fieldProvenance(field, reference.provenanceSources)
  return [field.description, `${label} · ${source.title}`, convention && `平台映射/约定：${convention}`, note].filter(Boolean).join(' ').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/`([^`]+)`/g, '$1')
}
const searchRecords = allPages.flatMap(page => [
  { pageId: page.id, title: page.title, hint: page.endpoint || page.subtitle || page.group },
  ...(page.sections || []).flatMap(section => flattenFields(section.fields).map(field => ({ pageId: page.id, sectionId: section.id, title: field.path, hint: `${page.title} / ${section.title} · ${fieldSearchHint(field)}`, field: field.path }))),
])
function readRoute() {
  const [pageId, query] = location.hash.slice(1).split('?')
  const params = new URLSearchParams(query)
  return { pageId: allPages.some(page => page.id === pageId) ? pageId : 'send-message', field: params.get('field') || '', sectionId: params.get('section') || '' }
}
function goTo(pageId, field = '', sectionId = '') {
  const query = new URLSearchParams()
  if (field) query.set('field', field)
  if (sectionId) query.set('section', sectionId)
  location.hash = `${pageId}${query.size ? `?${query}` : ''}`
}
function repeatReferenceNavigation(event) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const href = event.currentTarget.getAttribute('href')
  if (href?.startsWith('#') && href === location.hash) {
    event.preventDefault()
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }
}
function Markdown({ children }) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} onClick={repeatReferenceNavigation} {...(href?.startsWith('https://') ? { target: '_blank', rel: 'noreferrer' } : {})}>{children}</a> }}>{String(children || '')}</ReactMarkdown></div>
}
function CopyButton({ text, label = '复制', className = '' }) {
  const [state, setState] = useState('idle')
  const timer = useRef()
  useEffect(() => () => clearTimeout(timer.current), [])
  async function copy() {
    try { await navigator.clipboard.writeText(text); setState('copied') }
    catch { setState('failed') }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 2000)
  }
  return <Button variant="ghost" size="sm" className={`copy-button ${className}`} onClick={copy} aria-label={state === "copied" ? `已复制：${label}` : state === "failed" ? `复制失败：${label}` : label} title={label}>
    {state === 'copied' ? <Check size={14} /> : <Copy size={14} />}
    <span aria-live="polite">{state === 'copied' ? '已复制' : state === 'failed' ? '复制失败' : label}</span>
  </Button>
}
function Method({ children, small = false }) {
  return <span className={`method method-${String(children).toLowerCase().replace(/[^a-z]/g, '')} ${small ? 'small' : ''}`}>{children}</span>
}
function highlightLine(line) {
  const parts = line.split(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b(?:true|false|null|const|await|fetch|import|from|curl|return|async|def)\b|\b\d+\b)/g)
  return parts.map((part, i) => {
    const cls = /^['"]/.test(part) ? 'token-string' : /^\d+$/.test(part) ? 'token-number' : /^(true|false|null|const|await|fetch|import|from|curl|return|async|def)$/.test(part) ? 'token-keyword' : ''
    return cls ? <span key={i} className={cls}>{part}</span> : part
  })
}
function CodeBlock({ code, label, language = 'JSON' }) {
  return <section className="code-block">
    <div className="code-toolbar"><div><Braces size={14} /><span>{label}</span></div><span className="code-lang">{language}</span><CopyButton text={code} label="复制代码" /></div>
    <pre tabIndex={0} aria-label={label}><code>{String(code).trimEnd().split('\n').map((line, i) => <span className="code-line" key={i}><span className="line-number" aria-hidden="true">{i + 1}</span><span>{highlightLine(line)}</span></span>)}</code></pre>
  </section>
}
function FieldProvenance({ field }) {
  const { label, source, convention, note } = fieldProvenance(field, reference.provenanceSources)
  return <div className="field-provenance">
    <div className="provenance-labels">
      <a className="provenance-label" href={source.url} onClick={repeatReferenceNavigation} {...(source.url.startsWith('https://') ? { target: '_blank', rel: 'noreferrer' } : {})} aria-label={`${field.path}：${label}，查看 ${source.title}`} title={source.title}>{label}<ArrowUpRight size={10} aria-hidden="true" /></a>
      {convention && <span className="provenance-label provenance-convention">平台映射/约定</span>}
    </div>
    {convention && <div className="provenance-detail"><Markdown>{convention}</Markdown></div>}
    {note && <div className="provenance-detail"><Markdown>{note}</Markdown></div>}
  </div>
}
function FieldRow({ field, depth = 0, expansion, highlighted }) {
  const [open, setOpen] = useState(depth === 0 && field.name === 'message')
  const hasChildren = field.children?.length > 0
  useEffect(() => { if (expansion.revision) setOpen(expansion.open) }, [expansion])
  useEffect(() => { if (highlighted && (highlighted.startsWith(field.path) || highlighted === field.path)) setOpen(true) }, [highlighted, field.path])
  const selected = highlighted === field.path
  const ref = useRef(null)
  useEffect(() => { if (selected) { const id = setTimeout(() => ref.current?.scrollIntoView({ block: 'center', behavior: 'instant' }), 80); return () => clearTimeout(id) } }, [selected])
  return <div className={`field ${selected ? 'field-highlight' : ''}`} ref={ref} data-field-path={field.path}>
    <div className="field-heading">
      {hasChildren ? <button className="field-toggle" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`${open ? '收起' : '展开'} ${field.path}`}><ChevronRight size={14} className={open ? 'rotate' : ''} /></button> : <span className="field-spacer" />}
      <code className="field-name">{field.name || field.path.split('.').at(-1)}</code><span className="field-type">{field.type}</span>
      {field.required && <span className="required">必填</span>}
      <CopyButton text={field.path} label="复制字段路径" />
    </div>
    <div className="field-body"><code className="field-path">{field.path}</code><FieldProvenance field={field} /><Markdown>{field.description}</Markdown>{field.default !== undefined && <div className="default-value">默认值 <code>{typeof field.default === 'string' ? field.default : JSON.stringify(field.default)}</code></div>}</div>
    {hasChildren && open && <div className="field-children">{field.children.map((child, index) => <FieldRow key={`${child.path}-${index}`} field={child} depth={depth + 1} expansion={expansion} highlighted={highlighted} />)}</div>}
    {hasChildren && !open && <button className="show-properties" onClick={() => setOpen(true)}><ChevronRight size={12} />展开 {field.children.length} 个属性</button>}
  </div>
}
function Section({ section, highlighted }) {
  const [expansion, setExpansion] = useState({ revision: 0, open: false })
  return <section className="doc-section" id={section.id}>
    <div className="section-heading"><h2>{section.title}</h2>{section.fields?.some(field => field.children?.length) && <Button variant="ghost" size="xs" onClick={() => setExpansion({ revision: expansion.revision + 1, open: !expansion.open })}>{expansion.open ? '收起全部' : '展开全部'}<ChevronDown size={12} /></Button>}</div>
    {section.description && <Markdown>{section.description}</Markdown>}
    {section.fields && <div className="fields">{section.fields.map((field, index) => <FieldRow key={`${field.path}-${index}`} field={field} expansion={expansion} highlighted={highlighted} />)}</div>}
    {section.body && <Markdown>{section.body}</Markdown>}
  </section>
}
function Examples({ page }) {
  const [index, setIndex] = useState(0)
  useEffect(() => setIndex(0), [page.id])
  const examples = page.examples || []
  const example = examples[index] || examples[0]
  const response = examples.find((item, i) => i !== index && /返回|响应|Response|Task|快照|snapshot/i.test(item.label))
  return <aside className="examples" aria-label="代码示例">
    <div className="examples-sticky">
      <div className="eyebrow">EXAMPLES</div>
      {example && <>
        <label className="example-select-label">示例场景<select aria-label="示例场景" value={index} onChange={e => setIndex(Number(e.target.value))}>{examples.map((item, i) => <option value={i} key={i}>{item.label}</option>)}</select><ChevronDown size={14} /></label>
        <CodeBlock code={example.code} label={example.label} language={example.language} />
        {response && <CodeBlock code={response.code} label={response.label} language={response.language} />}
      </>}
      <div className="example-note"><span className="status-dot" />文档示例 · 不会发起实际模型调用</div>
      <button className="explorer-link" onClick={() => goTo('stream-playground')}><span className="explorer-icon"><Radio size={19} /></span><span><strong>看事件如何变成回复</strong><small>逐帧播放、增量追加与断线恢复</small></span><ArrowUpRight size={16} /></button>
      <div className="page-contents"><div className="eyebrow">ON THIS PAGE</div>{page.sections.map(section => <a href={`#${page.id}`} key={section.id} onClick={e => { e.preventDefault(); document.getElementById(section.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>{section.title}</a>)}</div>
    </div>
  </aside>
}
function pageMarkdown(page) {
  return `# ${page.title}\n\n${page.endpoint || ''}\n\n${page.description?.join('\n\n') || ''}\n\n${reference.provenanceLegend}\n\n${page.sections.map(section => `## ${section.title}\n\n${section.description || ''}\n\n${section.body || ''}\n\n${flattenFields(section.fields).map(f => `- \`${f.path}\` (${f.type})${f.required ? ' **必填**' : ''}: ${f.description}\n\n  ${provenanceText(f, reference.provenanceSources)}`).join('\n\n')}`).join('\n\n')}\n\n${page.examples.map(example => `### ${example.label}\n\n\`\`\`${example.language}\n${example.code}\n\`\`\``).join('\n\n')}`
}
function SearchDialog({ open, setOpen }) {
  const [query, setQuery] = useState('')
  useEffect(() => { if (open) setQuery('') }, [open])
  const results = useMemo(() => {
    if (!query.trim()) return searchRecords.filter(record => !record.field).slice(0, 12)
    const words = query.toLowerCase().trim().split(/\s+/)
    return searchRecords.filter(record => words.every(word => `${record.title} ${record.hint}`.toLowerCase().includes(word))).slice(0, 24)
  }, [query])
  return <Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Portal><Dialog.Backdrop className="dialog-backdrop" /><Dialog.Popup className="search-dialog">
    <Dialog.Title className="sr-only">搜索 API 文档</Dialog.Title><Dialog.Description className="sr-only">搜索接口名称、完整字段路径和说明。选择结果后打开对应位置。</Dialog.Description>
    <div className="search-input-wrap"><Search size={19} /><Input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索接口、字段或概念…" aria-label="搜索接口、字段或概念" /><Dialog.Close render={<Button variant="ghost" size="icon-sm" aria-label="关闭搜索" />}><X size={18} /></Dialog.Close></div>
    <div className="search-results"><p className="search-caption">{query ? `${results.length}${results.length === 24 ? '+' : ''} 个匹配结果` : '快速导航'}</p>{!results.length && <p className="empty-state">没有找到结果，试试 “children” 或 “afterSeq”。</p>}{results.map((result, i) => <button className="search-result" key={`${result.pageId}-${i}`} onClick={() => { goTo(result.pageId, result.field, result.sectionId); setOpen(false) }}>{result.field ? <Braces size={16} /> : <BookOpen size={16} />}<span><strong>{result.title}</strong><small>{result.hint}</small></span><ArrowRight size={15} /></button>)}</div><div className="search-footer"><span><kbd>Tab</kbd> 切换结果 <kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span></div>
  </Dialog.Popup></Dialog.Portal></Dialog.Root>
}
function App() {
  const [route, setRoute] = useState(readRoute)
  const [searchOpen, setSearchOpen] = useState(false)
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('harness-docs-theme') || 'light' } catch { return 'light' } })
  const reducedMotion = useReducedMotion()
  const page = allPages.find(p => p.id === route.pageId) || pages[0]
  useEffect(() => {
    const change = () => setRoute(readRoute())
    window.addEventListener('hashchange', change)
    const key = e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(value => !value) } }
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('hashchange', change); window.removeEventListener('keydown', key) }
  }, [])
  useEffect(() => { document.documentElement.classList.toggle('dark', theme === 'dark'); try { localStorage.setItem('harness-docs-theme', theme) } catch {} }, [theme])
  useEffect(() => { document.title = `${page.title} | Harness API Reference`; window.scrollTo(0, 0) }, [page.id, page.title])
  useEffect(() => {
    if (!route.sectionId || route.field) return
    const frame = requestAnimationFrame(() => document.getElementById(route.sectionId)?.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' }))
    return () => cancelAnimationFrame(frame)
  }, [route, reducedMotion])
  const isPlayground = page.id === playground.id
  return <MotionConfig reducedMotion="user"><a className="skip-link" href="#main" onClick={e => { e.preventDefault(); document.getElementById("main")?.focus() }}>跳转到正文</a>
    <header className="site-header"><a className="brand" href="#send-message"><span className="brand-mark"><Braces size={21} strokeWidth={2} /></span><span>Harness<span className="brand-divider">/</span><span className="brand-docs">Developers</span></span></a><div className="header-links"><a className={!isPlayground ? 'active' : ''} href="#send-message">API reference</a><a className={isPlayground ? 'active' : ''} href="#stream-playground">Stream playground</a></div><div className="header-actions"><button className="search-trigger" onClick={() => setSearchOpen(true)}><Search size={15} /><span>搜索文档</span><kbd>⌘ K</kbd></button><Button variant="ghost" size="icon-sm" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={theme === 'light' ? '切换到深色主题' : '切换到浅色主题'}>{theme === 'light' ? <Sun size={17} /> : <Moon size={17} />}</Button><span className="draft-badge">DRAFT <span>v3</span></span></div></header>
    <aside className="sidebar"><div className="sidebar-top"><span>API REFERENCE</span><span className="version-chip">v3 <ChevronDown size={11} /></span></div><nav aria-label="接口导航">
      {groups.map(group => <div className="nav-group" key={group}><h3>{group}</h3>{pages.filter(p => p.group === group).map(p => <a key={p.id} href={`#${p.id}`} aria-current={page.id === p.id ? 'page' : undefined} className={`nav-item ${page.id === p.id ? 'selected' : ''}`}>{p.method ? <Method small>{p.method}</Method> : <FileJson2 size={14} />}<span>{p.title}</span></a>)}</div>)}
      <div className="nav-group"><h3>交互演示</h3><a href="#stream-playground" className={`nav-item ${isPlayground ? 'selected' : ''}`} aria-current={isPlayground ? 'page' : undefined}><Radio size={15} /><span>流式事件演示</span><span className="mini-label">LIVE</span></a></div>
    </nav><div className="sidebar-footer"><a href="/reference.md" download><Download size={14} />下载完整参考文档<ArrowUpRight size={13} /></a><div><span className="status-dot" />A2A 1.0 · 协议设计草案</div></div></aside>
    <main className={`main ${isPlayground ? 'main-playground' : ''}`} id="main" tabIndex={-1}><div className="breadcrumb"><span>API Reference</span><ChevronRight size={13} /><span>{page.group}</span>{!isPlayground && <CopyButton text={pageMarkdown(page)} label="复制 Markdown" />}</div>
      <motion.div key={page.id} initial={reducedMotion ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .18 }}>
        <div className="page-heading"><div className="title-eyebrow">{page.subtitle || (page.method ? 'HTTP API' : 'SHARED PROTOCOL')}</div><h1>{page.title}</h1>{page.endpoint && <div className="endpoint"><Method>{page.method || 'GET'}</Method><code>{page.endpoint}</code><CopyButton text={page.endpoint} label="复制接口路径" /></div>}</div>
        {isPlayground ? <><p className="playground-intro">按帧检查原始事件、投影操作与最终 UI。点击时间线，观察文本追加、子 agent 和后台任务如何累加。</p><StreamExplorer /></> : <div className="reference-grid"><article className="doc-content"><div className="page-description">{page.description?.map((paragraph, i) => <Markdown key={i}>{paragraph}</Markdown>)}</div><div className="draft-note"><span className="status-dot" /><span>这是拟议接口。生产接口尚未升级，示例使用合成数据。</span></div><div className="provenance-legend" aria-label="字段来源说明"><Markdown>{reference.provenanceLegend}</Markdown></div>{page.sections.map(section => <Section key={`${page.id}-${section.id}`} section={section} highlighted={!route.sectionId || route.sectionId === section.id ? route.field : ""} />)}<div className="doc-bottom"><span>参考草案 · 2026-10-17</span><a href="/reference.md" download>查看完整文档 <ArrowUpRight size={13} /></a></div></article><Examples key={page.id} page={page} /></div>}
      </motion.div>
    </main><SearchDialog open={searchOpen} setOpen={setSearchOpen} />
  </MotionConfig>
}
createRoot(document.getElementById('root')).render(<App />)
