import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Play, Pause, SkipBack, SkipForward, RotateCcw, Radio, Brain, Wrench, Bot, Terminal, MessageSquare, Check, ChevronRight, Copy, Activity, Network } from 'lucide-react';
import { Button } from './ui/button';
import frames from '../data/stream.json';
import { applyFrame, getTimeline, formatPath } from '../lib/stream.mjs';
import './stream-explorer.css';

const labels = ['初始快照', 'Run 开始', '开始思考', '思考结束 · 1.2s', '读取 README', '工具执行完成', '启动子 agent', '子 agent 调用工具', '启动后台任务', '子 agent 完成', '回复首段文本', '追加文本 · 回复完成', 'Run 完成', '后台测试进度', '后台测试完成', '推送后台通知', '保留未知原始事件'];
const json = value => JSON.stringify(value, null, 2);
const seconds = ms => `${Number((ms / 1000).toFixed(1))}s`;
const leafRows = (value, path = 'frame') => {
  if (value === null || typeof value !== 'object') return [[path, value]];
  if (Object.keys(value).length === 0) return [[path, value]];
  return Object.entries(value).flatMap(([key, entry]) => leafRows(entry, Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`));
};
const statusLabel = status => ({ running: '运行中', streaming: '输出中', complete: '已完成', failed: '失败', canceled: '已取消' }[status] || status);

function ModeButtons({ value, onChange, options, label }) {
  return <div className="sx-mode" role="group" aria-label={label}>{options.map(([key, title]) => <Button key={key} variant="ghost" size="xs" aria-pressed={value === key} className={value === key ? 'is-active' : ''} onClick={() => onChange(key)}>{title}</Button>)}</div>;
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  return <Button variant="ghost" size="icon-xs" aria-label={copied ? '已复制 JSON' : '复制 JSON'} onClick={async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 1400); } catch { setCopied(false); }
  }}>{copied ? <Check /> : <Copy />}</Button>;
}

function JsonBlock({ value }) {
  return <div className="sx-json-wrap"><div className="sx-json-toolbar"><span>JSON</span><CopyButton text={json(value)} /></div><pre className="sx-json"><code>{json(value)}</code></pre></div>;
}

function Content({ content }) {
  return <div className="sx-content">{content.map((part, index) => <div key={index} className={part.kind === 'json' ? 'sx-inline-json' : 'sx-text'}>{part.kind === 'text' ? part.text : part.kind === 'json' ? json(part.value) : json(part)}</div>)}</div>;
}

function OutputItem({ item, path, depth = 0 }) {
  const [open, setOpen] = useState(true);
  const icon = { run: Activity, thinking: Brain, tool: Wrench, agent: Bot, task: Terminal, message: MessageSquare };
  const Icon = icon[item.kind] || Activity;
  const title = item.kind === 'run' ? 'Agent run' : item.kind === 'thinking' ? '思考' : item.kind === 'message' ? item.phase === 'notification' ? '后台通知' : '最终回复' : item.name || item.title || item.kind;
  const expandable = item.kind === 'tool' || item.kind === 'agent' || item.kind === 'task';
  const duration = item.timing?.durationMs;
  return <div className={`sx-output-item sx-item-${item.kind} ${depth ? 'sx-nested' : ''}`}>
    <div className="sx-item-heading">
      {expandable ? <Button variant="ghost" size="icon-xs" className="sx-item-toggle" aria-expanded={open} aria-label={`${open ? '折叠' : '展开'} ${title}`} onClick={() => setOpen(!open)}><ChevronRight className={open ? 'is-open' : ''} /></Button> : <Icon className="sx-kind-icon" size={14} />}
      {expandable && <Icon className="sx-kind-icon" size={14} />}<strong>{title}</strong>
      <span className={`sx-status sx-status-${item.status}`}>{statusLabel(item.status)}</span>
      {duration != null && <span className="sx-duration">{seconds(duration)}</span>}
    </div>
    <code className="sx-item-path">{path}</code>
    {item.completionPolicy && <div className="sx-policy"><span>{item.completionPolicy}</span>{item.completionPolicy === 'detached' ? '可在父 Run 完成后继续' : '父 Run 等待子 agent 完成'}</div>}
    {item.kind === 'thinking' && <p className="sx-thinking-summary">{item.summary || '等待公开思考摘要…'}</p>}
    {item.kind === 'run' && <p className="sx-run-model">{item.model}</p>}
    {item.kind === 'message' && <Content content={item.content || []} />}
    {open && item.kind === 'tool' && <div className="sx-tool-body"><div className="sx-tool-caption">INPUT</div><pre>{json(item.input?.value ?? item.input?.text)}</pre>{Boolean(item.output?.length) && <><div className="sx-tool-caption">OUTPUT</div><Content content={item.output} /></>}</div>}
    {open && item.children?.length > 0 && <div className="sx-children">{item.children.map((child, index) => <OutputItem item={child} path={`${path}.children[${index}]`} depth={depth + 1} key={child.id} />)}</div>}
    {open && item.children?.length === 0 && ['agent', 'task'].includes(item.kind) && <p className="sx-empty-children">等待子事件…</p>}
  </div>;
}

function Edits({ frame }) {
  const edits = frame.output?.edits || [];
  if (frame.kind === 'snapshot') return <div className="sx-edit-card"><span className="sx-op">snapshot</span><p>以完整快照建立渲染状态，接着按 seq 顺序应用增量。</p><code>state.items ← frame.items</code></div>;
  if (!edits.length) return <div className="sx-edit-card"><span className="sx-op">unmapped</span><p>这个原始事件没有投影到组件。native.value 完整保留，渲染状态不变。</p></div>;
  return <div className="sx-edits">{edits.map((edit, index) => <div className="sx-edit-card" key={index}>
    <div className="sx-edit-title"><span className="sx-op">{edit.op}</span><code>frame.output.edits[{index}]</code></div>
    <code className="sx-target">{formatPath(edit.path, 'state')}</code>
    {edit.op === 'splice' ? <><p>从索引 {edit.index} 开始，移除 {edit.deleteCount} 项，插入 {edit.items.length} 项。</p><pre>{json(edit.items)}</pre></> : <pre>{json(edit.op === 'text.append' ? edit.text : edit.value)}</pre>}
  </div>)}</div>;
}

export default function StreamExplorer() {
  const timeline = useMemo(() => getTimeline(frames), []);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [frameView, setFrameView] = useState('edits');
  const [outputView, setOutputView] = useState('render');
  const [reconnecting, setReconnecting] = useState(false);
  const reducedMotion = useReducedMotion();
  const selected = timeline[index];
  const frame = selected.frame;
  const seq = frame.seq ?? frame.atSeq;
  const firstTs = frames[0].ts;
  const activeRef = useRef(null);
  const timelineRef = useRef(null);
  const framePanelRef = useRef(null);
  const reconnectSnapshot = useMemo(() => {
    const entry = timeline.find(item => (item.frame.seq ?? item.frame.atSeq) === 8);
    return { ...frames[0], atSeq: 8, ts: entry.frame.ts, items: entry.state.items };
  }, [timeline]);
  const replayState = useMemo(() => {
    if (!reconnecting) return selected.state;
    let state = applyFrame(null, reconnectSnapshot);
    for (const entry of timeline) {
      const eventSeq = entry.frame.seq;
      if (eventSeq > 8 && eventSeq <= seq) state = applyFrame(state, entry.frame);
    }
    return state;
  }, [reconnecting, selected.state, reconnectSnapshot, timeline, seq]);
  const visibleFrame = reconnecting && seq === 8 ? reconnectSnapshot : frame;
  const rows = useMemo(() => leafRows(visibleFrame), [visibleFrame]);
  useEffect(() => {
    if (!playing) return undefined;
    if (index >= timeline.length - 1) { setPlaying(false); return undefined; }
    const timer = setTimeout(() => setIndex(value => value + 1), 1100);
    return () => clearTimeout(timer);
  }, [index, playing, timeline.length]);
  useEffect(() => {
    const container = timelineRef.current;
    const active = activeRef.current;
    if (!container || !active) return;
    const visible = container.getBoundingClientRect();
    const item = active.getBoundingClientRect();
    const delta = item.top < visible.top ? item.top - visible.top - 8 : item.bottom > visible.bottom ? item.bottom - visible.bottom + 8 : 0;
    if (delta) container.scrollTo({ top: container.scrollTop + delta, behavior: reducedMotion ? 'instant' : 'smooth' });
  }, [index, reducedMotion]);
  useEffect(() => { framePanelRef.current?.scrollTo({ top: 0, behavior: 'instant' }); }, [index, reconnecting, frameView]);
  function seek(value) { setPlaying(false); setIndex(value); if (value < 8) setReconnecting(false); }
  function reset() { setPlaying(false); setReconnecting(false); setIndex(0); }
  function reconnect() { setPlaying(false); setReconnecting(true); setIndex(timeline.findIndex(item => (item.frame.seq ?? item.frame.atSeq) === 8)); }
  const runDone = replayState.items?.find(item => item.kind === 'run')?.status === 'complete';
  const backgroundRunning = replayState.items?.some(item => item.kind === 'task' && item.status === 'running');
  return <section className="stream-explorer" aria-label="共享事件流逐帧演示">
    <div className="sx-toolbar">
      <div className="sx-playback"><Button size="sm" onClick={() => { if (index === timeline.length - 1) setIndex(reconnecting ? 8 : 0); setPlaying(!playing); }} aria-label={playing ? '暂停播放' : '播放事件流'}>{playing ? <Pause /> : <Play />}{playing ? '暂停' : '播放'}</Button>
        <Button variant="outline" size="icon-sm" aria-label="上一帧" disabled={index === (reconnecting ? 8 : 0)} onClick={() => seek(index - 1)}><SkipBack /></Button>
        <Button variant="outline" size="icon-sm" aria-label="下一帧" disabled={index === timeline.length - 1} onClick={() => seek(index + 1)}><SkipForward /></Button>
        <Button variant="ghost" size="sm" onClick={reset}><RotateCcw />重置</Button>
      </div>
      <div className="sx-toolbar-meta"><span className="sx-synthetic">Synthetic fixture</span><Button variant={reconnecting ? 'secondary' : 'outline'} size="sm" onClick={reconnect}><Network />从 seq 8 重连</Button></div>
    </div>
    <div className="sx-progress-line"><span><Radio size={13} /> stream-1</span><span aria-live="polite">seq <strong>{seq}</strong> / 16 <i>·</i> +{seconds(visibleFrame.ts - firstTs)}</span><span>{reconnecting ? '重连回放' : '顺序回放'}</span></div>
    {reconnecting && <div className="sx-notice"><Network size={14} /><span><code>GET events?afterSeq=8</code> → snapshot(atSeq=8) → event(seq=9…16)。恢复快照，再继续追加。</span></div>}
    <div className="sx-workspace">
      <aside className="sx-timeline" aria-label="事件时间线"><div className="sx-panel-heading"><span>事件顺序</span><span className="sx-count">17 帧</span></div><div className="sx-timeline-scroll" ref={timelineRef}>{timeline.map((item, position) => {
        const itemSeq = item.frame.seq ?? item.frame.atSeq;
        return <Button variant="ghost" size="sm" key={position} ref={position === index ? activeRef : undefined} className={`sx-frame-button ${position === index ? 'is-current' : ''} ${position < index ? 'is-past' : ''}`} aria-current={position === index ? 'step' : undefined} onClick={() => seek(position)}><span className="sx-seq">{String(itemSeq).padStart(2, '0')}</span><span className="sx-frame-name">{reconnecting && itemSeq === 8 ? '重连快照 · seq 8' : labels[position] || item.label}<small>{reconnecting && itemSeq === 8 ? 'snapshot · reconnect' : item.frame.kind === 'snapshot' ? 'snapshot' : item.frame.native?.value?.type || item.frame.kind}</small></span>{position < index && <Check className="sx-past-check" size={12} />}</Button>;
      })}</div></aside>
      <div className="sx-frame-panel"><div className="sx-panel-heading"><span>当前返回帧</span><ModeButtons label="当前帧展示方式" value={frameView} onChange={setFrameView} options={[["edits", "增量"], ["fields", "字段"], ["json", "JSON"]]} /></div>
        <div className="sx-panel-scroll" ref={framePanelRef}><motion.div key={`${index}-${reconnecting}-${frameView}`} initial={reducedMotion ? false : { opacity: 0.45 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
          {frameView === 'edits' ? <Edits frame={visibleFrame} /> : frameView === 'json' ? <JsonBlock value={visibleFrame} /> : <div className="sx-field-table"><div className="sx-field-table-heading"><span>完整字段路径</span><span>实际内容</span></div>{rows.map(([path, value]) => <div className="sx-field-row" key={path}><code>{path}</code><code>{json(value)}</code></div>)}</div>}
        </motion.div></div>
      </div>
      <div className="sx-result-panel"><div className="sx-panel-heading"><span>累积渲染结果</span><ModeButtons label="累积结果展示方式" value={outputView} onChange={setOutputView} options={[["render", "组件"], ["json", "JSON"]]} /></div><div className="sx-panel-scroll">
        {runDone && backgroundRunning && <div className="sx-background-note"><Terminal size={14} /> Run 已完成，后台任务仍在运行。</div>}
        {outputView === 'json' ? <JsonBlock value={replayState} /> : replayState.items?.length ? <div className="sx-output-list">{replayState.items.map((item, itemIndex) => <motion.div key={item.id} initial={reducedMotion ? false : { opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }}><OutputItem item={item} path={`state.items[${itemIndex}]`} /></motion.div>)}</div> : <div className="sx-empty"><Activity size={24} /><strong>等待第一帧事件</strong><span>初始快照为空。点击播放，观察组件如何逐步累积。</span></div>}
      </div></div>
    </div>
    <div className="sx-explanation"><span><span className="sx-key-dot" /> 每帧按顺序、原子应用</span><span>文本只追加变化的片段；子节点不会让整个父组件重传。</span></div>
    <p className="sx-fixture-caption">此处使用固定合成样例演示协议，不连接模型。思考内容只展示 harness 已公开的摘要；native 中的原始事件独立保留。</p>
  </section>;
}
