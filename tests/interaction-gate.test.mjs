import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { inspectInteraction, executeInteraction } from '../tools/lib/interaction-gate.mjs'

const config = { interaction: { enabled: true, daily: 3, topLevelDaily: 1, replyDaily: 2, minIntervalSec: 1200, maxChars: 160, noMention: true, stopOnRisk: true } }
const top = { type: '1', oid: '123', bvid: 'BV1T5nL6rEPb', message: '字幕和实际演示对得上，这段对比很清楚。' }
const reply = { ...top, root: '456', parent: '789', message: '我理解这段是在比较两种不同的条件。' }
const time = new Date('2026-10-23T11:00:00+08:00')
const success = async () => ({ http: 200, out: { code: 0, data: { rpid_str: '987654' } } })
function fixture(fn) {
  return async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-interaction-unit-'))
    try { await fn(home) } finally { fs.rmSync(home, { recursive: true, force: true }) }
  }
}
const ledgerFile = (home) => path.join(home, '.bili-ai', 'interaction.json')
const snapshot = (home) => JSON.parse(fs.readFileSync(ledgerFile(home), 'utf8'))
const run = (home, request = top, now = time, send = success, cfg = config) => executeInteraction({ dataDir: home, config: cfg, request, now: () => now, send })
const later = (minutes) => new Date(time.getTime() + minutes * 60_000)

