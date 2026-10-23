import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { resolveSessionConfig } from '../lib/session-config.js'
import * as nightPlan from '../tools/lib/night-plan.mjs'
import { mentionSummaryLines } from '../lib/mention-summary.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cfgPath = '/fake/.dsh/bili-whale.config.json'
const statePath = '/fake/.dsh/whale-night.json'
const listenPath = '/fake/.dsh/whale-listen.json'
const stamp = (time) => Date.parse(`2026-10-23T${time}:00+08:00`)
const date = '2026-10-23'
const base = () => ({ night: { enabled: true, offPeakOnly: true, maxWakesPerDay: 2, windows: [{ start: '12:10', end: '13:30', wakes: 1 }, { start: '18:10', end: '23:00', wakes: 1 }] }, listen: { comment: true, allDay: true, commentIntervalSec: 600, scope: 'reply', dm: false, live: false }, interaction: { enabled: true, maxListenerWakesPerDay: 2, maxEventsPerWake: 1, maxRunMinutes: 12, daily: 3, replyDaily: 2, topLevelDaily: 1, noMention: true, maxChars: 160 }, self: { mid: '2' }, owner: { mid: '1' } })
const defer = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
const flush = async () => { for (let n = 0; n < 20; n++) await Promise.resolve() }

// 共享计划引擎的计划（schema 2，绝对时间戳）：午间窗口 12:15 已到点
const duePlan = (action = 'wake') => ({ schema: 2, date, wakes: 0, usedCount: {}, skippedWindows: [], action, fired: false, atMs: stamp('12:15'), at: 735, atText: `${date} 12:15`, window: '12:10–13:30', windowKey: `${date}|12:10–13:30`, startsAt: stamp('12:10'), endsAt: stamp('13:30') })
async function harness({ time = '12:20', config = base(), state = duePlan(), files = new Map(), list, feed, sessionStatus, writeDenied, readDenied, dmMessage } = {}) {
  let now = stamp(time)
  class Clock extends Date { constructor(...a) { super(...(a.length ? a : [now])) } static now() { return now } }
  files.set(cfgPath, structuredClone(config))
  if (!files.has(statePath) && state) files.set(statePath, state)
  if (!files.has(listenPath)) files.set(listenPath, { lastSeen: Math.floor(stamp('12:00') / 1000) })
  files.set('/fake/.bili-ai/credentials.json', {})
  const calls = { prompts: [], execs: [], feeds: [], lists: 0, renames: 0 }
  const timers = []
  const missing = () => Object.assign(new Error('missing fixture'), { code: 'ENOENT' })
  const fakeFs = {
    readFileSync(p) { if (p === readDenied) throw Object.assign(Error('read denied'), { code: 'EACCES' }); if (!files.has(p)) throw missing(); const value = files.get(p); return typeof value === 'string' ? value : JSON.stringify(value) },
    writeFileSync(p, value) { if (writeDenied === p) throw Object.assign(Error('write denied'), { code: 'EACCES' }); files.set(p, JSON.parse(value)) },
    existsSync(p) { return files.has(p) }, realpathSync(p) { if (!files.has(p)) throw missing(); return p },
    lstatSync(p) { if (!files.has(p)) throw missing(); return { isSymbolicLink: () => false } },
    renameSync(from, to) { if (writeDenied === to) throw Object.assign(Error('rename denied'), { code: 'EACCES' }); calls.renames++; files.set(to, files.get(from)); files.delete(from) },
    unlinkSync(p) { if (!files.has(p)) throw missing(); files.delete(p) },
    mkdirSync() {}, appendFileSync() {}, rmSync(p) { files.delete(p) },
  }

  const stubs = {
    'node:fs': { default: fakeFs }, 'node:path': { default: path }, 'node:os': { default: { homedir: () => '/fake' } },
    'node:child_process': { execFile(exe, args, opts, callback) { calls.execs.push(args); callback?.(null, args.includes('dm-await')&&args.includes('--once')&&dmMessage?JSON.stringify(dmMessage):'{}', ''); return { kill() {} } } },
    './session-config.js': { resolveSessionConfig },
    './model-selection.js': { async selectWhaleSessionModel() {} },
    '../tools/lib/msgfeed.mjs': { makeHeaders() { return {} }, async pullFeed(kind) { calls.feeds.push(kind); return { items: feed ? await feed(kind) : [] } } },
    './mention-summary.js': { mentionSummaryLines },
    './node-runtime.js': { resolveNodeRuntime: () => '/fake/node', nodeEnv: () => ({}) },
    '../tools/lib/paths.mjs': { HOME: '/fake', credentialsPath: '/fake/.bili-ai/credentials.json', configPath: cfgPath },
    '../tools/lib/night-plan.mjs': nightPlan,
    '../tools/lib/night-config.mjs': { readNightConfig() { let night = {}; try { const c = files.get(cfgPath); night = (c && typeof c === 'object' ? c.night : null) ?? {} } catch {} return { windows: [{ start: '20:00', end: '24:00', wakes: 1 }], skipChance: 0.3, minGapMin: 10, maxVideos: 5, ...night } } },
  }
  const context = vm.createContext({ process: { platform: 'darwin', env: {}, execPath: '/fake/node' }, Date: Clock, Intl, AbortController, Buffer, console, setInterval(fn, ms) { timers.push({ fn, ms }); return timers.length }, setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length }, clearInterval() {}, clearTimeout() {} })
  const mod = new vm.SourceTextModule(fs.readFileSync(path.join(root, 'lib/scheduler.js'), 'utf8'), {
    context,
    async importModuleDynamically(specifier) { assert.equal(specifier, './offpeak.js'); return import('../lib/offpeak.js') },
  })
  await mod.link((name) => { assert.ok(stubs[name], name); const data = stubs[name]; return new vm.SyntheticModule(Object.keys(data), function () { for (const [k, v] of Object.entries(data)) this.setExport(k, v) }, { context }) })
  await mod.evaluate()
  const scheduler = mod.namespace.startScheduler({ sessionController: { async list() { calls.lists++; if (list) await list(); return { items: [{ sessionId: 'bili-whale', cwd: '/fake', status: sessionStatus }] } }, async create() { throw Error('must resume fixture') }, async prompt(req) { calls.prompts.push(req) } } }, { dshHome: '/fake/.dsh', biliMjs: '/fake/tools/bili.mjs', cwd: '/fake' })
  return { scheduler, calls, files, timers, setTime(value) { now = stamp(value) } }
}

