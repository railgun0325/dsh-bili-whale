import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

// Only source text is read from disk. Scheduler dependencies are synthetic:
// no real home directory, credentials, timers, subprocesses, network, or DSH.
const root = process.env.BILI_WHALE_TEST_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { resolveSessionConfig } = await import(path.join(root, 'lib/session-config.js'))
const nightPlan = await import(path.join(root, 'tools/lib/night-plan.mjs'))
const { mentionSummaryLines } = await import(path.join(root, 'lib/mention-summary.js'))
const { resolveRuntime } = await import(path.join(root, 'tools/lib/runtime.mjs'))
const { activityAllowed } = await import(path.join(root, 'lib/offpeak.js'))
const NOW = Date.UTC(2026, 9, 20, 12)
const today = new Date(NOW).toLocaleDateString('sv-SE')
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])) }
  static now() { return NOW }
}
// 共享计划引擎的已到点计划（schema 2，绝对时间戳）：默认窗口 20:00–24:00，NOW = 北京 20:00
const duePlan = (action = 'wake') => ({ schema: 2, date: today, wakes: 0, usedCount: {}, skippedWindows: [], action, fired: false, atMs: NOW - 60_000, at: 1199, atText: `${today} 19:59`, window: '20:00–24:00', windowKey: `${today}|20:00–24:00`, startsAt: NOW - 3_600_000, endsAt: NOW + 3_600_000 })
const deferred = () => {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

async function harness({ platform = 'darwin', state, create, feed, config, sessions = [] } = {}) {
  const files = new Map([
    ['/fake/.dsh/bili-whale.config.json', { listen: { comment: true, allDay: true, dm: true, live: true, liveRoom: '123' }, owner: { mid: '1' } }],
    ['/fake/.bili-ai/credentials.json', {}],
    ['/fake/.dsh/whale-listen.json', { lastSeen: 1 }],
  ])
  if (config) files.set('/fake/.dsh/bili-whale.config.json', config)
  if (state) files.set('/fake/.dsh/whale-night.json', state)
  const calls = { models: [], lists: 0, reads: 0, writes: 0, creates: [], prompts: [], execs: [], feeds: [], kills: 0 }
  const timers = new Map()
  const allTimers = []
  let nextTimer = 0
  const schedule = (kind) => (fn, delay) => {
    const timer = { id: ++nextTimer, kind, fn, delay }
    timers.set(timer.id, timer)
    allTimers.push(timer)
    return timer.id
  }
  const nodePath = `/fake/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/${platform === 'win32' ? 'node.exe' : 'node'}`
  const fakeFs = {
    existsSync: (p) => p === nodePath,
    readFileSync(p) {
      calls.reads++
      if (!files.has(p)) throw new Error('ENOENT (isolated fixture)')
      return JSON.stringify(files.get(p))
    },
    mkdirSync() {},
    writeFileSync(p, s) { if(!String(p).includes('whale-runtime.json')) calls.writes++; files.set(p, JSON.parse(s)) },
    renameSync(from, to) { if(!String(to).includes('whale-runtime.json')) calls.writes++; files.set(to, files.get(from)); files.delete(from) },
    unlinkSync(p) { files.delete(p) },
    appendFileSync() { calls.writes++ },
    rmSync(p) { calls.writes++; files.delete(p) },
  }
  const execFile = (exe, args, options, callback) => {
    calls.execs.push({ exe, args, callback })
    return { kill() { calls.kills++ } }
  }
  const context = vm.createContext({
    process: { platform, env: {}, execPath: '/fake/Electron' },
    Date: FixedDate,
    AbortController, Buffer,
    setInterval: schedule('interval'), setTimeout: schedule('timeout'),
    clearInterval: (id) => timers.delete(id), clearTimeout: (id) => timers.delete(id),
    console: { log() {}, warn() {} },
  })
  const stubs = {
    'node:fs': { default: fakeFs },
    'node:path': { default: path },
    'node:os': { default: { homedir: () => '/fake' } },
    'node:child_process': { execFile },
    'node:url': { fileURLToPath },
    './session-config.js': { resolveSessionConfig },
    './model-selection.js': { async selectWhaleSessionModel(ctx, target, selection) { calls.models.push({ target, selection }); return { sessionId: target.id, selected: selection } } },
    './scheduler.js': { startScheduler() { throw new Error('host apply forbidden in isolated test') } },
    './offpeak.js': { activityAllowed },
    './mention-summary.js': { mentionSummaryLines },
    './node-runtime.js': { resolveNodeRuntime: () => nodePath, nodeEnv: () => ({}) },
    './work-dir.js': { resolveWorkDir: (value, fallback) => value || fallback },
    '../tools/lib/paths.mjs': { HOME: '/fake', DSH_HOME: '/fake/.dsh', configPath: '/fake/.dsh/bili-whale.config.json', credentialsPath: '/fake/.bili-ai/credentials.json' },
    '../tools/lib/night-plan.mjs': nightPlan,
    '../tools/lib/night-config.mjs': { readNightConfig() { return { windows: [{ start: '20:00', end: '24:00', wakes: 1 }], skipChance: 0.3, minGapMin: 10, maxVideos: 5, ...(files.get('/fake/.dsh/bili-whale.config.json')?.night ?? {}) } } },
    '../tools/lib/msgfeed.mjs': {
      makeHeaders: () => ({}),
      pullFeed(kind) {
        calls.feeds.push(kind)
        return feed ? feed(kind) : Promise.resolve({ items: [] })
      },
    },
  }
  const load = async (relative, suffix = '') => {
    const mod = new vm.SourceTextModule(fs.readFileSync(path.join(root, relative), 'utf8') + suffix, {
      context,
      initializeImportMeta(meta) { meta.url = 'file:///fake/plugin/' + relative },
    })
    await mod.link((specifier) => {
      assert.ok(Object.hasOwn(stubs, specifier), `unexpected import: ${specifier}`)
      const stub = stubs[specifier]
      return new vm.SyntheticModule(Object.keys(stub), function () {
        for (const [key, value] of Object.entries(stub)) this.setExport(key, value)
      }, { context })
    })
    await mod.evaluate()
    return mod.namespace
  }
  const start = async () => {
    const mod = await load('lib/scheduler.js')
    return mod.startScheduler({ sessionController: {
      async list() { calls.lists++; return { items: sessions } },
      async create(request) {
        calls.creates.push(request)
        const result = create ? await create(request) : { sessionId: request.sessionId }
        if (result?.sessionId === request.sessionId) sessions.push({ sessionId: request.sessionId, cwd: request.cwd })
        return result
      },
      async prompt(request) { calls.prompts.push(request) },
    } }, { dshHome: '/fake/.dsh', biliMjs: '/fake/plugin/tools/bili.mjs', cwd: '/fake' })
  }
  return { calls, timers, allTimers, files, load, start, nodePath, sessions }
}

test('both resolvers use bundled Node for macOS and Windows', async () => {
  // 上游 tools/lib/runtime.mjs 统一了插件与工具链的运行时查找（含执行探测）；这里验证两个平台都选中 DSH 自带的 node
  const dsh = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-whale-runtime-'))
  try {
    for (const platform of ['darwin', 'win32']) {
      const bin = path.join(dsh, 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', platform === 'win32' ? 'node.exe' : 'node')
      fs.mkdirSync(path.dirname(bin), { recursive: true }); fs.writeFileSync(bin, '')
      const found = resolveRuntime(dsh, { platform, env: {}, home: dsh, electron: true, execPath: '/fake/Electron', probe: (file) => file === bin })
      assert.equal(found.file, bin)
    }
  } finally { fs.rmSync(dsh, { recursive: true, force: true }) }
  // 调度器的子进程都用解析出来的 node（不是 Electron 主程序）
  const h = await harness()
  const scheduler = await h.start()
  h.allTimers.find((t) => t.kind === 'interval' && t.delay === 20_000).fn()
  assert.equal(h.calls.execs[0].exe, h.nodePath)
  h.calls.execs[0].callback(null, '', '')
  await flush()
  scheduler.stop()
})

test('stop clears all eight timers and stale callbacks remain inert', async () => {
  const h = await harness({ state: duePlan() })
  const scheduler = await h.start()
  assert.equal([...h.timers.values()].filter((t) => t.kind === 'interval').length, 4)
  assert.equal([...h.timers.values()].filter((t) => t.kind === 'timeout').length, 4)
  scheduler.stop()
  scheduler.stop()
  assert.equal(h.timers.size, 0)
  const before = JSON.stringify(h.calls)
  for (const timer of h.allTimers) timer.fn() // already queued callbacks can still arrive
  scheduler.invalidate()
  await Promise.all([scheduler.tick(), scheduler.listenTick(), scheduler.liveTick()])
  await flush()
  assert.equal(JSON.stringify(h.calls), before)
})

test('ordinary scheduled wake still works before stop', async () => {
  const h = await harness({ state: duePlan() })
  const scheduler = await h.start()
  await scheduler.tick()
  assert.equal(h.calls.creates.length, 1)
  assert.equal(h.calls.prompts.length, 1)
  assert.equal(h.files.get('/fake/.dsh/whale-night.json').fired, true)
  scheduler.stop()
})

test('stop during session creation prevents a delayed wake or skip prompt', async () => {
  for (const action of ['wake', 'skip']) {
    const ready = deferred()
    const h = await harness({ state: duePlan(action), create: () => ready.promise })
    const scheduler = await h.start()
    const pending = scheduler.tick()
    await flush()
    assert.equal(h.calls.creates.length, 1)
    scheduler.stop()
    ready.resolve()
    await pending
    assert.equal(h.calls.prompts.length, 0)
    assert.equal(h.calls.writes, 0)
  }
})

test('late DM subprocess result cannot create or wake a session after stop', async () => {
  const h = await harness()
  const scheduler = await h.start()
  h.allTimers.find((t) => t.kind === 'interval' && t.delay === 20_000).fn()
  assert.equal(h.calls.execs.length, 1)
  scheduler.stop()
  h.calls.execs[0].callback(null, JSON.stringify({ hit: true, mid: '1', text: 'fixture', receipt: 'fixture-receipt' }), '')
  await flush()
  assert.equal(h.calls.creates.length, 0)
  assert.equal(h.calls.prompts.length, 0)
})

test('late comment result stops before a second feed request or wake', async () => {
  const result = deferred()
  const h = await harness({ feed: () => result.promise })
  const scheduler = await h.start()
  const pending = scheduler.listenTick()
  assert.deepEqual(h.calls.feeds, ['reply'])
  scheduler.stop()
  result.resolve({ items: [{ t: 2, mid: '1', who: 'fixture', kind: 'reply' }] })
  await pending
  assert.deepEqual(h.calls.feeds, ['reply'])
  assert.equal(h.calls.creates.length, 0)
  assert.equal(h.calls.prompts.length, 0)
  assert.equal(h.calls.writes, 0)
})

test('stop kills live listener and ignores its late hit callback', async () => {
  const h = await harness()
  const scheduler = await h.start()
  await scheduler.liveTick()
  assert.equal(h.calls.execs.length, 1)
  scheduler.stop()
  scheduler.stop()
  assert.equal(h.calls.kills, 1)
  h.calls.execs[0].callback(null, 'AWAIT_HIT fixture', '')
  await flush()
  assert.equal(h.calls.creates.length, 0)
  assert.equal(h.calls.prompts.length, 0)
  assert.equal(h.timers.size, 0)
})

const quiet = { listen: { comment: false, dm: false, live: false } }
const due = duePlan

test('pause suppresses fresh planning, due wake and skip, including startup/invalidate', async () => {
  for (const state of [undefined, due(), due('skip')]) {
    const h = await harness({ state, config: { ...quiet, night: { enabled: false } } })
    const scheduler = await h.start()
    await scheduler.tick()
    for (const timer of h.allTimers) timer.fn()
    scheduler.invalidate()
    await flush()
    assert.equal(h.calls.execs.length, 0)
    assert.equal(h.calls.creates.length, 0)
    assert.equal(h.calls.prompts.length, 0)
    scheduler.stop()
  }
})

test('pause while session creation awaits cancels the pending timed wake', async () => {
  const ready = deferred()
  const h = await harness({ state: due(), config: { ...quiet, night: { enabled: true } }, create: () => ready.promise })
  const scheduler = await h.start()
  const pending = scheduler.tick()
  await flush()
  h.files.get('/fake/.dsh/bili-whale.config.json').night.enabled = false
  ready.resolve({ sessionId: 'bili-whale' })
  await pending
  assert.equal(h.calls.prompts.length, 0)
  assert.notEqual(h.files.get('/fake/.dsh/whale-night.json').fired, true)
  scheduler.stop()
})

test('configured target is used, and a cold restart reuses it without create()', async () => {
  const cfg = { ...quiet, session: { id: 'my-whale', cwd: '/fake/whale-workspace' } }
  const h = await harness({ state: due(), config: cfg })
  let scheduler = await h.start()
  await scheduler.tick()
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.creates)), [{ sessionId: 'my-whale', cwd: '/fake/whale-workspace' }])
  assert.equal(h.calls.prompts[0].sessionId, 'my-whale')
  assert.equal(h.calls.models[0].target.id, 'my-whale')
  scheduler.stop()
  h.files.set('/fake/.dsh/whale-night.json', due())
  scheduler = await h.start()
  await scheduler.tick()
  assert.equal(h.calls.creates.length, 1)
  assert.equal(h.calls.prompts.length, 2)
  assert.equal(h.calls.prompts[1].sessionId, 'my-whale')
  scheduler.stop()
})

