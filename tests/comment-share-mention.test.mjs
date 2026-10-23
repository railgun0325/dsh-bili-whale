import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const command = fileURLToPath(new URL('../tools/commands/comment.mjs', import.meta.url))
const ownerName = '测试主人'
const imageKey = 'abcdefghijklmnopqrstuvwxyz012345'
const subKey = '012345abcdefghijklmnopqrstuvwxyz'

// Exercise the real CLI, but keep credentials/config in a temporary home and
// replace every fetch/subprocess. This test never reads real login data or posts.
function run({ ownerMid = '123456', selfMid = '456789', senderMid = 456789, navCode = 0, isLogin = true, enabled = true, score = '15', minScore = 13, share = true, dry = false, ledgerWriteDenied = false, probeWriteDenied = false, message = '值得看的工程实测' } = {}) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'bili-comment-mention-'))
  try {
    mkdirSync(path.join(home, '.bili-ai'))
    writeFileSync(path.join(home, '.bili-ai', 'credentials.json'), JSON.stringify({ sessdata: 'fixture', bili_jct: 'fixture', buvid3: 'fixture' }))
    const config = path.join(home, 'config.json')
    writeFileSync(config, JSON.stringify({ owner: { name: ownerName, mid: ownerMid }, self: { mid: selfMid }, share: { enabled, minScore }, interaction: { enabled: true }, notify: { type: 'none' } }))
    const preload = path.join(home, 'offline.mjs')
    writeFileSync(preload, `
import fs from 'node:fs';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const trace = { requests: [], children: [], probes: [] };
const open = fs.openSync;
const unlink = fs.unlinkSync;
const write = fs.writeFileSync;
let probeFd;
fs.openSync = (file, flags, mode) => {
  if (String(file).includes('/.bili-ai/.quota-write-probe-')) {
    trace.probes.push({ action: 'open', flags, mode });
    if (${JSON.stringify(ledgerWriteDenied)}) throw Object.assign(new Error('Fixture write denied'), { code: 'EACCES' });
    const fd = open(file, flags, mode);
    probeFd = fd;
    trace.probes.push({ action: 'created', mode: fs.fstatSync(fd).mode & 0o777 });
    return fd;
  }
  return open(file, flags, mode);
};
fs.unlinkSync = (file) => {
  const probe = String(file).includes('/.bili-ai/.quota-write-probe-');
  const bytes = probe ? fs.statSync(file).size : null;
  const result = unlink(file);
  if (probe) trace.probes.push({ action: 'removed', bytes });
  return result;
};
fs.writeFileSync = (file, data, options) => {
  if (file === probeFd && ${JSON.stringify(probeWriteDenied)}) throw Object.assign(new Error('Fixture probe write denied'), { code: 'EACCES' });
  return write(file, data, options);
};
cp.execFileSync = (file, args) => {
  trace.children.push({ file, args });
  if (args[0].endsWith('/quota.mjs') && ['check', 'record'].includes(args[1])) return 'fixture quota';
  if (args[0].endsWith('/notify.mjs')) return '';
  throw new Error('Unexpected child process');
};
// 上游 capture.mjs（文件捕获层）走 spawnSync：同一套替身；node 运行时探测（-e）照常放行
const spawn = cp.spawnSync;
cp.spawnSync = (file, args = [], options = {}) => {
  if (args[0] === '-e') return spawn(file, args, options);
  trace.children.push({ file, args });
  let out = null;
  if (String(args[0]).endsWith('/quota.mjs') && ['check', 'record'].includes(args[1])) out = 'fixture quota';
  else if (String(args[0]).endsWith('/notify.mjs')) out = '';
  if (out === null) return { status: null, error: new Error('Unexpected child process') };
  if (Array.isArray(options.stdio) && typeof options.stdio[1] === 'number') fs.writeSync(options.stdio[1], out);
  return { status: 0, stdout: Buffer.from(out), stderr: Buffer.alloc(0) };
};
syncBuiltinESMExports();
globalThis.fetch = async (raw, opts = {}) => {
  const u = new URL(raw); const method = opts.method ?? 'GET';
  trace.requests.push({ url: u.href, method, body: opts.body ?? null });
  const json = (data) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  if (u.hostname === 'api.bilibili.com' && u.pathname === '/x/web-interface/nav' && method === 'GET') {
    return json({ code: ${JSON.stringify(navCode)}, data: { isLogin: ${JSON.stringify(isLogin)}, uname: 'Fixture sender', mid: ${JSON.stringify(senderMid)}, wbi_img: { img_url: 'https://fixture.invalid/${imageKey}.png', sub_url: 'https://fixture.invalid/${subKey}.png' } } });
  }
  if (u.hostname === 'api.bilibili.com' && u.pathname === '/x/v2/reply/add' && method === 'POST') {
    trace.probesAtPost = structuredClone(trace.probes);
    return json({ code: 0, data: { rpid_str: '987654' } });
  }
  throw new Error('Unexpected offline request');
};
process.on('exit', () => fs.writeFileSync(${JSON.stringify(path.join(home, 'trace.json'))}, JSON.stringify(trace)));
`)
    const args = ['--oid', '123', '--bvid', 'BV1T5nL6rEPb', '--message', message, dry ? '--dry' : '--go']
    if (share) args.push('--share', '--auto', '--reason', '信息密度高而且有完整实验对照', '--score', score, '--rank', '1')
    const result = spawnSync(process.execPath, ['--import', preload, command, ...args], {
      env: { ...process.env, HOME: home, USERPROFILE: home, BILI_WHALE_CONFIG: config },
      encoding: 'utf8', timeout: 5000,
    })
    assert.ifError(result.error)
    return { ...result, trace: JSON.parse(readFileSync(path.join(home, 'trace.json'), 'utf8')), remainingDataFiles: readdirSync(path.join(home, '.bili-ai')).sort() }
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

test('share go refuses an unwritable ledger directory before POST or record', () => {
  const result = run({ ledgerWriteDenied: true })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /账本.*可写/)
  assert.equal(result.trace.requests.filter((r) => r.method === 'POST').length, 0)
  assert.equal(result.trace.children.filter((r) => r.args[1] === 'record').length, 0)
  assert.deepEqual(result.trace.probes, [{ action: 'open', flags: 'wx', mode: 0o600 }])
  assert.deepEqual(result.remainingDataFiles, ['credentials.json'])
})