test('peak time suppresses due, skip, listener, and fresh planning', async () => {
  for (const state of [duePlan('wake'), duePlan('skip'), undefined]) {
    const h = await harness({ time: '14:20', state })
    await h.scheduler.tick(); await h.scheduler.listenTick()
    assert.equal(h.calls.prompts.length, 0)
    assert.equal(h.calls.execs.length, 0)
    assert.equal(h.calls.feeds.length, 0)
    h.scheduler.stop()
  }
})
test('owner instruction bypasses background peak and spent DM model budget',async()=>{
  const config=base();config.ownerCommand={enabled:true};config.privateReply={enabled:true,daily:0,pollIntervalSec:60};config.listen.dm=true
  const files=new Map([['/fake/.dsh/whale-dm-listen.json',{date,selfMid:'2',modelWakes:99}]])
  const h=await harness({time:'14:20',config,files,dmMessage:{hit:true,receipt:'owner-receipt',key:'real-owner-key',mid:'1',selfMid:'2',name:'Owner',text:'帮我找两个视频然后评论区@我',ts:Math.floor(stamp('14:19')/1000)}})
  await h.scheduler.tick();assert.equal(h.calls.prompts.length,0)
  await h.scheduler.dmTick();assert.equal(h.calls.prompts.length,1)
  const prompt=h.calls.prompts[0].content[0].text
  assert.match(prompt,/主人指令/);assert.match(prompt,/--owner-command/);assert.match(prompt,/两个视频/)
  assert.equal(h.files.get('/fake/.dsh/whale-dm-listen.json').modelWakes,100)
  assert.equal(h.files.get(statePath).wakes,0)
  h.scheduler.stop()
})
test('owner instruction includes saved voice without a persona file and rereads edits on the next wake',async()=>{
  const config=base();config.persona={name:'Whale',ownerTitle:'主人',selfClaim:'我',voice:'VOICE_ONE: 短句接梗，不写任务报告'}
  config.ownerCommand={enabled:true};config.privateReply={enabled:true,daily:0,pollIntervalSec:60};config.listen.dm=true
  const h=await harness({config,dmMessage:{hit:true,receipt:'voice-receipt',key:'voice-key',mid:'1',selfMid:'2',text:'帮我找两个视频',ts:Math.floor(stamp('12:19')/1000)}})
  try {
    await h.scheduler.dmTick()
    const first=h.calls.prompts[0].content[0].text
    assert.match(first,/你是「Whale」/);assert.ok(first.includes(config.persona.voice))
    assert.ok(first.indexOf('【说话】')>first.indexOf('--owner-command'),'speech guidance remains present after the execution instructions')
    config.persona.voice='VOICE_TWO: 自然说自己的反应，不背字幕'
    h.files.set(cfgPath,structuredClone(config));h.setTime('12:22');await h.scheduler.dmTick()
    const second=h.calls.prompts[1].content[0].text
    assert.ok(second.includes(config.persona.voice));assert.doesNotMatch(second,/VOICE_ONE/)
    assert.match(second,/--owner-command/);assert.match(second,/两个视频/)
  } finally { h.scheduler.stop() }
})
test('saved voice and dedicated persona reach scheduled sharing, ordinary interaction and owner replies',async()=>{
  for(const lane of ['sharing','interaction','reply','legacy-dm']){
    const config=base();config.persona={voice:'VOICE_FIXTURE: 有自己的小反应，最多一个表情'}
    if(lane==='sharing'){config.share={enabled:true,via:'comment',minScore:15};config.quota={shareDaily:3}}
    if(lane==='legacy-dm'){config.listen.dm=true;config.privateReply={enabled:true,daily:2,pollIntervalSec:60}}
    const files=new Map([['/fake/.bili-ai/persona.md','PERSONA_FIXTURE: 不套用旧台词，也不把网友叫主人']])
    const h=await harness({config,files,feed:async()=>[{id:'voice-reply',t:Math.floor(stamp('12:10')/1000),kind:'reply',mid:'4',oid:'10',root:'20',parent:'30'}],dmMessage:{hit:true,receipt:'legacy-voice',key:'legacy-key',mid:'1',selfMid:'2',text:'你在吗',ts:Math.floor(stamp('12:19')/1000)}})
    try {
      if(lane==='reply')await h.scheduler.listenTick()
      else if(lane==='legacy-dm')await h.scheduler.dmTick()
      else await h.scheduler.tick()
      assert.equal(h.calls.prompts.length,1,lane)
      const prompt=h.calls.prompts[0].content[0].text
      assert.ok(prompt.includes(config.persona.voice),lane)
      assert.match(prompt,/PERSONA_FIXTURE/,lane)
      assert.match(prompt,/【说话】/,lane)
    } finally {h.scheduler.stop()}
  }
})
test('enabled background sharing respects saved quota even with interaction enabled',async()=>{
  const config=base();config.share={enabled:true,via:'comment',minScore:15};config.quota={shareDaily:3}
  const h=await harness({config});await h.scheduler.tick()
  const prompt=h.calls.prompts[0].content[0].text
  assert.match(prompt,/每天上限 3 条/);assert.match(prompt,/--share --auto/);assert.match(prompt,/不使用--owner-command/)
  h.scheduler.stop()
})
test('enabled discovery routes a timed wake to the real selector and keeps current focus and publication gates',async()=>{
  const config=base();config.preferences={discovery:{enabled:true,focusSlots:1}};config.share={enabled:true,via:'comment',minScore:15};config.quota={shareDaily:3}
  const h=await harness({config})
  try {
    await h.scheduler.tick();const prompt=h.calls.prompts[0].content[0].text
    assert.match(prompt,/bili\.mjs feed --n 3 --json/);assert.match(prompt,/每三条优先 1 条/)
    assert.match(prompt,/observed_gathering/);assert.match(prompt,/private_obc_reason/)
    assert.match(prompt,/每天上限 3 条/);assert.match(prompt,/--share --auto/)
    assert.doesNotMatch(prompt,/执行 `node \.\/recommendation-context\.mjs`/)
  }finally{h.scheduler.stop()}
})
test('pending owner instruction blocks new autonomous work and waits for busy model',async()=>{
  const config=base();config.ownerCommand={enabled:true};config.privateReply={enabled:true,daily:0};config.listen.dm=true
  const h=await harness({config,sessionStatus:'running',dmMessage:{hit:true,receipt:'owner-receipt',key:'real-key',mid:'1',selfMid:'2',text:'帮我找视频',ts:Math.floor(stamp('12:19')/1000)}})
  await h.scheduler.dmTick();assert.equal(h.scheduler.status().ownerPending,true)
  await h.scheduler.tick();await h.scheduler.listenTick()
  assert.equal(h.calls.prompts.length,0);assert.equal(h.calls.feeds.length,0)
  h.scheduler.stop()
})

