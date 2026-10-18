import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const reference = JSON.parse(readFileSync(new URL('../src/data/reference.json', import.meta.url), 'utf8'));
const source = readFileSync(new URL('../public/reference.md', import.meta.url), 'utf8');
const frames = JSON.parse(readFileSync(new URL('../src/data/stream.json', import.meta.url), 'utf8'));
const expectedIds = [
  'send-message', 'stream-events', 'get-task', 'list-tasks', 'cancel-task',
  'send-streaming', 'subscribe-task', 'event-frame', 'output-items', 'reconnect', 'a2a',
];

function* walk(fields = []) {
  for (const field of fields) {
    yield field;
    yield* walk(field.children);
  }
}

function fieldsOf(page) {
  return page.sections.flatMap((section) => [...walk(section.fields)]);
}

function getPage(id) {
  const page = reference.pages.find((entry) => entry.id === id);
  assert.ok(page, `missing page: ${id}`);
  return page;
}

function getField(pageId, path) {
  const field = fieldsOf(getPage(pageId)).find((entry) => entry.path === path);
  assert.ok(field, `missing field ${pageId}: ${path}`);
  return field;
}

function inspectSSE(text) {
  for (const block of text.replace(/\r\n/g, '\n').trim().split(/\n\n+/)) {
    const lines = block.split('\n');
    const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
    assert.ok(data, 'each SSE block must contain data');
    const frame = JSON.parse(data);
    const id = lines.find((line) => line.startsWith('id:'))?.slice(3).trim();
    const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
    if (frame.kind) {
      assert.equal(event, frame.kind);
      if (frame.kind === 'event') assert.equal(id, `${frame.streamId}:${frame.seq}`);
      else assert.equal(id, undefined, 'snapshots and controls cannot advance the event cursor');
    } else {
      assert.equal(Object.keys(frame).length, 1);
      assert.ok(['task', 'message', 'statusUpdate', 'artifactUpdate'].includes(Object.keys(frame)[0]));
      assert.equal(frame.statusUpdate?.final, undefined);
    }
  }
}

test('API destinations have stable IDs and complete readable content', () => {
  assert.deepEqual(reference.pages.map((page) => page.id), expectedIds);
  for (const page of reference.pages) {
    assert.ok(page.title && page.subtitle && page.group);
    assert.ok(page.description.length && page.description.every((entry) => typeof entry === 'string'));
    assert.ok(page.sections.length && page.examples.length);
    assert.equal(new Set(page.sections.map((section) => section.id)).size, page.sections.length);
  }
});