test('existing target cwd/subagent mismatch refuses to prompt or create', async () => {
  for (const row of [
    { sessionId: 'bili-whale', cwd: '/another-workspace' },
    { sessionId: 'bili-whale', cwd: '/fake', origin: 'subagent' },
    { sessionId: 'bili-whale', cwd: '/fake', parentSessionId: 'chief' },
    { sessionId: 'bili-whale', cwd: '/fake', projections: { values: { workingDirectory: '/another-workspace' } } },
  ]) {
    const h = await harness({ state: due(), config: quiet, sessions: [row] })
    const scheduler = await h.start()
    await scheduler.tick()
    assert.equal(h.calls.creates.length, 0)
    assert.equal(h.calls.prompts.length, 0)
    scheduler.stop()
  }
})

test('creation failure is not cached as ready and wrong returned IDs never wake', async () => {
  for (const create of [async () => { throw new Error('fixture failure') }, async () => ({ sessionId: 'wrong-id' })]) {
    const h = await harness({ state: due(), config: quiet, create })
    const scheduler = await h.start()
    await scheduler.tick()
    await scheduler.tick()
    assert.equal(h.calls.creates.length, 2)
    assert.equal(h.calls.prompts.length, 0)
    scheduler.stop()
  }
})

test('session config validates explicit targets and preserves omitted legacy defaults', () => {
  const defaults = { id: 'bili-whale', cwd: '/fake' }
  assert.deepEqual(resolveSessionConfig({}, defaults), defaults)
  assert.deepEqual(resolveSessionConfig({ session: { id: 'whale-2', cwd: '/fake/whale' } }, defaults), { id: 'whale-2', cwd: '/fake/whale' })
  for (const session of [{ id: '../chief' }, { id: '   ' }, { cwd: '~/whale' }, { cwd: null }, []]) {
    assert.throws(() => resolveSessionConfig({ session }, defaults))
  }
})