test('ordinary interaction requires explicit enabled config', fixture(async (home) => {
  await assert.rejects(run(home, top, time, success, {}), /关闭|enabled/)
  assert.equal(fs.existsSync(ledgerFile(home)), false)
}))
for (const [name, message] of [
  ['mention', '@某人 来看看'], ['full width mention', '＠某人'], ['url', '看看 https://www.bilibili.com/video/BV1T5nL6rEPb'],
  ['bare url', '链接是 b23.tv/test'], ['obfuscated url', 'h\u200bttps://example.com'],
  ['cookie', 'SESSDATA=privatevalue'], ['api key', 'sk-abcdefghijklmnop'], ['private path', '/Users/fixture/.dsh/config.json'],
  ['access token', 'access_token=privatevalue'], ['token assignment', 'token: privatevalue'], ['bare IP', '192.168.1.1:8420'],
  ['long text', '字'.repeat(161)],
]) {
  test(`message rejects ${name} without reserving or sending`, fixture(async (home) => {
    let posts = 0
    await assert.rejects(run(home, { ...top, message }, time, async () => { posts++; return success() }))
    assert.equal(posts, 0)
    assert.equal(fs.existsSync(ledgerFile(home)), false)
  }))
}
test('only type 1 videos and complete reply coordinates are accepted', fixture(async (home) => {
  for (const request of [{ ...top, type: '11' }, { ...top, bvid: '' }, { ...reply, root: '' }, { ...top, oid: 'not-an-id' }]) {
    await assert.rejects(run(home, request))
  }
}))
test('dry inspection validates without creating a ledger or lock', fixture(async (home) => {
  const result = inspectInteraction({ dataDir: home, config, request: top, now: time })
  assert.equal(result.kind, 'top')
  assert.equal(fs.existsSync(path.join(home, '.bili-ai')), false)
}))
test('reserve is durable before POST and success finalizes it', fixture(async (home) => {
  await run(home, top, time, async () => {
    assert.equal(snapshot(home).attempts[0].status, 'reserved')
    assert.equal(snapshot(home).attempts.length, 1)
    return success()
  })
  const state = snapshot(home)
  assert.equal(state.attempts[0].status, 'success')
  assert.equal(state.attempts[0].rpid, '987654')
  assert.equal(state.halted, null)
  assert.equal(fs.statSync(ledgerFile(home)).mode & 0o777, 0o600)
  assert.equal(JSON.stringify(state).includes(top.message), false)
}))
test('minimum interval and seven-day same-video limits include attempts', fixture(async (home) => {
  await run(home)
  await assert.rejects(run(home, { ...reply }, later(1)), /间隔/)
  await assert.rejects(run(home, { ...top, message: '换一种说法也不能重复发。' }, later(21)), /7|重复|顶层/)
}))
test('daily total, top-level and reply caps cannot overspend', fixture(async (home) => {
  await run(home)
  await run(home, reply, later(21))
  await run(home, { ...reply, parent: '790' }, later(42))
  await assert.rejects(run(home, { ...reply, parent: '791' }, later(63)), /上限|额度/)
  assert.equal(snapshot(home).attempts.length, 3)
}))
test('parent is never automatically replied to twice', fixture(async (home) => {
  await run(home, reply)
  await assert.rejects(run(home, { ...reply, message: '换一个说法也还是重复回复。' }, new Date('2026-11-23T11:00:00+08:00')), /parent|重复/)
}))
test('a corrupt ledger refuses and stays unchanged', fixture(async (home) => {
  fs.mkdirSync(path.dirname(ledgerFile(home)), { recursive: true })
  fs.writeFileSync(ledgerFile(home), '{broken')
  await assert.rejects(run(home), /账本/)
  assert.equal(fs.readFileSync(ledgerFile(home), 'utf8'), '{broken')
}))
test('malformed JSON structure is also corrupt, never a fresh quota', fixture(async (home) => {
  fs.mkdirSync(path.dirname(ledgerFile(home)), { recursive: true })
  for (const invalid of [{}, { version: 1, attempts: 'bad', halted: null }, { version: 1, attempts: [{ at: 'bad' }], halted: null }]) {
    fs.writeFileSync(ledgerFile(home), JSON.stringify(invalid))
    await assert.rejects(run(home), /账本/)
  }
}))
test('persistent lock prevents concurrent posts and does not steal stale locks', fixture(async (home) => {
  let entered
  const reached = new Promise((resolve) => { entered = resolve })
  let release
  const wait = new Promise((resolve) => { release = resolve })
  let posts = 0
  const first = run(home, top, time, async () => { posts++; entered(); await wait; return success() })
  await reached
  await assert.rejects(run(home, reply), /锁|处理中/)
  release()
  await first
  assert.equal(posts, 1)
  const lock = path.join(home, '.bili-ai', 'interaction.lock')
  fs.writeFileSync(lock, 'stale-process')
  await assert.rejects(run(home, reply, later(21)), /锁|处理中/)
  assert.equal(fs.readFileSync(lock, 'utf8'), 'stale-process')
}))
test('permission/rate-risk persists a halt and consumes the attempt', fixture(async (home) => {
  await run(home, top, time, async () => ({ http: 200, out: { code: 12074, message: '努力升级到lv2再来评论吧' } }))
  assert.equal(snapshot(home).attempts[0].status, 'failed')
  assert.match(snapshot(home).halted.reason, /12074|权限|风控/)
  await assert.rejects(run(home, reply, later(21)), /暂停|halt|停止/)
}))
test('unknown POST result is retained, halts, and cannot be retried', fixture(async (home) => {
  await assert.rejects(run(home, top, time, async () => { throw new Error('fixture network lost') }), /未确认|未知|network/)
  assert.equal(snapshot(home).attempts[0].status, 'unknown')
  assert.ok(snapshot(home).halted)
  await assert.rejects(run(home, top, later(21)), /暂停|halt|停止/)
}))
test('other failed attempt is counted and the same video is not retried', fixture(async (home) => {
  await run(home, top, time, async () => ({ http: 200, out: { code: -400, message: 'fixture invalid request' } }))
  assert.equal(snapshot(home).attempts[0].status, 'failed')
  await assert.rejects(run(home, top, later(21)), /7|重复|顶层/)
}))
test('Beijing day boundaries are used independently of host timezone', fixture(async (home) => {
  await run(home, top, new Date('2026-10-23T23:30:00+08:00'))
  await run(home, { ...top, oid: '124', bvid: 'BV1d8pU6xEZX' }, new Date('2026-10-24T00:30:00+08:00'))
  assert.equal(snapshot(home).attempts.length, 2)
}))