test('session setup crossing window end never enqueues a late wake', async () => {
  const wait = defer()
  const h = await harness({ time: '13:29', list: () => wait.promise })
  const pending = h.scheduler.tick(); await flush()
  h.setTime('13:30'); wait.resolve(); await pending
  assert.equal(h.calls.prompts.length, 0)
  h.scheduler.stop()
})

test('expired noon plan is not replayed during the evening window', async () => {
  const h = await harness({ time: '18:20' })
  await h.scheduler.tick()
  assert.equal(h.calls.prompts.length, 0)
  assert.equal(h.files.get(statePath).wakes ?? 0, 0)
  // 共享引擎：过期的午间计划不会重放；若已重排，只能是晚间窗口的新计划
  assert.notEqual(h.files.get(statePath).windowKey, `${date}|12:10–13:30`)
  h.scheduler.stop()
})

test('interactive listener emits one event and persists its daily model wake cap', async () => {
  let seq = 0
  const feed = async () => [1, 2, 3].map((n) => ({ id: String(++seq), t: Math.floor(stamp('12:10') / 1000) + seq, mid: String(n + 2), who: `fixture${n}`, kind: 'reply', oid: '100', root: '200', parent: '300' }))
  const h = await harness({ feed })
  await h.scheduler.listenTick()
  assert.equal(h.calls.prompts.length, 1)
  assert.match(h.calls.prompts[0].content[0].text, /--interaction/)
  assert.match(h.calls.prompts[0].content[0].text, /1 条/)
  const first = h.files.get(listenPath)
  assert.equal(first.modelWakes, 1)
  h.scheduler.stop()
  const second = await harness({ time: '12:40', files: h.files, feed })
  await second.scheduler.listenTick()
  assert.equal(second.calls.prompts.length, 1)
  assert.equal(second.files.get(listenPath).modelWakes, 2)
  second.scheduler.invalidate(); await flush()
  assert.equal(second.files.get(listenPath).modelWakes, 2)
  second.setTime('18:20'); await second.scheduler.listenTick()
  assert.equal(second.calls.prompts.length, 1)
  second.scheduler.stop()
})

