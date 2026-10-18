const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const {createRequire} = require('node:module');
const root = path.resolve(__dirname, '../../../..');
const api = path.resolve(__dirname, '../api');
const req = createRequire(root + '/services/agent-runner/ts/package.json');
const ajvReq = createRequire(req.resolve('@fastify/ajv-compiler'));
const Ajv = ajvReq('ajv/dist/2020').default;
const legacy = JSON.parse(fs.readFileSync(path.join(api, 'harness-stream-v3.schema.json'),'utf8'));
const ajv = new Ajv({strict:true,allErrors:true});
ajv.addSchema(legacy,'old-shared');
const itemValid = ajv.compile({$ref:'old-shared#/$defs/OutputItem'});
const envelopeValid = ajv.getSchema('old-shared');
const dir = path.join(api, 'examples/harness-stream-v3-delta-proposal/');
const parseLines = p => fs.readFileSync(p,'utf8').trim().split('\n').map(JSON.parse);
const frames = parseLines(dir+'session.jsonl');
const prior = parseLines(path.join(api, 'examples/harness-stream-v3/session.jsonl'));
const parseSse = p => fs.readFileSync(p,'utf8').trim().split('\n\n').map(block=>{
 const lines=block.split('\n');
 const f=JSON.parse(lines.find(l=>l.startsWith('data: ')).slice(6));
 assert(lines.includes('event: '+f.kind));
 const ids=lines.filter(l=>l.startsWith('id: '));
 assert.deepEqual(ids,f.kind==='event'?['id: '+f.streamId+':'+f.seq]:[]);
 return f;
});
assert.deepEqual(parseSse(dir+'session.sse'),frames);
const key = (obj,k) => {assert(obj && typeof obj==='object' && Object.hasOwn(obj,k),'missing path'); return obj[k];};
function apply(s,f){
 if(f.kind==='snapshot') return {streamId:f.streamId,seq:f.atSeq,items:structuredClone(f.items)};
 assert.equal(f.streamId,s.streamId,'wrong stream');
 if(f.seq<=s.seq)return s;
 assert.equal(f.seq,s.seq+1,'sequence gap');
 const next=structuredClone(s);
 for(const e of f.output.edits){
  assert.equal(e.path[0],'items');
  if(e.op==='splice'){
   let array=next;for(const p of e.path)array=key(array,p);
   assert(Array.isArray(array));
   assert(Number.isSafeInteger(e.index)&&e.index>=0&&e.index<=array.length);
   assert(Number.isSafeInteger(e.deleteCount)&&e.deleteCount>=0&&e.deleteCount<=array.length-e.index);
   array.splice(e.index,e.deleteCount,...structuredClone(e.items));
  }else{
   let owner=next;for(const p of e.path.slice(0,-1))owner=key(owner,p);
   const name=e.path.at(-1), old=key(owner,name);
   if(e.op==='set')owner[name]=structuredClone(e.value);
   else {assert.equal(e.op,'text.append');assert.equal(typeof old,'string');assert.equal(typeof e.text,'string');owner[name]+=e.text;}
  }
 }
 const ids=new Set();
 function walk(i){assert(itemValid(i),JSON.stringify(itemValid.errors));assert(!ids.has(i.id),'duplicate id');ids.add(i.id);for(const c of i.children??[])walk(c);}
 next.items.forEach(walk);next.seq=f.seq;return next;
}
let current={},oldItems=[],checks=0;const states=[];
for(let n=0;n<frames.length;n++){
 const f=frames[n],base=prior[n];
 const envelope=structuredClone(f);if(envelope.kind==='event')envelope.output.edits=[];
 assert(envelopeValid(envelope),JSON.stringify(envelopeValid.errors));
 if(f.kind==='event'){
  assert.deepEqual(f.native,base.native);checks++;
  for(const e of base.output.edits)oldItems.splice(e.index,e.deleteCount,...structuredClone(e.items));
 }
 current=apply(current,f);
 assert.deepEqual(current.items,oldItems);states.push(structuredClone(current));
}
assert.deepEqual(current.items,JSON.parse(fs.readFileSync(path.join(api, 'examples/harness-stream-v3/final-snapshot.json'),'utf8')).items);
assert.deepEqual(parseSse(dir+'reconnect.sse').reduce(apply,{}),current);
assert.deepEqual(apply(current,frames[11]),current);
assert.throws(()=>apply(states[8],frames[10]),/sequence gap/);
const invalid=structuredClone(frames[11]);invalid.output.edits.push({op:'set',path:['items',99,'status'],value:'complete'});
const unchanged=structuredClone(states[10]);assert.throws(()=>apply(unchanged,invalid));assert.deepEqual(unchanged,states[10]);
const wrong=structuredClone(frames[11]);wrong.streamId='stream-2';assert.throws(()=>apply(states[10],wrong),/wrong stream/);
const corrected=structuredClone(frames[11]);corrected.output.edits[0]={op:'set',path:['items',5,'content',0,'text'],value:'权威终稿修改了此前内容。'};
assert.equal(apply(states[10],corrected).items[5].content[0].text,'权威终稿修改了此前内容。');
assert.equal(states[12].items[0].status,'complete');assert.equal(states[12].items[4].status,'running');
assert.equal(frames[16].output.status,'unmapped');assert.deepEqual(frames[16].native.value.unknownFields.nested,[1,{keep:true}]);
const docPath=path.join(api, 'harness-http-api-reference.md');const doc=fs.readFileSync(docPath,'utf8');
const jsonBlocks=[...doc.matchAll(/```json\n([\s\S]*?)\n```/g)].map(m=>JSON.parse(m[1]));
assert.deepEqual(jsonBlocks.find(x=>x.kind==='event'),frames[11]);
let linkCount=0;
for(const m of doc.matchAll(/\]\(([^)]+)\)/g)){
 const link=m[1];if(/^(https?:|#)/.test(link))continue;
 assert(fs.existsSync(path.resolve(path.dirname(docPath),link.split('#')[0])),'missing link '+link);linkCount++;
}
assert(!doc.split('\n').some(l=>/[ \t]+$/.test(l)),'trailing whitespace');
console.log(JSON.stringify({jsonBlocksParsed:jsonBlocks.length,localLinksChecked:linkCount,exampleFrames:frames.length,perEventNativeParity:checks,perFrameProjectionParity:frames.length,ssePayloadAndIdParity:true,reconnectParity:true,duplicateIgnored:true,gapRejected:true,invalidFrameAtomic:true,wrongStreamRejected:true,authoritativeCorrection:true,backgroundContinues:true,scope:'Example replay and unchanged envelope/component types only; no new delta machine schema or HTTP implementation/SDK interoperability validation.'},null,2));
