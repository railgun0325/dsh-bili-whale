import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const command = fileURLToPath(new URL('../tools/commands/comment.mjs', import.meta.url))
const baseline = {
  owner: { mid: '123456', name: 'Fixture owner' }, self: { mid: '456789' },
  interaction: { enabled: true, daily: 3, topLevelDaily: 1, replyDaily: 2, minIntervalSec: 1200, maxChars: 160, noMention: true, stopOnRisk: true },
  share: { enabled: false }, notify: { type: 'none' }, listen: { oncePerPerson: false },
}
function fixture(fn) {
  return async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-interaction-cli-'))
    fs.mkdirSync(path.join(home, '.bili-ai'))
    fs.writeFileSync(path.join(home, '.bili-ai', 'credentials.json'), JSON.stringify({ sessdata: 'fixture', bili_jct: 'fixture', buvid3: 'fixture' }))
    const config = path.join(home, 'config.json')
    fs.writeFileSync(config, JSON.stringify(baseline))
    const preload = path.join(home, 'offline.mjs')
    fs.writeFileSync(preload, `
import fs from 'node:fs';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
const home=${JSON.stringify(home)};
const read=fs.readFileSync;
fs.readFileSync=(file,...rest)=>{ if(String(file).endsWith('credentials.json')&&!String(file).startsWith(home+'/')) throw new Error('Real credentials forbidden'); return read(file,...rest); };
const realDate=Date; const now=Number(process.env.WHALE_FIXTURE_NOW || realDate.parse('2026-10-23T12:15:00+08:00'));
globalThis.Date=class extends realDate {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
const trace={requests:[],children:[]};
cp.execFileSync=(file,args)=>{trace.children.push({file,args});if(args[0].endsWith('/quota.mjs')) return 'fixture quota';if(args[0].endsWith('/notify.mjs'))return '';throw new Error('Unexpected subprocess');};
syncBuiltinESMExports();
globalThis.fetch=async(raw,opts={})=>{
const u=new URL(raw); const method=opts.method||'GET'; trace.requests.push({url:u.href,method,body:opts.body||null});
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
if(u.pathname==='/x/web-interface/nav')return json({code:0,data:{isLogin:true,mid:Number(process.env.WHALE_FIXTURE_MID||'456789'),uname:'Fixture',wbi_img:{img_url:'https://fixture.invalid/abcdefghijklmnopqrstuvwxyz012345.png',sub_url:'https://fixture.invalid/012345abcdefghijklmnopqrstuvwxyz.png'}}});
if(u.pathname==='/x/v2/reply/reply')return json({code:0,data:{root:{rpid_str:'456',mid:'654321',member:{uname:'Other'}},replies:[]}});
if(u.pathname==='/x/v2/reply/add'&&method==='POST'){
 if(process.env.WHALE_FIXTURE_DELAY)await new Promise(r=>setTimeout(r,Number(process.env.WHALE_FIXTURE_DELAY)));
 if(process.env.WHALE_FIXTURE_UNKNOWN)throw new Error('fixture network lost after submission');
 return json({code:Number(process.env.WHALE_FIXTURE_CODE||0),message:'fixture response',data:{rpid_str:'987654'}},Number(process.env.WHALE_FIXTURE_HTTP||200));}
throw new Error('Unexpected offline request '+u.pathname);
};
process.on('exit',()=>fs.writeFileSync(process.env.WHALE_FIXTURE_TRACE,JSON.stringify(trace)));
`)
    const run = (options = {}) => new Promise((resolve, reject) => {
      const trace = path.join(home, 'trace-' + crypto.randomUUID() + '.json')
      const args = ['--oid', options.oid ?? '123', '--bvid', options.bvid ?? 'BV1T5nL6rEPb', '--message', options.message ?? '这一段把两种条件的差别解释得很清楚。', options.dry ? '--dry' : '--go', ...(options.flags ?? [])]
      const child = spawn(process.execPath, ['--import', preload, command, ...args], { env: { ...process.env, BILI_WHALE_CONFIG: config, BILI_WHALE_DATA_HOME: home,
        WHALE_FIXTURE_TRACE: trace, ...(options.env ?? {}) }, stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''; let stderr = ''
      child.stdout.on('data', (value) => { stdout += value }); child.stderr.on('data', (value) => { stderr += value })
      child.once('error', reject)
      child.once('close', (status) => resolve({ status, stdout, stderr, trace: JSON.parse(fs.readFileSync(trace, 'utf8')) }))
    })
    try { await fn({ home, run, setConfig(value) { fs.writeFileSync(config, JSON.stringify(value)) } }) }
    finally { fs.rmSync(home, { recursive: true, force: true }) }
  }
}
const posts = (result) => result.trace.requests.filter((item) => item.method === 'POST')
const ledger = (home) => JSON.parse(fs.readFileSync(path.join(home, '.bili-ai', 'interaction.json'), 'utf8'))

test('ordinary CLI without --auto still enforces no-mention and disabled controls', fixture(async ({ run, setConfig }) => {
  let result = await run({ message: '@Fixture owner 来看这段' })
  assert.notEqual(result.status, 0)
  assert.equal(posts(result).length, 0)
  setConfig({ ...baseline, interaction: { ...baseline.interaction, enabled: false } })
  result = await run()
  assert.notEqual(result.status, 0)
  assert.equal(posts(result).length, 0)
}))
test('ordinary CLI verifies sender identity even without --share or --auto', fixture(async ({ run }) => {
  for (const mid of ['999999', baseline.owner.mid]) {
    const result = await run({ env: { WHALE_FIXTURE_MID: mid } })
    assert.notEqual(result.status, 0)
    assert.equal(posts(result).length, 0)
  }
}))
test('ordinary dry is read-only, ordinary go reserves one post without mention mapping', fixture(async ({ home, run }) => {
  const dry = await run({ dry: true })
  assert.equal(dry.status, 0, dry.stderr)
  assert.equal(posts(dry).length, 0)
  assert.equal(fs.existsSync(path.join(home, '.bili-ai', 'interaction.json')), false)
  const go = await run()
  assert.equal(go.status, 0, go.stderr)
  assert.equal(posts(go).length, 1)
  assert.equal(new URLSearchParams(posts(go)[0].body).has('at_name_to_mid'), false)
  assert.equal(ledger(home).attempts[0].status, 'success')
}))
test('ordinary go rejects expensive hours even with a safe message', fixture(async ({ run, setConfig }) => {
  setConfig({ ...baseline, night: { offPeakOnly: true, windows: [{ start: '12:00', end: '13:45' }] } })
  const result = await run({ env: { WHALE_FIXTURE_NOW: String(Date.parse('2026-10-23T10:00:00+08:00')) } })
  assert.notEqual(result.status, 0)
  assert.equal(posts(result).length, 0)
}))
test('parallel CLI sends compete for one lock, at most one POST', fixture(async ({ run, home }) => {
  const results = await Promise.all([run({ env: { WHALE_FIXTURE_DELAY: '400' } }), run({ oid: '124', bvid: 'BV1d8pU6xEZX', env: { WHALE_FIXTURE_DELAY: '400' } })])
  assert.equal(results.reduce((total, result) => total + posts(result).length, 0), 1)
  assert.equal(ledger(home).attempts.length, 1)
}))
test('ordinary risk response persists a halt across later CLI invocations', fixture(async ({ run, home }) => {
  const result = await run({ env: { WHALE_FIXTURE_CODE: '12074' } })
  assert.notEqual(result.status, 0)
  assert.equal(posts(result).length, 1)
  assert.ok(ledger(home).halted)
  const later = await run({ oid: '124', bvid: 'BV1d8pU6xEZX', env: { WHALE_FIXTURE_NOW: String(Date.parse('2026-10-24T12:15:00+08:00')) } })
  assert.notEqual(later.status, 0)
  assert.equal(posts(later).length, 0)
}))
test('ordinary unknown response persists exactly one attempt and cannot retry', fixture(async ({ run, home }) => {
  const result = await run({ env: { WHALE_FIXTURE_UNKNOWN: 'true' } })
  assert.notEqual(result.status, 0)
  assert.equal(posts(result).length, 1)
  assert.equal(ledger(home).attempts[0].status, 'unknown')
  const later = await run()
  assert.equal(posts(later).length, 0)
  assert.equal(ledger(home).attempts.length, 1)
}))
test('top-level parent author resolves data.root for once-per-person', fixture(async ({ run }) => {
  const result = await run({ flags: ['--root', '456', '--parent', '456', '--once-per-person'] })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(posts(result).length, 1)
}))
