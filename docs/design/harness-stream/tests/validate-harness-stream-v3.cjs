const fs=require('node:fs');
const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const path=require('node:path');
const root=path.resolve(__dirname,'../../../..');
const api=path.resolve(__dirname,'../api');
const req=createRequire(root+'/services/agent-runner/ts/package.json');
const ajvReq=createRequire(req.resolve('@fastify/ajv-compiler'));
const Ajv=ajvReq('ajv/dist/2020').default;
const schema=JSON.parse(fs.readFileSync(path.join(api,'harness-stream-v3.schema.json'),'utf8'));
const ajv=new Ajv({strict:true,allErrors:true});const validate=ajv.compile(schema);
const dir=path.join(api,'examples/harness-stream-v3/');
const jsonl=name=>fs.readFileSync(dir+name,'utf8').trim().split('\n').map(JSON.parse);
const sse=name=>[...fs.readFileSync(dir+name,'utf8').matchAll(/^data: (.*)$/gm)].map(m=>JSON.parse(m[1]));
let structural=0;
for(const file of fs.readdirSync(dir)){
 if(file==='a2a.sse')continue;
 const values=file.endsWith('.jsonl')?jsonl(file):file.endsWith('.sse')?sse(file):[JSON.parse(fs.readFileSync(dir+file,'utf8'))];
 for(const value of values){assert(validate(value),file+': '+JSON.stringify(validate.errors));structural++;}
}
const frames=jsonl('session.jsonl');assert.deepEqual(frames,sse('session.sse'));
function unique(items){const seen=new Set();const visit=i=>{assert(!seen.has(i.id),'duplicate item id');seen.add(i.id);for(const c of i.children||[])visit(c);};items.forEach(visit);}
function apply(state,f){
 if(f.kind==='snapshot'){unique(f.items);return {streamId:f.streamId,seq:f.atSeq,items:structuredClone(f.items)};}
 assert.equal(f.streamId,state.streamId,'stream mismatch');if(f.seq<=state.seq)return state;
 assert.equal(f.seq,state.seq+1,'sequence gap');
 const items=structuredClone(state.items);
 for(const e of f.output.edits){assert(e.index<=items.length,'index out of bounds');assert(e.deleteCount<=items.length-e.index,'delete out of bounds');items.splice(e.index,e.deleteCount,...structuredClone(e.items));}
 unique(items);return {streamId:f.streamId,seq:f.seq,items};
}
let state=frames.reduce(apply,{});
const final=JSON.parse(fs.readFileSync(dir+'final-snapshot.json','utf8'));
assert.deepEqual(state.items,final.items);assert.equal(state.seq,final.atSeq);
assert.deepEqual(sse('reconnect.sse').reduce(apply,{}),state);
const duplicateFrames=[...frames.slice(0,9),frames[8],...frames.slice(9)];
assert.deepEqual(duplicateFrames.reduce(apply,{}),state);
const at8=frames.slice(0,9).reduce(apply,{});
assert.throws(()=>apply(at8,frames[10]),/sequence gap/);
const badIndex=structuredClone(frames[9]);badIndex.output.edits[0].index=99;
assert.throws(()=>apply(at8,badIndex),/index out of bounds/);assert.equal(at8.seq,8);
const wrongStream=structuredClone(frames[9]);wrongStream.streamId='stream-2';
assert.throws(()=>apply(at8,wrongStream),/stream mismatch/);
const duplicateId=structuredClone(frames[9]);duplicateId.output.edits=[{index:7,deleteCount:0,items:[at8.items[0]]}];
duplicateId.output.edits[0].index=at8.items.length;assert.throws(()=>apply(at8,duplicateId),/duplicate item id/);
const at12=frames.slice(0,13).reduce(apply,{});
assert.equal(at12.items[0].status,'complete');assert.equal(at12.items[4].status,'running');
assert.equal(final.items[4].status,'complete');assert.equal(final.items[4].originRunId,'run-1');assert.equal(final.items[4].runId,null);
assert.equal(final.items[1].timing.durationMs,1200);assert.equal(final.items[2].timing.durationMs,300);
assert.equal(frames[16].output.status,'unmapped');assert.deepEqual(frames[16].native.value.unknownFields,{nested:[1,{keep:true}]});
const a2a=sse('a2a.sse');assert.equal(a2a.length,7);
const a2aText=a2a.filter(x=>x.artifactUpdate).at(-1).artifactUpdate.artifact.parts[0].text;
assert.equal(a2aText,final.items.find(x=>x.id==='answer-1').content[0].text);
const negatives=[];
function invalid(edit){const f=structuredClone(frames[5]);edit(f);negatives.push(f);}
invalid(f=>f.uncontrolled=true);invalid(f=>delete f.native);invalid(f=>f.seq=0);
invalid(f=>f.output.edits[0].items[0].uncontrolled=true);
invalid(f=>{f.output.edits[0].items[0].input.status='streaming';f.output.edits[0].items[0].input.value={incomplete:true};});
invalid(f=>{f.output.edits[0].items[0].timing.basis='unknown';f.output.edits[0].items[0].timing.durationMs=1;});
const nullRun=structuredClone(frames[1]);nullRun.output.edits[0].items[0].runId=null;negatives.push(nullRun);
const falseIncomplete={v:3,kind:'control',streamId:'stream-1',code:'stream.incomplete',details:{integrity:{status:'complete',issues:[]}}};negatives.push(falseIncomplete);
for(const f of negatives)assert(!validate(f),'negative shape must be rejected');
// TypeScript is only a readable counterpart; check the generated declarations and examples without changing production files.
const ts=req('typescript');const typeSource=fs.readFileSync(path.join(__dirname,'fixtures/legacy/harness-stream-v3-types.ts'),'utf8');
const typeFile=path.join(__dirname,'fixtures/legacy/harness-stream-v3-typecheck.ts');
assert.equal(fs.readFileSync(typeFile,'utf8'),typeSource+'\nconst exampleFrames: SharedFrame[] = '+JSON.stringify(frames)+';\n','type-check fixture must match legacy frames');
const program=ts.createProgram([typeFile],{strict:true,noEmit:true,target:ts.ScriptTarget.ES2022,skipLibCheck:true,types:[]});
const diagnostics=ts.getPreEmitDiagnostics(program);assert.equal(diagnostics.length,0,diagnostics.map(x=>ts.flattenDiagnosticMessageText(x.messageText,'\n')).join('\n'));
console.log(JSON.stringify({schema:'draft-2020-12 strict compilation passed',shared_frames_validated:structural,invalid_shape_cases_rejected:negatives.length,semantic_checks:['WS/SSE identity','full replay = final snapshot','snapshot(8)+tail = full replay','duplicate ignored','gap rejected','invalid edit rejected atomically','wrong stream rejected','duplicate item ids rejected','background survives run completion','timing values','unknown source preserved','A2A final text parity'],typescript_examples:'passed'},null,2));
