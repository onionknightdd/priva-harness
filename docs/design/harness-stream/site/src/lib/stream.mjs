/** Fixture playback only: these synthetic examples do not execute a harness. */
const labels = {
  run_start: '主运行开始',
  thinking_start: '思考阶段开始',
  thinking_end: '思考完成 · 1.2 s',
  tool_start: '工具开始执行',
  tool_end: '工具执行完成',
  agent_start: '子 agent 开始',
  background_start: '后台测试开始',
  agent_end: '子 agent 完成',
  answer_delta: '最终回复 · 第一段',
  answer_end: '追加文本 · 回复完成',
  run_end: '主运行完成 · 后台继续',
  background_progress: '后台测试 · 8 / 12',
  background_end: '后台测试完成 · 12 / 12',
  background_notification: '后台完成通知',
  future_event: '未知事件 · 原始内容保留',
};

const forbiddenKeys = new Set(['__proto__', 'constructor', 'prototype']);
const identityKeys = new Set(['id', 'kind', 'runId', 'originRunId', 'requestId']);
const opaqueKeys = new Set(['value', 'inputSchema', 'response', 'details']);
const arrayFields = new Set(['items', 'children', 'content', 'output', 'steps', 'choices']);
const textFields = new Set(['text', 'summary']);
const itemKinds = new Set(['message', 'thinking', 'tool', 'agent', 'task', 'plan', 'interaction', 'notice', 'usage', 'run']);

export class StreamPlaybackError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StreamPlaybackError';
    this.code = code;
  }
}

function requireValue(condition, code, message) {
  if (!condition) throw new StreamPlaybackError(code, message);
}

function isIndex(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

/** Complete display-state path; numeric array positions always use brackets. */
export function formatPath(path, root = 'state') {
  return path.reduce((result, segment) => {
    if (typeof segment === 'number') return `${result}[${segment}]`;
    if (/^[A-Za-z_$][\w$]*$/.test(segment)) return result ? `${result}.${segment}` : segment;
    return `${result}[${JSON.stringify(segment)}]`;
  }, root);
}

function resolve(root, path) {
  requireValue(Array.isArray(path) && path[0] === 'items', 'INVALID_PATH', '路径必须从 state.items 开始。');
  let value = root;
  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index];
    requireValue(typeof segment === 'string' || isIndex(segment), 'INVALID_PATH', '路径段必须是字段名或非负安全整数。');
    requireValue(!forbiddenKeys.has(segment), 'INVALID_PATH', '路径包含禁止写入的属性。');
    requireValue(index === path.length - 1 || !opaqueKeys.has(segment), 'INVALID_PATH', '任意 JSON 内容只能整体替换，不能进入内部路径。');
    if (Array.isArray(value)) {
      requireValue(isIndex(segment) && segment < value.length, 'OUT_OF_BOUNDS', `${formatPath(path.slice(0, index + 1))} 超出数组范围。`);
    } else {
      requireValue(value !== null && typeof value === 'object' && typeof segment === 'string' && Object.hasOwn(value, segment), 'INVALID_PATH', `${formatPath(path.slice(0, index + 1))} 不存在。`);
    }
    value = value[segment];
  }
  return value;
}

function validateReplacement(key, previous, next) {
  if (opaqueKeys.has(key)) return;
  requireValue(next !== undefined, 'INVALID_VALUE', '替换值必须是 JSON 值。');
  if (previous === null) {
    if (key === 'summary' || key === 'model') requireValue(next === null || typeof next === 'string', 'INVALID_VALUE', `${key} 必须为字符串或 null。`);
    else if (key === 'startedAt' || key === 'endedAt' || key === 'durationMs') requireValue(next === null || isIndex(next), 'INVALID_VALUE', `${key} 必须为非负安全整数或 null。`);
    else requireValue(next === null || (typeof next === 'object' && !Array.isArray(next)), 'INVALID_VALUE', `${key} 必须为对象或 null。`);
    return;
  }
  requireValue(Array.isArray(previous) === Array.isArray(next), 'INVALID_VALUE', '替换值与原字段类型不一致。');
  requireValue(next === null ? ['summary', 'model', 'error', 'startedAt', 'endedAt', 'durationMs', 'cost'].includes(key) : typeof previous === typeof next, 'INVALID_VALUE', '替换值与原字段类型不一致。');
}