test('scheduler prompt branches to no-mention interaction only when explicitly enabled', async () => {
  const h = await harness()
  await h.scheduler.tick()
  const text = h.calls.prompts[0].content[0].text
  assert.match(text, /--interaction/)
  assert.match(text, /不.*@/)
  assert.match(text, /12 分钟/)
  assert.match(text, /2026-10-23T05:30:00.000Z/)
  h.scheduler.stop()
})

test('peak gate also suppresses DM and live independent listener timers', async () => {
  const config = base(); Object.assign(config.listen, { dm: true, live: true, liveRoom: '123' })
  const h = await harness({ time: '14:20', config })
  await h.scheduler.liveTick()
  h.timers.find((t) => t.ms === 20_000).fn()
  await flush()
  assert.equal(h.calls.execs.length, 0)
  assert.equal(h.calls.prompts.length, 0)
  h.scheduler.stop()
})

test('running target does not enqueue either timed or interaction work', async () => {
  const h = await harness({ sessionStatus: 'running', feed: async () => [{ id: '1', t: Math.floor(stamp('12:10') / 1000), kind: 'reply', mid: '4' }] })
  await h.scheduler.tick(); await h.scheduler.listenTick()
  assert.equal(h.calls.prompts.length, 0)
  assert.equal(h.files.get(listenPath).modelWakes ?? 0, 0)
  h.scheduler.stop()
})

