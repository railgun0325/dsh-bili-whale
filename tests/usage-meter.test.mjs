import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { estimateCall, pricePeriod, foldUsage, summarizeUsage, createUsageReader } from '../lib/usage-meter.js'
const header = (seq=0) => ({seq,type:'request/header',time:Date.parse('2026-10-23T02:00:00Z'),data:{header:{config:{provider:'deepseek-official',model:'deepseek-flash'}}}})
const message=(seq=1,extra={})=>({seq,type:'assistant/message',time:Date.parse('2026-10-23T02:01:00Z'),data:{turn:1,step:1,usage:{inputTokens:100,cacheReadTokens:1000,outputTokens:20,cacheWriteTokens:0},...extra}})
test('settlement replaces an attempt sample while a billed retry counts separately',()=>{
  const initial={...message(),type:'assistant/attempt',data:{turn:1,step:1,stream:[{type:'chunk',chunk:{type:'usage',usage:{inputTokens:30,outputTokens:5}}}]}}
  const folded=foldUsage([header(),initial,message(2),{seq:3,type:'llm/retry-started',data:{turn:1,step:1}},message(4)])
  const sum=summarizeUsage(folded.rows)
  assert.equal(sum.total.calls,2);assert.equal(sum.total.input,200);assert.equal(sum.total.cacheRead,2000);assert.equal(sum.total.output,40)
})
test('inherited fork history is not charged a second time',()=>{
  const f=foldUsage([header(),message(),{seq:2,type:'session/end-seed',data:{inherited:true}},{...message(3),data:{...message().data,turn:2}}])
  assert.equal(summarizeUsage(f.rows).total.calls,1)
})
test('cache hits are separate from uncached input and fees honor peak boundaries',()=>{
  assert.equal(pricePeriod(Date.parse('2026-10-23T00:59:59Z')),'off-peak')
  assert.equal(pricePeriod(Date.parse('2026-10-23T01:00:00Z')),'peak')
  assert.equal(pricePeriod(Date.parse('2026-10-23T04:00:00Z')),'off-peak')
  assert.equal(pricePeriod(Date.parse('2026-10-24T02:00:00Z')),'off-peak')
  assert.equal(pricePeriod(Date.parse('2026-10-01T02:00:00Z')),'off-peak')
  const row={provider:'deepseek-official',model:'deepseek-flash',time:Date.parse('2026-10-24T02:00:00Z'),input:1000000,cacheRead:1000000,output:1000000}
  assert.equal(estimateCall(row).low,5.02)
  assert.equal(estimateCall({...row,time:Date.parse('2026-10-23T02:00:00Z')}).low,10.04)
})
test('unknown models and calendars do not become fictitious zero-cost bills',()=>{
  assert.equal(estimateCall({provider:'other',model:'unknown'}),null)
  const sum=summarizeUsage({x:{provider:'other',model:'unknown',time:Date.now(),input:20}})
  assert.equal(sum.total.unpricedCalls,1);assert.equal(sum.billingExact,false)
  assert.equal(pricePeriod(Date.parse('2027-01-01T02:00:00Z')),'unknown')
})
test('real historical paging, concurrent refresh and restart remain idempotent and scoped',async t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'whale-usage-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}))
  const file=path.join(folder,'usage.json');let pages=0,through=1
  const projection={uncachedInputTokens:100,cacheReadTokens:1000,cacheWriteTokens:0,outputTokens:20}
  const ctx={sessionController:{projections:async({sessionId})=>{assert.equal(sessionId,'whale-only');return {asOfSeq:through,values:{tokenUsage:projection}}},page:async request=>{pages++;assert.equal(request.address.sessionId,'whale-only');return {records:[header(),message()].map(event=>({event})),hasMore:false}}}}
  const options={getSessionId:()=> 'whale-only',file,now:()=>Date.parse('2026-10-23T02:30:00Z')}
  const reader=createUsageReader(ctx,options);const [a,b]=await Promise.all([reader.read(),reader.read()])
  assert.equal(pages,1);assert.equal(a.total.calls,1);assert.equal(a.projectionMatches,true);assert.deepEqual(a,b)
  const restarted=createUsageReader(ctx,options);assert.equal((await restarted.read()).total.calls,1);assert.equal(pages,1)
  assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(file))).includes('header'),false)
})
