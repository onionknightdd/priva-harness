import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { applyFrame, describeEdits, formatPath, getTimeline, parseSSE } from '../src/lib/stream.mjs';

const frames = JSON.parse(readFileSync(new URL('../src/data/stream.json', import.meta.url), 'utf8'));
const sessionSSE = readFileSync(new URL('../public/session.sse', import.meta.url), 'utf8');
const reconnectSSE = readFileSync(new URL('../public/reconnect.sse', import.meta.url), 'utf8');
const timeline = getTimeline(frames);

test('all 17 synthetic frames replay to the expected final output without losing native content', () => {
  assert.equal(frames.length, 17);
  assert.equal(timeline.length, 17);
  assert.ok(timeline.every((entry) => entry.synthetic));
  const final = timeline.at(-1).state;
  assert.equal(final.seq, 16);
  assert.equal(final.items.length, 7);
  assert.equal(final.items[1].timing.durationMs, 1200);
  assert.equal(final.items[2].timing.durationMs, 300);
  assert.equal(final.items[3].children[1].content[0].text, '已确认源码和文档目录。');
  assert.equal(final.items[5].content[0].text, '项目包含 src/ 和 docs/。已读取 README，后台测试仍在运行。');
  assert.deepEqual(final.rawFrames, frames);
  assert.deepEqual(final.rawFrames.at(-1).native.value.unknownFields, { nested: [1, { keep: true }] });
  assert.deepEqual(final.items, timeline[15].state.items);
});

test('SSE payloads retain every field and validate event cursors', () => {
  assert.deepEqual(parseSSE(sessionSSE), frames);
  assert.throws(() => parseSSE(sessionSSE.replace('id: stream-1:1', 'id: stream-1:2')), { code: 'INVALID_SSE' });
});

test('snapshot 8 plus events 9–16 reaches the same tree as uninterrupted playback', () => {
  const resumed = parseSSE(reconnectSSE);
  assert.equal(resumed[0].atSeq, 8);
  assert.deepEqual(resumed[0].items, timeline[8].state.items);
  const final = getTimeline(resumed).at(-1).state;
  assert.deepEqual(final.items, timeline.at(-1).state.items);
  assert.equal(final.seq, 16);
  assert.equal(final.baselineAtSeq, 8);
  assert.equal(final.rawFrames.filter((frame) => frame.kind === 'event').length, 8);
  assert.deepEqual(final.rawFrames.filter((frame) => frame.kind === 'event'), frames.slice(9));
});

test('reconnecting an existing consumer preserves earlier native records', () => {
  const resumed = parseSSE(reconnectSSE);
  const final = resumed.reduce(applyFrame, timeline[8].state);
  assert.deepEqual(final.items, timeline.at(-1).state.items);
  assert.deepEqual(final.rawFrames.filter((frame) => frame.kind === 'event'), frames.slice(1));
});

test('duplicate events do not append text or advance cursor twice', () => {
  const state = timeline[11].state;
  assert.strictEqual(applyFrame(state, frames[11]), state);
  assert.strictEqual(applyFrame(state, frames[2]), state);
  assert.equal(state.items[5].content[0].text, '项目包含 src/ 和 docs/。已读取 README，后台测试仍在运行。');
});

test('sequence gaps and new stream identities require recovery', () => {
  assert.throws(() => applyFrame(timeline[8].state, frames[10]), { code: 'SEQUENCE_GAP' });
  assert.throws(() => applyFrame(timeline[8].state, { ...frames[9], streamId: 'stream-2' }), { code: 'STREAM_MISMATCH' });
  assert.throws(() => applyFrame(null, frames[1]), { code: 'BASELINE_REQUIRED' });
});

test('an invalid later edit cannot partially commit earlier edits or raw frames', () => {
  const state = timeline[8].state;
  const before = structuredClone(state);
  const badFrame = structuredClone(frames[9]);
  badFrame.output.edits = [
    { op: 'set', path: ['items', 0, 'status'], value: 'complete' },
    { op: 'set', path: ['items', 99, 'status'], value: 'complete' },
  ];
  assert.throws(() => applyFrame(state, badFrame), { code: 'OUT_OF_BOUNDS' });
  assert.deepEqual(state, before);
});