test('zero listener model allowance performs no inbox pulls or wakes', async () => {
  const config = base(); config.interaction.maxListenerWakesPerDay = 0
  const h = await harness({ config })
  await h.scheduler.listenTick()
  assert.equal(h.calls.feeds.length, 0)
  assert.equal(h.calls.prompts.length, 0)
  h.scheduler.stop()
})

test('unwritable persistent wake counters fail closed before model dispatch', async () => {
  for (const writeDenied of [statePath, listenPath]) {
    const h = await harness({ writeDenied })
    await h.scheduler.tick()
    assert.equal(h.calls.prompts.length, 0)
    h.scheduler.stop()
  }
  const h = await harness({ writeDenied: listenPath, feed: async () => [{ id: '1', t: Math.floor(stamp('12:10') / 1000), kind: 'reply', mid: '4' }] })
  await h.scheduler.listenTick()
  assert.equal(h.calls.prompts.length, 0)
  h.scheduler.stop()
})


test('invalid or unreadable saved config never falls back to unrestricted dispatch', async () => {
  for (const denied of [false, true]) {
    const h = await harness({ readDenied: denied ? cfgPath : undefined })
    if (!denied) h.files.set(cfgPath, 'truncated JSON fixture')
    await h.scheduler.tick(); await h.scheduler.listenTick()
    assert.equal(h.calls.prompts.length, 0); assert.equal(h.calls.execs.length, 0)
    h.scheduler.stop()
  }
})

test('corrupt night or listener state cannot refill a model budget', async () => {
  for (const file of [statePath, listenPath]) {
    const h = await harness()
    h.files.set(file, 'corrupt state fixture')
    try { await h.scheduler.tick(); await h.scheduler.listenTick() } catch {}
    assert.equal(h.calls.prompts.length, 0); assert.equal(h.calls.execs.length, 0)
    assert.equal(h.files.get(file), 'corrupt state fixture')
    h.scheduler.stop()
  }
})

test('settings invalidation retains per-window use counts and atomically replaces state', async () => {
  const usedCount = { [`${date}|12:10–13:30`]: 1 }
  const h = await harness({ state: { schema: 2, date, wakes: 1, usedCount, skippedWindows: [], action: 'done', done: true } })
  h.scheduler.invalidate(); await flush()
  assert.deepEqual(h.files.get(statePath).usedCount, usedCount)
  assert.ok(h.calls.renames > 0)
  h.scheduler.stop()
})