function applyEdit(root, edit) {
  const current = resolve(root, edit.path);
  const key = edit.path.at(-1);
  if (edit.op === 'splice') {
    requireValue(Array.isArray(current) && arrayFields.has(key), 'INVALID_TARGET', 'splice 必须指向声明的显示数组。');
    requireValue(isIndex(edit.index) && isIndex(edit.deleteCount) && edit.index <= current.length && edit.deleteCount <= current.length - edit.index, 'OUT_OF_BOUNDS', 'splice 索引或删除数量超出数组范围。');
    requireValue(Array.isArray(edit.items), 'INVALID_VALUE', 'splice.items 必须为数组。');
    current.splice(edit.index, edit.deleteCount, ...structuredClone(edit.items));
    return;
  }
  requireValue(edit.path.length > 1 && typeof key === 'string' && !identityKeys.has(key), 'INVALID_TARGET', '不能替换组件身份或整个显示树。');
  const parent = resolve(root, edit.path.slice(0, -1));
  if (edit.op === 'text.append') {
    requireValue(textFields.has(key) && typeof current === 'string' && typeof edit.text === 'string', 'INVALID_TARGET', 'text.append 必须指向已经存在的文本字段。');
    parent[key] += edit.text;
    return;
  }
  requireValue(edit.op === 'set' && Object.hasOwn(edit, 'value'), 'INVALID_OPERATION', '只支持 splice、set 和 text.append。');
  validateReplacement(key, current, edit.value);
  parent[key] = structuredClone(edit.value);
}

function validateDisplayTree(items) {
  const ids = new Set();
  function visit(list) {
    requireValue(Array.isArray(list), 'INVALID_VALUE', '组件集合必须为数组。');
    for (const item of list) {
      requireValue(item && itemKinds.has(item.kind) && typeof item.id === 'string' && item.id.length > 0, 'INVALID_VALUE', '组件需要有效的 kind 和 id。');
      requireValue(!ids.has(item.id), 'DUPLICATE_ID', `组件 id 重复：${item.id}`);
      ids.add(item.id);
      if (Object.hasOwn(item, 'children')) visit(item.children);
      for (const field of ['content', 'output']) {
        if (!Object.hasOwn(item, field)) continue;
        requireValue(Array.isArray(item[field]), 'INVALID_VALUE', `${field} 必须为内容数组。`);
        for (const block of item[field]) {
          requireValue(block && ['text', 'json', 'image', 'file', 'audio', 'video'].includes(block.kind), 'INVALID_VALUE', '内容块需要有效的 kind。');
          if (block.kind === 'text') requireValue(typeof block.text === 'string', 'INVALID_VALUE', '文本内容必须为字符串。');
        }
      }
    }
  }
  visit(items);
}

/**
 * Returns a new state after the complete frame succeeds. A duplicate event
 * returns the previous state unchanged. Throws before committing on gaps or
 * invalid edits. This demonstrator is not a replacement for the wire schema.
 */
export function applyFrame(state, frame) {
  requireValue(frame?.v === 3 && typeof frame.streamId === 'string' && frame.streamId.length > 0, 'INVALID_FRAME', '需要 v=3 的共享帧及有效 streamId。');
  const savedFrame = structuredClone(frame);
  if (frame.kind === 'snapshot') {
    requireValue(isIndex(frame.atSeq), 'INVALID_FRAME', 'snapshot.atSeq 必须为非负安全整数。');
    validateDisplayTree(savedFrame.items);
    return {
      streamId: frame.streamId,
      sessionId: frame.sessionId,
      seq: frame.atSeq,
      baselineAtSeq: frame.atSeq,
      items: structuredClone(frame.items),
      integrity: structuredClone(frame.integrity),
      sources: structuredClone(frame.sources),
      rawFrames: [...(state?.rawFrames ?? []), savedFrame],
    };
  }
  requireValue(state !== null && state !== undefined, 'BASELINE_REQUIRED', '先应用 snapshot，再处理事件。');
  requireValue(frame.streamId === state.streamId, 'STREAM_MISMATCH', 'streamId 已改变；必须建立新快照基线。');
  if (frame.kind === 'control') {
    return { ...state, rawFrames: [...state.rawFrames, savedFrame] };
  }
  requireValue(frame.kind === 'event' && isIndex(frame.seq) && frame.seq > 0, 'INVALID_FRAME', '事件需要有效的正整数 seq。');
  if (frame.seq <= state.seq) return state;
  requireValue(frame.seq === state.seq + 1, 'SEQUENCE_GAP', `等待 seq=${state.seq + 1}，收到 seq=${frame.seq}。`);
  requireValue(frame.context?.sessionId === state.sessionId, 'SESSION_MISMATCH', '事件与快照的 sessionId 不一致。');
  requireValue(['applied', 'unmapped', 'failed'].includes(frame.output?.status) && Array.isArray(frame.output.edits), 'INVALID_FRAME', '事件需要有效的 output.status 和 edits。');
  requireValue(frame.output.status === 'applied' || frame.output.edits.length === 0, 'INVALID_FRAME', 'unmapped / failed 事件不能带显示操作。');
  const draft = { items: structuredClone(state.items) };
  for (const edit of frame.output.edits) applyEdit(draft, edit);
  validateDisplayTree(draft.items);
  return {
    ...state,
    seq: frame.seq,
    items: draft.items,
    integrity: structuredClone(frame.integrity),
    rawFrames: [...state.rawFrames, savedFrame],
  };
}