test('share go probes with exclusive 0600 file and cleans up before sending', () => {
  const result = run()
  postOf(result)
  assert.deepEqual(result.trace.probesAtPost, [
    { action: 'open', flags: 'wx', mode: 0o600 },
    { action: 'created', mode: 0o600 },
    { action: 'removed', bytes: Buffer.byteLength('quota-write-probe\n') },
  ])
  assert.equal(result.trace.children.filter((r) => r.args[1] === 'record').length, 1)
  assert.deepEqual(result.remainingDataFiles, ['credentials.json'])
})

test('share go cleans up a created probe when its write fails and refuses to send', () => {
  const result = run({ probeWriteDenied: true })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /账本.*可写/)
  assert.equal(result.trace.requests.filter((r) => r.method === 'POST').length, 0)
  assert.equal(result.trace.children.filter((r) => r.args[1] === 'record').length, 0)
  assert.deepEqual(result.trace.probes.at(-1), { action: 'removed', bytes: 0 })
  assert.deepEqual(result.remainingDataFiles, ['credentials.json'])
})

test('share dry stays read only even when ledger directory is unwritable', () => {
  const result = run({ dry: true, ledgerWriteDenied: true })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.trace.requests.filter((r) => r.method === 'POST').length, 0)
  // 上游 2026-10-22：--dry 在额度闸之后返回 —— 只允许只读的 quota check，不记账、不报备
  assert.deepEqual(result.trace.children.map((c) => c.args[1]), ['check'])
  assert.deepEqual(result.trace.probes, [])
  assert.deepEqual(result.remainingDataFiles, ['credentials.json'])
})

function postOf(result) {
  assert.equal(result.status, 0, result.stderr)
  const posts = result.trace.requests.filter((r) => r.method === 'POST')
  assert.equal(posts.length, 1)
  return { url: new URL(posts[0].url), body: new URLSearchParams(posts[0].body) }
}