test('fields use complete paths and collapsed children remain addressable', () => {
  const fullPath = /^(?:request|response|frame|state)(?:(?:\.[A-Za-z_][A-Za-z0-9_]*)|(?:\[(?:\d+|i|j|k|"[^"\n]+")\]))+$/;
  function inspect(fields = [], parent) {
    for (const field of fields) {
      assert.match(field.path, fullPath);
      assert.equal(typeof field.required, 'boolean');
      assert.ok(field.name && field.type && field.description);
      if (parent) assert.ok(field.path.startsWith(`${parent}.`) || field.path.startsWith(`${parent}[`));
      inspect(field.children, field.path);
    }
  }
  for (const page of reference.pages) {
    for (const section of page.sections) {
      const fields = [...walk(section.fields)];
      assert.equal(new Set(fields.map((field) => field.path)).size, fields.length);
      inspect(section.fields);
    }
  }
});

test('all complete field paths in the reference Markdown are present', () => {
  const paths = [...source.matchAll(/^\| `((?:request|response|frame|state)\.[^`]+)`/gm)].map((match) => match[1]);
  assert.ok(paths.length > 200);
  const websitePaths = new Set(reference.pages.flatMap(fieldsOf).map((field) => field.path));
  for (const path of paths) assert.ok(websitePaths.has(path), `omitted ${path}`);
});

test('request defaults and configuration boundaries are specific to each method', () => {
  assert.equal(getField('send-message', 'request.configuration.returnImmediately').default, 'false');
  assert.match(getField('send-message', 'request.configuration.taskPushNotificationConfig').description, /不支持/);
  assert.match(getField('send-message', 'request.configuration.acceptedOutputModes').description, /不用于筛掉 native/);
  assert.match(getField('send-message', 'request.configuration.historyLength').description, /非负 int32/);
  const streaming = getField('send-streaming', 'request.configuration.returnImmediately');
  assert.equal(streaming.default, undefined);
  assert.match(streaming.description, /忽略/);
  assert.equal(getField('list-tasks', 'request.query.pageSize').default, '50');
  assert.equal(getField('list-tasks', 'request.query.includeArtifacts').default, 'false');
  assert.match(getField('stream-events', 'request.query.afterSeq').description, /排他起点/);
  assert.match(getField('stream-events', 'request.query.throughSeq').description, /包含上界/);
  for (const pageId of ['send-message', 'send-streaming']) {
    const paths = fieldsOf(getPage(pageId)).map((field) => field.path);
    for (const name of ['model', 'harness', 'profileId', 'workspace', 'tools', 'stream']) {
      assert.ok(!paths.includes(`request.${name}`));
    }
  }
});

test('JSON and SSE examples parse and preserve the correct response envelope', () => {
  let jsonCount = 0;
  let sseCount = 0;
  for (const page of reference.pages) {
    for (const example of page.examples) {
      assert.ok(example.label && example.language && example.code);
      if (example.language === 'json') {
        JSON.parse(example.code);
        jsonCount++;
      }
      if (example.language === 'text') {
        inspectSSE(example.code);
        sseCount++;
      }
    }
  }
  assert.ok(jsonCount >= 17);
  assert.ok(sseCount >= 5);
});

test('A2A Task wrappers and state names remain distinct from shared-frame fields', () => {
  const send = JSON.parse(getPage('send-message').examples.find((example) => example.label === '响应 · Task').code);
  assert.ok(send.task.id && send.task.metadata);
  const get = JSON.parse(getPage('get-task').examples.find((example) => example.language === 'json').code);
  const cancel = JSON.parse(getPage('cancel-task').examples.find((example) => example.language === 'json').code);
  assert.ok(get.id && cancel.id);
  assert.equal(get.task, undefined);
  assert.equal(cancel.task, undefined);
  assert.equal(cancel.status.state, 'TASK_STATE_CANCELED');
  const known = new Set([
    'TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING', 'TASK_STATE_INPUT_REQUIRED', 'TASK_STATE_AUTH_REQUIRED',
    'TASK_STATE_COMPLETED', 'TASK_STATE_FAILED', 'TASK_STATE_CANCELED', 'TASK_STATE_REJECTED', 'TASK_STATE_UNSPECIFIED',
  ]);
  const actual = [...JSON.stringify(reference).matchAll(/TASK_STATE_[A-Z_]+/g)].map((match) => match[0]);
  assert.deepEqual(new Set(actual), known);
});

test('incremental examples preserve complete native records and authoritative text', () => {
  const examples = getPage('event-frame').examples;
  const event = JSON.parse(examples.find((example) => example.label === 'EventFrame · 文本增量').code);
  const unknown = JSON.parse(examples.find((example) => example.label === '未知事件 · 原样保留').code);
  assert.deepEqual(event, frames.find((frame) => frame.seq === 11));
  assert.deepEqual(unknown, frames.find((frame) => frame.seq === 16));
  assert.equal(event.output.edits[0].op, 'text.append');
  assert.ok(event.native.value.text.endsWith(event.output.edits[0].text));
  assert.equal(unknown.output.status, 'unmapped');
  assert.deepEqual(unknown.output.edits, []);
  assert.deepEqual(unknown.native.value.unknownFields, { nested: [1, { keep: true }] });
  assert.match(getField('event-frame', 'frame.native.value').description, /任意 JSON/);
});

test('search records retain exact paths and survive deep-link encoding without modifying content', () => {
  const before = JSON.stringify(reference);
  const records = reference.pages.flatMap((page) => page.sections.flatMap((section) =>
    [...walk(section.fields)].map((field) => ({
      pageId: page.id, sectionId: section.id, field: field.path, text: `${field.path} ${field.description}`,
    }))));
  assert.ok(records.length > 400);
  for (const record of records) {
    const params = new URLSearchParams({ field: record.field, section: record.sectionId });
    assert.equal(new URLSearchParams(params.toString()).get('field'), record.field);
    const section = getPage(record.pageId).sections.find((entry) => entry.id === record.sectionId);
    assert.ok([...walk(section.fields)].some((field) => field.path === record.field));
  }
  const expected = [
    ['send-message', 'request.message.parts[i].data'],
    ['send-message', 'response.task.metadata["https://agent.example.com/extensions/harness-stream/v1"].eventsUrl'],
    ['output-items', 'state.items[i].children'],
    ['event-frame', 'frame.native.source.interface'],
    ['list-tasks', 'response.tasks[i].history[j].messageId'],
  ];
  for (const [pageId, path] of expected) assert.ok(records.some((record) => record.pageId === pageId && record.field === path));
  assert.equal(JSON.stringify(reference), before);
});