/** Human-readable operations, with complete source and destination paths. */
export function describeEdits(frame) {
  if (frame.kind === 'snapshot') return [{ op: 'snapshot', path: 'state.items', framePath: 'frame.items', value: frame.items, label: `建立 seq=${frame.atSeq} 的显示基线` }];
  if (frame.kind === 'control') return [{ op: 'control', path: 'frame.code', framePath: 'frame.details', value: frame.details, label: frame.code }];
  return frame.output.edits.map((edit, index) => ({
    op: edit.op,
    path: formatPath(edit.path),
    framePath: `frame.output.edits[${index}].${edit.op === 'splice' ? 'items' : edit.op === 'set' ? 'value' : 'text'}`,
    value: edit.op === 'splice' ? edit.items : edit.op === 'set' ? edit.value : edit.text,
    label: edit.op === 'splice' ? `从 [${edit.index}] 删除 ${edit.deleteCount} 项，插入 ${edit.items.length} 项` : edit.op === 'set' ? '替换字段值' : '仅追加新文本',
    ...(edit.op === 'splice' ? { index: edit.index, deleteCount: edit.deleteCount, targets: edit.items.map((_, itemIndex) => formatPath([...edit.path, edit.index + itemIndex])) } : {}),
  }));
}

/** One entry per received frame, ready for a slider or sequential playback. */
export function getTimeline(frames) {
  let state = null;
  const firstTimestamp = frames.find((frame) => typeof frame.ts === 'number')?.ts ?? 0;
  return frames.map((frame, index) => {
    state = applyFrame(state, frame);
    const nativeType = frame.native?.value?.type;
    return {
      index,
      frame,
      state,
      seq: state.seq,
      label: frame.kind === 'snapshot' ? `快照基线 · seq ${frame.atSeq}` : frame.kind === 'control' ? frame.code : labels[nativeType] ?? nativeType ?? `事件 ${frame.seq}`,
      edits: describeEdits(frame),
      elapsedMs: typeof frame.ts === 'number' ? Math.max(0, frame.ts - firstTimestamp) : null,
      synthetic: frame.native?.source?.interface === 'example.synthetic' || frame.sources?.some((source) => source.interface === 'example.synthetic') || false,
    };
  });
}

/** Parses a complete SSE fixture, retaining each full JSON data object. */
export function parseSSE(text) {
  return text.replace(/\r\n/g, '\n').split(/\n\n+/).flatMap((block) => {
    const lines = block.split('\n');
    const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).replace(/^ /, '')).join('\n');
    if (!data) return [];
    const frame = JSON.parse(data);
    const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
    const id = lines.find((line) => line.startsWith('id:'))?.slice(3).trim();
    requireValue(!event || event === frame.kind, 'INVALID_SSE', 'SSE event 与 JSON kind 不一致。');
    requireValue(frame.kind === 'event' ? id === `${frame.streamId}:${frame.seq}` : !id, 'INVALID_SSE', '只有事件帧携带 streamId:seq 格式的 SSE id。');
    return [frame];
  });
}