test('share sends only configured owner mapping, included before WBI signing', () => {
  const result = run({ message: `@${ownerName} 内容提到 @其他人` })
  const { url, body } = postOf(result)
  assert.deepEqual(JSON.parse(body.get('at_name_to_mid')), { [ownerName]: 123456 })
  assert.equal(result.trace.requests.length, 3, 'only two nav reads and one comment POST; no user lookup')
  const table = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52]
  const mixin = table.map((i) => (imageKey + subKey)[i]).join('').slice(0, 32)
  const params = { ...Object.fromEntries(body), wts: url.searchParams.get('wts') }
  const query = Object.keys(params).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]).replace(/[!'()*]/g, ''))}`).join('&')
  assert.equal(url.searchParams.get('w_rid'), crypto.createHash('md5').update(query + mixin).digest('hex'))
})

test('share preserves auto-prefix and accepts a numeric safe UID', () => {
  const { body } = postOf(run({ ownerMid: 123456 }))
  assert.equal(body.get('message'), `@${ownerName} 值得看的工程实测`)
  assert.deepEqual(JSON.parse(body.get('at_name_to_mid')), { [ownerName]: 123456 })
})

test('largest safe integer UID is encoded without rounding', () => {
  const { body } = postOf(run({ ownerMid: String(Number.MAX_SAFE_INTEGER) }))
  assert.equal(JSON.parse(body.get('at_name_to_mid'))[ownerName], Number.MAX_SAFE_INTEGER)
})

for (const ownerMid of ['', null, 'NaN', 'Infinity', '0', '-1', '1.5', '1e3', '9007199254740993', Number.MAX_SAFE_INTEGER + 1, [], [123], true]) {
  test(`invalid owner UID ${JSON.stringify(ownerMid)} refuses before any request`, () => {
    const result = run({ ownerMid })
    assert.equal(result.status, 2)
    assert.match(result.stderr, /owner\.mid/)
    assert.deepEqual(result.trace.requests, [])
    assert.deepEqual(result.trace.children, [])
  })
}

test('disabled share still refuses before any request', () => {
  const result = run({ enabled: false })
  assert.equal(result.status, 3)
  assert.match(result.stderr, /share\.enabled/)
  assert.deepEqual(result.trace.requests, [])
})

for (const score of ['-1', '21', '1e100']) {
  test(`out-of-range score ${score} refuses before any request`, () => {
    const result = run({ score, minScore: -10 })
    assert.equal(result.status, 2)
    assert.match(result.stderr, /0.?20/)
    assert.deepEqual(result.trace.requests, [])
  })
}

for (const score of ['0', '20']) {
  test(`score boundary ${score} remains accepted when threshold permits`, () => postOf(run({ score, minScore: 0 })))
}

test('ordinary comment does not require owner UID or add a mention mapping', () => {
  const { body } = postOf(run({ share: false, ownerMid: '', enabled: false, message: '这段解释很清楚，感谢分享。' }))
  assert.equal(body.has('at_name_to_mid'), false)
  assert.equal(body.get('message'), '这段解释很清楚，感谢分享。')
})

for (const [label, options] of [
  ['guest nav with code zero', { isLogin: false }],
  ['unconfirmed login state', { isLogin: null }],
  ['sender differs from configured self', { senderMid: 999999 }],
  ['sender equals owner', { senderMid: 123456, selfMid: '123456' }],
  ['missing configured self', { selfMid: '' }],
  ['precision-unsafe configured self', { selfMid: '9007199254740993' }],
  ['failed nav response', { navCode: -101 }],
  ['guest ordinary comment', { share: false, isLogin: false }],
]) {
  test(`identity gate: ${label} refuses without posting or recording`, () => {
    const result = run(options)
    assert.equal(result.status, 4)
    assert.equal(result.trace.requests.length, 1)
    assert.equal(result.trace.requests[0].method, 'GET')
    assert.equal(new URL(result.trace.requests[0].url).pathname, '/x/web-interface/nav')
    assert.deepEqual(result.trace.children, [])
    assert.doesNotMatch(result.stdout + result.stderr, /Fixture sender|SESSDATA=|账号:/)
  })
}