test('native settings section exposes clock pause and dedicated session fields', () => {
  let exported
  vm.runInNewContext(fs.readFileSync(path.join(root, 'lib/client.js'), 'utf8'), {
    window: { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => ({})) } } },
  })
  for (const key of ['night.enabled', 'session.id', 'session.cwd']) {
    assert.ok(exported.FIELDS.some((field) => field.path.join('.') === key), key)
  }
  assert.equal(exported.FIELDS.find((field) => field.path.join('.') === 'night.enabled').kind, 'switch')
})


test('paused CLI plan/clock exit without writing state or launching a test wake', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-whale-pause-test-'))
  try {
    const cfg = path.join(home, 'config.json')
    fs.writeFileSync(cfg, JSON.stringify({ night: { enabled: false } }))
    for (const args of [['plan'], ['clock', '--test', '0']]) {
      const result = spawnSync(process.execPath, [path.join(root, 'tools/commands/whale-night.mjs'), ...args], {
        env: { ...process.env, HOME: home, USERPROFILE: home, BILI_WHALE_CONFIG: cfg }, encoding: 'utf8', timeout: 2000,
      })
      assert.equal(result.status, 0, result.stderr)
      assert.equal(JSON.parse(result.stdout).action, 'paused')
      assert.equal(fs.existsSync(path.join(home, '.dsh')), false)
    }
  } finally { fs.rmSync(home, { recursive: true, force: true }) }
})


