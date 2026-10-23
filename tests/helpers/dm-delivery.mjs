import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
const RealDate = Date
let now = Date.now()
globalThis.Date = class extends RealDate { static now() { return now } }
globalThis.setInterval = globalThis.setTimeout = () => ({})
globalThis.clearInterval = globalThis.clearTimeout = () => {}
const { startScheduler } = await import('../../lib/scheduler.js')
const { localHost, modelSelection } = await import('./local-host.mjs')   // 本机补丁的宿主契约
const bounded=process.env.TEST_BOUNDED_DM==='1'
const cooldown=process.env.TEST_DM_COOLDOWN==='1'
process.env.TEST_DM_FILE = path.join(process.env.HOME, 'dm-input.json')
const ts = Math.floor(now / 1000)
const message = (id, text) => fs.writeFileSync(process.env.TEST_DM_FILE, JSON.stringify({ timestamp: ts, msg_key: id, sender_uid: 222, content: JSON.stringify({ content: text }) }))
message('1', 'first')
fs.writeFileSync(process.env.BILI_WHALE_CONFIG, JSON.stringify({ self:{mid:'111'}, owner: { mid: '222' }, listen: { dm: true, comment: false, live: false }, session: { modelSelection }, ...(bounded?{privateReply:{enabled:true,daily:2,pollIntervalSec:120}}:{}) }))
const stateFile = path.join(process.env.HOME, '.bili-ai/dm-await-state.json')
let fail = true
const attempts = [], delivered = []
const sched = startScheduler(localHost({ create: async () => {}, prompt: async p => {
  attempts.push(p.requestId)
  if (fail) throw Error('host temporarily unavailable')
  delivered.push(p)
} }), { dshHome: process.env.DSH_HOME, cwd: process.env.HOME, biliMjs: fileURLToPath(new URL('../../tools/bili.mjs', import.meta.url)) })
try {
  if(cooldown) {
    fs.writeFileSync(path.join(process.env.HOME,'.bili-ai/dm-replies.json'),JSON.stringify({version:1,halted:null,attempts:[{self:'111',owner:'222',key:'previous',at:new Date(now).toISOString(),status:'success'}]}))
    await sched.dmTick()
    assert.equal(attempts.length,0)
    assert.equal(fs.existsSync(stateFile),false)
    now+=181000;fail=false
    await sched.dmTick()
    assert.equal(delivered.length,1)
    assert.match(delivered[0].content[0].text,/first/)
  } else {
  await sched.dmTick()
  const pending = JSON.parse(fs.readFileSync(stateFile))
  assert.ok(pending.pending?.receipt)
  assert.equal(pending.lastSeen, undefined)
  // The failed first message survives even if the latest inbox item changes.
  message('2', 'second'); fail = false; now += bounded?300001:6000
  await sched.dmTick()
  assert.equal(attempts[0], attempts[1])
  assert.match(delivered[0].content[0].text, /first/)
  assert.equal(JSON.parse(fs.readFileSync(stateFile)).pending, undefined)
  if(bounded) {
    assert.match(delivered[0].content[0].text,/--reply-to/)
    assert.equal(JSON.parse(fs.readFileSync(stateFile)).delivered[0].selfMid,'111')
    now+=300001;await sched.dmTick()
    assert.equal(delivered.length,1)
    assert.equal(JSON.parse(fs.readFileSync(path.join(process.env.DSH_HOME,'whale-dm-listen.json'))).modelWakes,2)
    assert.match(sched.status().dmState,/预算已用完/)
    process.exitCode=0
  } else {
  now += 6000; await sched.dmTick()
  assert.equal(delivered.length, 2)
  assert.match(delivered[1].content[0].text, /second/)
  now += 6000; await sched.dmTick(); assert.equal(delivered.length, 2)
  }
  }
} finally { sched.stop() }
