import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { dataHome } from '../tools/lib/data-home.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))

test('data home preserves defaults, validates overrides, and never mutates OS home', () => {
  const env = { HOME: '/fixture/user', USERPROFILE: '/fixture/profile', BILI_WHALE_DATA_HOME: '/fixture/workspace/data' }
  const before = { ...env }
  assert.equal(dataHome(env), '/fixture/workspace/data')
  assert.deepEqual(env, before)
  assert.equal(dataHome({ HOME: '/fixture/user', USERPROFILE: '/fixture/profile' }), '/fixture/profile')
  assert.equal(dataHome({ HOME: '/fixture/user' }), '/fixture/user')
  for (const value of ['', '  ', 'relative/data']) assert.throws(() => dataHome({ ...env, BILI_WHALE_DATA_HOME: value }), /absolute non-empty/)
})

function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'whale-data-home-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const data = path.join(dir, 'workspace', 'data')
  mkdirSync(path.join(data, '.bili-ai'), { recursive: true })
  mkdirSync(path.join(data, '.dsh'), { recursive: true })
  writeFileSync(path.join(data, '.bili-ai', 'credentials.json'), JSON.stringify({ sessdata: 'fixture', bili_jct: 'fixture', buvid3: 'fixture' }))
  const config = path.join(dir, 'host-config.json')
  writeFileSync(config, JSON.stringify({ self: { mid: '123' }, owner: { mid: '456' }, share: { enabled: false }, quota: { shareDaily: 0 }, notify: { type: 'file' }, night: { enabled: false } }))
  const preload = path.join(dir, 'offline.mjs')
  writeFileSync(preload, `
import fs from 'node:fs';
import cp from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
// ESM 加载器传的是 file:// URL；先转成路径再判断
const toPath = p => p instanceof URL || String(p).startsWith('file:') ? fileURLToPath(p) : String(p);
const allowed = ${JSON.stringify(dir)};
const code = ${JSON.stringify(root.replace(/[\\/]$/, ''))};
const under = p => typeof p === 'number' || path.resolve(toPath(p)).startsWith(allowed + path.sep);
for (const name of ['writeFileSync', 'appendFileSync', 'mkdirSync', 'unlinkSync']) {
  const original = fs[name];
  fs[name] = (p, ...args) => { if (!under(p)) throw new Error('Offline fixture forbids writes outside fixture'); return original(p, ...args); };
}
const read = fs.readFileSync;
fs.readFileSync = (p, ...args) => {
  if (!under(p) && !path.resolve(toPath(p)).startsWith(code + path.sep) && /(?:\\.bili-ai|\\.dsh)\\//.test(toPath(p))) throw new Error('Offline fixture forbids reading real user data');
  return read(p, ...args);
};
const spawn = cp.spawnSync;
cp.spawnSync = (cmd, args, options) => cmd === process.execPath ? spawn(cmd, args, options) : { status: 0, stdout: 'ffmpeg version fixture', stderr: '' };
syncBuiltinESMExports();
const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
globalThis.fetch = async raw => {
  const u = new URL(raw);
  if (u.pathname === '/x/web-interface/nav') return json({ code: 0, data: { isLogin: true, uname: 'Fixture', mid: 123, wbi_img: { img_url: 'https://fixture.invalid/abcdefghijklmnopqrstuvwxyz012345.png', sub_url: 'https://fixture.invalid/012345abcdefghijklmnopqrstuvwxyz.png' } } });
  if (u.pathname === '/x/web-interface/view' || u.pathname === '/x/web-interface/wbi/view') return json({ code: 0, data: { cid: 1, aid: 2, duration: 5, title: 'Fixture video', owner: { name: 'Fixture' }, pubdate: 1, stat: {}, pic: 'https://fixture.invalid/cover.jpg' } });
  if (u.pathname === '/cover.jpg') return new Response('fixture image');
  if (u.pathname === '/x/player/wbi/v2') return json({ data: { subtitle: { subtitles: [{ lan: 'ai-zh', subtitle_url: 'https://fixture.invalid/subtitle.json' }] } } });
  if (u.pathname === '/subtitle.json') return json({ body: [{ from: 0, to: 5, content: 'Fixture full subtitle' }] });
  if (u.hostname === 'comment.bilibili.com') return new Response('<i></i>');
  if (u.pathname === '/x/v2/reply') return json({ code: 0, data: { replies: [] } });
  if (u.pathname === '/x/v2/reply/add') return json({ code: 0, data: { rpid_str: '987654' } });
  throw new Error('Offline fixture denies all other network requests');
};
`)
  mkdirSync(path.join(dir, 'tmp'))
  const env = { ...process.env, TMPDIR: path.join(dir, 'tmp'), BILI_WHALE_DATA_HOME: data, BILI_WHALE_CONFIG: config, NODE_OPTIONS: `--import=${preload}` }
  const run = (...args) => {
    const r = spawnSync(process.execPath, [path.join(root, 'tools/bili.mjs'), ...args], { cwd: dir, env, encoding: 'utf8', timeout: 10_000 })
    assert.ifError(r.error)
    assert.equal(r.status, 0, r.stderr || r.stdout)
    return r.stdout
  }
  return { dir, data, config, env, run }
}