test('timed prompt respects actual configured work and does not force extra interactions', async () => {
  const h = await harness()
  const mod = await h.load('lib/scheduler.js')
  const pausedShare = mod.configuredWakePrompt({}, { night: { maxVideos: 3 }, share: { enabled: false }, quota: { shareDaily: 0 }, listen: { comment: false, dm: false, live: false }, notify: { type: 'none' } })
  assert.match(pausedShare, /初筛最多 3 条/)
  assert.match(pausedShare, /AGENTS.md/)
  assert.match(pausedShare, /recommendation-context.mjs/)
  assert.match(pausedShare, /debrief --no-frames/)
  assert.match(pausedShare, /只有画面信息确实影响判断时才抽帧/)
  assert.match(pausedShare, /不发评论、私信/)
  assert.match(pausedShare, /不运行 comment-digest、dm-await 或持续监听/)
  assert.match(pausedShare, /已有真实分享记录且今天尚未检查反馈，每日仅一次 `quota react --auto --hours 48`/)
  assert.match(pausedShare, /没有分享记录就跳过，不自动回复/)
  assert.match(pausedShare, /notify.type=none：只更新本地/)
  assert.doesNotMatch(pausedShare, /对这 5 条|挑 2–3 条深读|给他的信|不用审核/)
  const enabled = mod.configuredWakePrompt({}, { night: { maxVideos: 5 }, share: { enabled: true, via: 'comment', minScore: 15 }, quota: { shareDaily: 1 }, notify: { type: 'none' } })
  assert.match(enabled, /阈值 15\/20，每天上限 1 条/)
  assert.match(enabled, /--share --auto --reason --score --rank 1/)
  const skip = mod.skipPrompt({ reason: '按配置随机跳过' })
  assert.match(skip, /本地记录/)
  assert.match(skip, /不编造疲劳、饥饿、情绪/)
  assert.match(skip, /不检索、不发送、不回复/)
})


