import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const source=fs.readFileSync(new URL('../lib/client.js',import.meta.url),'utf8')
function render(loaded,runtime=null,usage=null){
  let api,index=0
  const react={createElement:(tag,props,...children)=>({tag:typeof tag==='function'?tag.name:tag,props,children}),useCallback:fn=>fn,useEffect:()=>{},useState:initial=>{
    const n=index++;return [n===0&&loaded?{night:{windows:[]},listen:{dm:true},privateReply:{enabled:true}}:n===5?runtime:n===12?usage:initial,()=>{}]
  }}
  vm.runInNewContext(source,{window:{__ModuleLoader__:{load:({factory})=>{api=factory(name=>{assert.equal(name,'react');return react})}}},console,Date,setInterval,clearInterval})
  return JSON.stringify(api.BiliWhaleSection())
}
test('native settings section renders before and after configuration loads',()=>{
  assert.match(render(false),/读取中/)
  assert.match(render(true),/运行状态/)
})
test('runtime section distinguishes running controls, idle model and sent DM',()=>{
  const text=render(true,{controls:{autoBrowse:true,dm:true},sessionRunning:false,plan:{atText:'2026-10-24 05:38',wakes:0},runtime:{dmState:'没有新私信'},dm:{usedToday:1,max:6,lastAttempt:{at:'2026-10-23T17:32:51Z',status:'success'}}})
  assert.match(text,/自动选片：已开启/);assert.match(text,/主人私信：已开启/)
  assert.match(text,/空闲，等待消息或计划/);assert.match(text,/接口确认成功/);assert.match(text,/今日 1\/6/)
})
test('owner mode displays unlimited request quota separately from background actions',()=>{
  const text=render(true,{controls:{autoBrowse:true,dm:true},ownerCommand:{enabled:true,commentsToday:2},runtime:{dmState:'没有新私信'},dm:{usedToday:4,max:null,unlimited:true}})
  assert.match(text,/主人通道不限每日次数/);assert.match(text,/不占后台额度/);assert.match(text,/今日公开发送记录 2 次/)
})
test('persona editor has real vertical space and primary buttons have readable explicit contrast',()=>{
  const tree=render(true)
  assert.match(tree,/280px/);assert.match(tree,/40vh/);assert.match(tree,/\"rows\":16/)
  assert.match(source,/background:#315fa8;color:#fff/)
  const luminance=hex=>{const a=hex.match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return a[0]*.2126+a[1]*.7152+a[2]*.0722}
  assert.ok((luminance('ffffff')+.05)/(luminance('315fa8')+.05)>4.5)
})
test('usage card labels actual token counts and estimated dedicated-session fees',()=>{
  const sum={calls:2,totalTokens:12345,input:100,cacheRead:12000,output:245,estimatedCostLow:.12,estimatedCostHigh:.12,unpricedCalls:0}
  const tree=render(true,null,{today:sum,total:sum,month:sum,pricing:{checkedAt:'2026-10-24'},projectionMatches:true})
  assert.match(tree,/12,345/);assert.match(tree,/¥0.1200/);assert.match(tree,/非平台结算账单/);assert.match(tree,/每5秒刷新/)
})
