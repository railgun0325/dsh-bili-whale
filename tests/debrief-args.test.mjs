import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const command = fileURLToPath(new URL('../tools/commands/debrief.mjs', import.meta.url))
const BV = 'BV1T5nL6rEPb'

// Run the actual command with isolated credentials/files, an offline fetch fixture,
// and a subprocess stub. No account, network, video download, or ffmpeg is used.
function run(args) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'bili-debrief-args-'))
  try {
    mkdirSync(path.join(home, '.bili-ai'))
    writeFileSync(path.join(home, '.bili-ai', 'credentials.json'), JSON.stringify({ sessdata: 'fixture', bili_jct: 'fixture', buvid3: 'fixture' }))
    const config = path.join(home, 'config.json')
    writeFileSync(config, '{}')
    const preload = path.join(home, 'offline.mjs')
    writeFileSync(preload, `
import fs from 'node:fs';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const trace = { requests: [], children: [] };
cp.execFileSync = (file, args) => { trace.children.push({ file, args }); return 'SHEET: /fixture/missing.jpg\\n'; };
// 上游 capture.mjs（文件捕获层）走 spawnSync：同一套替身；node 运行时探测（-e）照常放行
const spawn = cp.spawnSync;
cp.spawnSync = (file, args = [], options = {}) => {
  if (args[0] === '-e') return spawn(file, args, options);
  trace.children.push({ file, args });
  const out = 'SHEET: /fixture/missing.jpg\\n';
  if (Array.isArray(options.stdio) && typeof options.stdio[1] === 'number') fs.writeSync(options.stdio[1], out);
  return { status: 0, stdout: Buffer.from(out), stderr: Buffer.alloc(0) };
};
syncBuiltinESMExports();
globalThis.fetch = async (raw) => {
  const u = new URL(raw); trace.requests.push(u.href);
  const json = (data) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  if (u.pathname === '/x/web-interface/nav') return json({ data: { wbi_img: { img_url: 'https://fixture.invalid/abcdefghijklmnopqrstuvwxyz012345.png', sub_url: 'https://fixture.invalid/012345abcdefghijklmnopqrstuvwxyz.png' } } });
  if (u.pathname === '/x/web-interface/view' || u.pathname === '/x/web-interface/wbi/view') {
    if (u.searchParams.get('bvid') !== '${BV}') throw new Error('Wrong positional BV: ' + u.searchParams.get('bvid'));
    return json({ code: 0, data: { cid: 1, aid: 2, duration: 60, title: 'Fixture', owner: { name: 'Fixture' }, pubdate: 0, stat: {}, pic: 'https://fixture.invalid/cover.jpg' } });
  }
  if (u.hostname === 'fixture.invalid' && u.pathname === '/cover.jpg') return new Response('fixture-cover');
  if (u.pathname === '/x/player/wbi/v2') return json({ data: { subtitle: { subtitles: [] } } });
  if (u.hostname === 'comment.bilibili.com' && u.pathname === '/1.xml') return new Response('<i></i>');
  if (u.pathname === '/x/v2/reply') return json({ code: 0, data: { replies: [] } });
  throw new Error('Unexpected offline request: ' + u.href);
};
process.on('exit', () => fs.writeFileSync(${JSON.stringify(path.join(home, 'trace.json'))}, JSON.stringify(trace)));
`)
    const result = spawnSync(process.execPath, ['--import', preload, command, ...args], {
      env: { ...process.env, HOME: home, USERPROFILE: home, BILI_WHALE_CONFIG: config },
      encoding: 'utf8', timeout: 5000,
    })
    assert.equal(result.status, 0, result.stderr || result.error?.message)
    return { output: result.stdout, trace: JSON.parse(readFileSync(path.join(home, 'trace.json'), 'utf8')) }
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

for (const [name, args] of [
  ['terminal boolean', [BV, '--no-frames']],
  ['boolean before BV', ['--no-frames', BV]],
  ['boolean before value options', [BV, '--no-frames', '--bucket', '20', '--comments', '3']],
  ['value options before BV', ['--bucket', '20', '--top', '2', BV, '--no-frames']],
  ['adjacent booleans', [BV, '--no-frames', '--score']],
  ['bare substrip before BV', ['--substrip', BV, '--no-frames']],
]) {
  test(`${name}: --no-frames prevents frame subprocesses`, () => {
    const { output, trace } = run(args)
    assert.equal(trace.children.length, 0)
    assert.doesNotMatch(output, /⑥ 画面/)
    if (args.includes('--score')) assert.match(output, /评分卡（每项/)
    if (args.includes('--comments')) assert.ok(trace.requests.some((u) => new URL(u).searchParams.get('ps') === '3'))
  })
}

test('default frame path remains enabled and preserves BV/grid arguments', () => {
  const { trace } = run([BV, '--grid', '4x4'])
  assert.equal(trace.children.length, 1)
  assert.ok(trace.children[0].args[0].endsWith('/bili-watch.mjs'))
  assert.deepEqual(trace.children[0].args.slice(1), [BV, '4x4'])
})

test('terminal --score remains a boolean without disabling frames', () => {
  const { output, trace } = run([BV, '--score'])
  assert.equal(trace.children.length, 1)
  assert.match(output, /评分卡（每项/)
})
