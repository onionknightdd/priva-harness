import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fieldProvenance, provenanceText } from '../src/lib/provenance.mjs';

const reference = JSON.parse(readFileSync(new URL('../src/data/reference.json', import.meta.url), 'utf8'));
const document = readFileSync(new URL('../../api/harness-http-api-reference.md', import.meta.url), 'utf8');
const download = readFileSync(new URL('../public/reference.md', import.meta.url), 'utf8');
const uri = 'https://agent.example.com/extensions/harness-stream/v1';

function* walk(fields = []) {
  for (const field of fields) {
    yield field;
    yield* walk(field.children);
  }
}

const entries = reference.pages.flatMap(page => page.sections.flatMap(section =>
  [...walk(section.fields)].map(field => ({ page, section, field }))));

function field(pageId, path, sectionId) {
  const entry = entries.find(entry => entry.page.id === pageId && entry.field.path === path &&
    (!sectionId || entry.section.id === sectionId));
  assert.ok(entry, `missing ${pageId} / ${sectionId || '*'} / ${path}`);
  return entry.field;
}

test('every field has explicit provenance with a resolvable source, including collapsed children', () => {
  assert.equal(entries.length, 450);
  const totals = { a2a: 0, harness: 0, transport: 0 };
  for (const { field } of entries) {
    const provenance = fieldProvenance(field, reference.provenanceSources);
    totals[provenance.origin]++;
    assert.ok(provenanceText(field, reference.provenanceSources).includes(provenance.label));
    if (provenance.source.url.startsWith('#')) {
      const [id, query] = provenance.source.url.slice(1).split('?');
      const page = reference.pages.find(page => page.id === id);
      assert.ok(page, `invalid source page ${id}`);
      const section = new URLSearchParams(query).get('section');
      if (section) assert.ok(page.sections.some(entry => entry.id === section));
    } else {
      assert.equal(new URL(provenance.source.url).protocol, 'https:');
      if (provenance.origin === 'a2a') assert.ok(provenance.source.url.includes('/A2A/blob/v1.0.1/'));
    }
  }
  assert.deepEqual(totals, { a2a: 224, harness: 220, transport: 6 });
  assert.throws(() => fieldProvenance({ path: 'missing' }, reference.provenanceSources), /来源不完整/);
  assert.throws(() => fieldProvenance({ path: 'bad', provenance: { origin: 'a2a', ref: 'missing' } }, reference.provenanceSources), /来源不完整/);
});

test('standard containers, custom payload fields, transport headers and platform mappings remain distinct', () => {
  const context = field('send-message', 'request.message.contextId');
  assert.equal(context.provenance.origin, 'a2a');
  assert.match(context.provenance.convention, /sessionId/);
  assert.equal(field('send-message', 'request.message.role').provenance.origin, 'a2a');
  assert.equal(field('send-message', 'response.task.metadata').provenance.origin, 'a2a');
  assert.equal(field('send-message', `response.task.metadata["${uri}"].eventsUrl`).provenance.origin, 'harness');
  assert.match(field('send-message', `request.message.metadata["${uri}"].interactionId`).provenance.convention, /InteractionItem.requestId/);
  assert.equal(field('stream-events', 'request.headers["Last-Event-ID"]').provenance.origin, 'transport');
  assert.match(field('stream-events', 'request.headers["Last-Event-ID"]').provenance.convention, /streamId:seq/);
  assert.equal(field('stream-events', 'request.headers["A2A-Extensions"]').provenance.origin, 'a2a');
  assert.equal(field('stream-events', 'request.query.afterSeq').provenance.origin, 'harness');
  assert.equal(field('output-items', 'state.items[i].role').provenance.origin, 'harness');
  assert.match(field('output-items', 'state.items[i].role').provenance.convention, /system 没有 A2A 同名角色/);
  assert.match(field('output-items', 'state.items[i].runId', 'run').provenance.convention, /必须为非空/);
  assert.doesNotMatch(field('output-items', 'state.items[i].runId', 'run').provenance.convention, /脱离主运行时允许 null/);
  assert.match(field('event-frame', 'frame.native.value').provenance.note, /内部.*原始 harness/);
  assert.match(field('send-message', 'request.message.parts[i].data').provenance.note, /approved.*不是固定协议字段/);
});

test('A2A required members are marked inside optional objects while product constraints stay identified', () => {
  for (const { field } of entries) {
    const { origin, ref } = field.provenance;
    if (origin !== 'a2a') continue;
    const standardRequired = {
      Message: ['messageId', 'role', 'parts'],
      Artifact: ['artifactId', 'parts'],
      ListTasksResponse: ['tasks', 'nextPageToken', 'pageSize', 'totalSize'],
    };
    if (standardRequired[ref]?.includes(field.name)) assert.equal(field.required, true, field.path);
  }
  assert.match(field('send-message', 'response.task').provenance.convention, /Task 或独立 Message/);
  assert.match(field('send-message', 'response.task.contextId').provenance.convention, /未将它标为 REQUIRED/);
  assert.match(field('send-message', 'request.headers["Content-Type"]').provenance.convention, /SHOULD/);
  assert.match(field('send-message', 'request.headers["A2A-Extensions"]').provenance.convention, /SHOULD/);
});

test('downloaded reference preserves source labels without adding annotations to wire examples', () => {
  assert.equal(download, document);
  const rows = document.split('\n').filter(line => /^\| `(?:request|response|frame|state)\./.test(line));
  assert.ok(rows.length > 250);
  for (const row of rows) assert.match(row, /\*\*(?:A2A 标准|自定义扩展|HTTP \/ SSE 标准)\*\*/);
  for (const page of reference.pages) {
    for (const example of page.examples) {
      assert.doesNotMatch(example.code, /"provenance"|"provenanceSources"/);
    }
  }
  assert.match(document, /SSE 包装来源/);
  assert.match(document, /approved.*业务示例/);
});