test('each edit resolves positions against the result of the previous edit', () => {
  const frame = structuredClone(frames[10]);
  frame.output.edits.push({ op: 'text.append', path: ['items', 5, 'content', 0, 'text'], text: ' 新增后立即追加。' });
  const state = applyFrame(timeline[9].state, frame);
  assert.equal(state.items[5].content[0].text, '项目包含 src/ 和 docs/。 新增后立即追加。');
  assert.equal(timeline[9].state.items.length, 5);
});

test('authoritative text corrections use set instead of re-appending a full answer', () => {
  const frame = structuredClone(frames[11]);
  frame.output.edits[0] = { op: 'set', path: ['items', 5, 'content', 0, 'text'], value: '修订后的完整回复。' };
  const state = applyFrame(timeline[10].state, frame);
  assert.equal(state.items[5].content[0].text, '修订后的完整回复。');
  assert.equal(state.items[5].status, 'complete');
});

test('detached background work keeps rendering after main run completion', () => {
  assert.equal(timeline[12].state.items[0].status, 'complete');
  assert.equal(timeline[12].state.items[4].status, 'running');
  assert.equal(timeline[13].state.items[4].children[0].output[0].text, '8/12 tests passed');
  assert.equal(timeline[14].state.items[4].status, 'complete');
  assert.equal(timeline[14].state.items[4].children[0].output[0].text, '12 tests passed');
  assert.equal(timeline[14].state.items[4].runId, null);
  assert.equal(timeline[14].state.items[4].originRunId, 'run-1');
  assert.equal(timeline[15].state.items[6].phase, 'notification');
});

test('full dot paths and actual suffix values describe the transmitted delta', () => {
  assert.equal(formatPath(['items', 3, 'children', 0, 'output', 0, 'text']), 'state.items[3].children[0].output[0].text');
  assert.equal(formatPath(['items', 3, 'children'], ''), 'items[3].children');
  const append = describeEdits(frames[11])[0];
  assert.equal(append.path, 'state.items[5].content[0].text');
  assert.equal(append.framePath, 'frame.output.edits[0].text');
  assert.equal(append.value, '已读取 README，后台测试仍在运行。');
  assert.deepEqual(describeEdits(frames[7])[0].targets, ['state.items[3].children[0]']);
});

test('identity changes, unsafe paths, invalid types, and duplicate ids fail atomically', () => {
  const state = timeline[8].state;
  const invalidEdits = [
    { op: 'set', path: ['items', 0, 'id'], value: 'new-id' },
    { op: 'set', path: ['items', 0, '__proto__'], value: {} },
    { op: 'set', path: ['items', 0, 'status'], value: 123 },
    { op: 'text.append', path: ['items', 0, 'model'], text: 'x' },
    { op: 'set', path: ['items', 2, 'input', 'value', 'path'], value: 'secret' },
    { op: 'splice', path: ['items'], index: 5, deleteCount: 0, items: [state.items[0]] },
  ];
  for (const edit of invalidEdits) {
    const frame = structuredClone(frames[9]);
    frame.output.edits = [edit];
    assert.throws(() => applyFrame(state, frame));
  }
  assert.equal(state.seq, 8);
  assert.equal(state.items[0].id, 'run-1');
});

test('applied state and saved native records cannot be mutated by the input frame', () => {
  const input = structuredClone(frames[1]);
  const state = applyFrame(timeline[0].state, input);
  input.native.value.model = 'changed';
  input.output.edits[0].items[0].model = 'changed';
  assert.equal(state.rawFrames[1].native.value.model, 'example-model');
  assert.equal(state.items[0].model, 'example-model');
});

test('control frames remain visible as raw records without changing output or cursor', () => {
  const state = timeline.at(-1).state;
  const control = { v: 3, kind: 'control', streamId: 'stream-1', code: 'stream.closed', details: { atSeq: 16, reason: 'export_complete' } };
  const next = applyFrame(state, control);
  assert.equal(next.seq, 16);
  assert.strictEqual(next.items, state.items);
  assert.deepEqual(next.rawFrames.at(-1), control);
});