test('settings POST preserves model route, and independent CLI cold read retains it', async () => {
  const desired = { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' }
  const h = await harness({ config: quiet })
  const host = await h.load('lib/index.js')
  const routes = new Map()
  const ctx = {
    sessionController: {}, llm: {},
    webServer: { register(route) { routes.set(route.path, route); return () => {} } },
    connection: { requestRejection(req) { return req.headers.origin === 'http://127.0.0.1' ? undefined : 403 } },
    get(name) { return this[name] }, effect(fn) { fn() },
  }
  host.default.apply(ctx)
  const call = async (pathname, body = {}, headers = {}) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))])
    req.headers = { host: '127.0.0.1', origin: 'http://127.0.0.1', ...headers }
    req.method = 'POST'
    const res = { statusCode: 200, writeHead(code) { this.statusCode = code }, end(value) { this.body = value ? JSON.parse(value) : null } }
    await routes.get(pathname).handler(req, res)
    return res
  }
  const response = await call('/dsh-bili/api/settings', { session: { id: 'bili-whale', cwd: '/fake/whale', modelSelection: desired }, night: { enabled: false } })
  assert.equal(response.statusCode, 200)
  const saved = h.files.get('/fake/.dsh/bili-whale.config.json')
  assert.deepEqual(saved.session.modelSelection, desired)
  // A subsequent save changing an unrelated setting must retain the route.
  assert.equal((await call('/dsh-bili/api/settings', { night: { maxVideos: 4 } })).statusCode, 200)
  assert.deepEqual(h.files.get('/fake/.dsh/bili-whale.config.json').session.modelSelection, desired)
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-whale-model-cold-'))
  try {
    const cfg = path.join(home, 'config.json')
    fs.writeFileSync(cfg, JSON.stringify(h.files.get('/fake/.dsh/bili-whale.config.json')))
    const script = `const {config}=await import(${JSON.stringify(pathToFileURL(path.join(root, 'tools/lib/config.mjs')).href)});console.log(JSON.stringify(config().session.modelSelection));`
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, HOME: home, USERPROFILE: home, BILI_WHALE_CONFIG: cfg }, encoding: 'utf8', timeout: 2000 })
    assert.equal(child.status, 0, child.stderr)
    assert.deepEqual(JSON.parse(child.stdout), desired)
  } finally { fs.rmSync(home, { recursive: true, force: true }) }
  // Same existing request fence for the new write endpoint.
  assert.equal((await call('/dsh-bili/api/session-model', {}, { origin: 'https://untrusted.example' })).statusCode, 403)
  assert.equal((await call('/dsh-bili/api/session-model', {}, { host: 'remote.example' })).statusCode, 403)
  assert.equal((await call('/dsh-bili/api/session-model', { sessionId: 'chief' })).statusCode, 400)
  assert.equal((await call('/dsh-bili/api/session-model', { apiKey: 'fixture' })).statusCode, 400)
  assert.equal(h.calls.models.length, 0)
  assert.equal((await call('/dsh-bili/api/session-model')).statusCode, 200)
  assert.equal(h.calls.models.length, 1)
  assert.equal(h.calls.models[0].target.id, 'bili-whale')
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.models[0].selection)), desired)
  assert.equal((await call('/dsh-bili/api/settings', { session: { modelSelection: { ...desired, apiKey: 'fixture' } } })).statusCode, 400)
  assert.deepEqual(h.files.get('/fake/.dsh/bili-whale.config.json').session.modelSelection, desired)
})