test('real CLI children inherit scoped data for ledger, feedback, diary, notify, and paused night', t => {
  const f = fixture(t)
  f.run('quota', 'record', '--type', 'fixture', '--target', 'offline-only')
  f.run('quota', 'react', '--note', 'offline test only')
  f.run('diary', 'log', 'fixture', '--note', 'offline test only')
  f.run('notify', 'offline fixture notification')
  assert.match(f.run('night', 'plan'), /paused/)
  assert.equal(JSON.parse(readFileSync(path.join(f.data, '.bili-ai/quota.json'))).log.length, 1)
  assert.equal(JSON.parse(readFileSync(path.join(f.data, '.bili-ai/feedback.json'))).events.length, 1)
  assert.match(readFileSync(path.join(f.data, '.dsh/whale-log.jsonl'), 'utf8'), /offline test only/)
  assert.match(readFileSync(path.join(f.data, '.dsh/whale-notify.log'), 'utf8'), /offline fixture notification/)
  assert.equal(existsSync(path.join(f.data, '.dsh/whale-night.json')), false)
  assert.equal(process.env.HOME, f.env.HOME)
  assert.equal(process.env.USERPROFILE, f.env.USERPROFILE)
})

test('real debrief stores cover and subtitle under scoped shots with no frames/network', t => {
  const f = fixture(t)
  f.run('debrief', 'BV1T5nL6rEPb', '--no-frames')
  assert.equal(readFileSync(path.join(f.data, '.dsh/shots/covers/BV1T5nL6rEPb.jpg'), 'utf8'), 'fixture image')
  assert.match(readFileSync(path.join(f.data, '.dsh/shots/subs/BV1T5nL6rEPb-debrief.txt'), 'utf8'), /Fixture full subtitle/)
})

test('deps probes scoped data while credentials and all network are fixtures', t => {
  const f = fixture(t)
  const result = JSON.parse(f.run('deps', '--json'))
  const data = result.items.find(item => item.name === '数据目录可写')
  assert.equal(data.ok, true)
  assert.equal(data.detail, path.join(f.data, '.bili-ai'))
  assert.equal(existsSync(path.join(f.data, '.bili-ai/.write-probe')), false)
})

test('comment identity, writable ledger probe, quota child, and record all use scoped data', t => {
  const f = fixture(t)
  writeFileSync(f.config, JSON.stringify({ self: { mid: '123' }, owner: { mid: '456', name: 'Fixture owner' }, share: { enabled: true, minScore: 15 }, quota: { shareDaily: 1 }, notify: { type: 'none' } }))
  f.run('comment', '--oid', '2', '--bvid', 'BV1T5nL6rEPb', '--message', 'Offline fixture only', '--share', '--auto', '--reason', 'Offline fixture evidence only', '--score', '17', '--rank', '1', '--go')
  const ledger = JSON.parse(readFileSync(path.join(f.data, '.bili-ai/quota.json')))
  assert.equal(ledger.log.length, 1)
  assert.equal(ledger.log[0].share, true)
  assert.equal(readdirSync(path.join(f.data, '.bili-ai')).some(name => name.startsWith('.quota-write-probe-')), false)
})

test('every command credential/state home uses the shared resolver; config/runtime keep host locations', () => {
  for (const subdir of ['commands', 'verify', 'diagnostics']) {
    for (const name of readdirSync(path.join(root, 'tools', subdir))) {
      if (!name.endsWith('.mjs')) continue
      const source = readFileSync(path.join(root, 'tools', subdir, name), 'utf8')
      assert.doesNotMatch(source, /process\.env\.(?:HOME|USERPROFILE)/, `${subdir}/${name}`)
    }
  }
  const config = readFileSync(path.join(root, 'tools/lib/config.mjs'), 'utf8')
  assert.match(config, /BILI_WHALE_CONFIG/)
  assert.doesNotMatch(config, /dataHome|BILI_WHALE_DATA_HOME/)
  assert.doesNotMatch(readFileSync(path.join(root, 'tools/lib/ffmpeg.mjs'), 'utf8'), /dataHome|BILI_WHALE_DATA_HOME/)
})
