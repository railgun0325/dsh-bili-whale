import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
let api
const h = (tag, props, ...children) => ({tag, props: props ?? {}, children: children.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false)})
vm.runInNewContext(fs.readFileSync(new URL('../lib/client.js',import.meta.url),'utf8'),{
  window:{__ModuleLoader__:{load:({factory})=>{api=factory(()=>({createElement:h}))}}}, Date
})
const now = Date.parse('2026-10-24T05:00:00+08:00')
const status = {controls:{autoBrowse:true,dm:true},sessionRunning:false,runtime:{lastTickAt:new Date(now-1000).toISOString()},plan:{action:'wake',atText:'2026-10-24 05:38',wakes:0}}
const cfg={night:{maxWakesPerDay:2}}
const nodes = tree => typeof tree==='object' && tree ? [tree,...tree.children.flatMap(nodes)] : []
const sum=(cost=0)=>({calls:2,totalTokens:1000,input:100,cacheRead:800,cacheWrite:0,output:100,estimatedCostLow:cost,estimatedCostHigh:cost,unpricedCalls:0})

test('idle session with a current heartbeat is automatically waiting and uses Beijing planned time',()=>{
  const v=api.buildRuntimeView(status,cfg,now)
  assert.equal(v.state,'自动待命');assert.equal(v.tone,'ok')
  assert.equal(v.next,'05:38');assert.match(v.nextHint,/今天 · 约 38 分钟后/)
  assert.equal(v.maxWakes,2)
})
test('stale, missing, failed and stopped telemetry never looks like healthy automation',()=>{
  assert.equal(api.buildRuntimeView({...status,runtime:{lastTickAt:new Date(now-181000).toISOString()}},cfg,now).tone,'warn')
  assert.equal(api.buildRuntimeView({...status,runtime:{}},cfg,now).state,'等待调度心跳')
  assert.equal(api.buildRuntimeView(status,cfg,now,'HTTP 503').state,'状态读取失败')
  assert.equal(api.buildRuntimeView({...status,runtime:{stopped:true}},cfg,now).state,'调度已停止')
})
test('paused, active, done, skipped and past-due plans distinguish their actual meaning',()=>{
  assert.equal(api.buildRuntimeView({...status,controls:{dm:true,autoBrowse:false}},cfg,now).next,'已暂停')
  assert.equal(api.buildRuntimeView({...status,sessionRunning:true},cfg,now).state,'正在处理任务')
  assert.equal(api.buildRuntimeView({...status,plan:{action:'done'}},cfg,now).next,'今日已结束')
  assert.equal(api.buildRuntimeView({...status,plan:{...status.plan,action:'skip'}},cfg,now).next,'本轮休息')
  assert.equal(api.buildRuntimeView({...status,plan:{...status.plan,atText:'2026-10-24 04:59'}},cfg,now).next,'等待调度')
  const v=api.buildRuntimeView({...status,activity:{allowed:false}},cfg,now)
  assert.match(v.description,/主人私信继续检查/)
})
test('donut represents exact token composition; cache rate excludes generated output',()=>{
  const v=api.buildTokenBreakdown(sum())
  assert.equal(v.total,1000)
  assert.equal(v.segments.reduce((n,x)=>n+x.percent,0),100)
  assert.ok(Math.abs(v.inputCacheRate-800/900*100)<1e-10)
  assert.equal(v.segments[0].offset,0)
  assert.equal(v.segments[1].offset,80)
  assert.equal(v.segments[2].percent,10)
})
test('empty usage has no fabricated percentage and malformed token counts cannot produce NaN',()=>{
  for(const data of [null,{}, {input:-1,cacheRead:NaN,output:Infinity,totalTokens:0}]){
    const v=api.buildTokenBreakdown(data)
    assert.equal(v.total,0);assert.equal(v.inputCacheRate,null)
    assert.ok(v.segments.every(x=>x.percent===0))
  }
})
test('cache writes and unclassified usage remain visible and reconcile to reported totals',()=>{
  const v=api.buildTokenBreakdown({...sum(),cacheWrite:50,totalTokens:1100})
  assert.equal(v.total,1100)
  assert.equal(v.segments.find(x=>x.key==='other').value,50)
  assert.equal(v.segments.find(x=>x.key==='cacheWrite').value,50)
  assert.ok(Math.abs(v.segments.reduce((n,x)=>n+x.percent,0)-100)<1e-10)
  assert.equal(api.buildTokenBreakdown({...sum(),totalTokens:500}).inconsistent,true)
})
test('unknown model pricing stays unknown, partial pricing is a lower bound, real zero remains zero',()=>{
  assert.equal(api.formatCost(null),'暂无法估算')
  assert.equal(api.formatCost({calls:1,unpricedCalls:1,estimatedCostLow:0,estimatedCostHigh:0}),'暂无法估算')
  assert.equal(api.formatCost({...sum(),estimatedCostLow:null}),'暂无法估算')
  assert.equal(api.formatCost({...sum(.12),unpricedCalls:1}),'至少 ¥0.1200')
  assert.equal(api.formatCost({...sum(.12),estimatedCostHigh:.24}),'¥0.1200–0.2400')
  assert.equal(api.formatCost(sum()),'¥0.0000')
})
test('period controls display their own data and send only a local period selection',()=>{
  const usage={today:sum(.12),month:{...sum(.45),totalTokens:2000},total:{...sum(.99),totalTokens:3000}}
  let selected
  const tree=api.renderUsageOverview({usage,period:'month',setPeriod:key=>{selected=key}})
  const list=nodes(tree), text=JSON.stringify(tree)
  assert.match(text,/¥0.4500/);assert.doesNotMatch(text,/¥0.1200/)
  assert.match(text,/2,000/);assert.match(text,/非平台结算账单/)
  const buttons=list.filter(x=>x.tag==='button')
  assert.equal(buttons.filter(x=>x.props['aria-pressed']).length,1)
  assert.equal(buttons.find(x=>x.props['aria-pressed']).children[0],'本月')
  buttons.find(x=>x.children[0]==='累计').props.onClick()
  assert.equal(selected,'total')
  assert.ok(list.some(x=>x.tag==='svg'&&x.props.role==='img'&&x.props['aria-label'].includes('未缓存输入 100')))
})
test('billing mismatch and stale-response errors remain visible outside collapsed details',()=>{
  const tree=api.renderUsageOverview({usage:{today:sum(.12),projectionMatches:false},error:'HTTP 503',setPeriod:()=>{}})
  const alerts=nodes(tree).filter(x=>x.props.role==='alert')
  assert.equal(alerts.length,2)
  assert.match(JSON.stringify(alerts),/尚未对齐/);assert.match(JSON.stringify(alerts),/最近一次成功数据/)
})
