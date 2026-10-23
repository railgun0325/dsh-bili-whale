// Ordinary comment policy. The caller cannot bypass this gate by omitting --auto.
// The lock spans reservation -> one POST -> outcome persistence. An uncertain
// outcome or orphaned lock needs human review; neither is automatically retried.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const VERSION = 1
const SEVEN_DAYS = 7 * 86_400_000
const STATUSES = new Set(['reserved', 'success', 'failed', 'unknown'])
const validId = (value) => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value)
const validBV = (value) => typeof value === 'string' && /^BV[0-9A-Za-z]{10}$/.test(value)
const timeOf = (value) => { const n = new Date(value).getTime(); if (!Number.isFinite(n)) throw new Error('互动账本时间损坏，拒绝发送'); return n }
const dayOf = (value) => new Date(value).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
const normalized = (text) => String(text).normalize('NFKC').replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')

function settings(config) {
  const value = config?.interaction
  if (!value || value.enabled !== true) throw new Error('普通互动已关闭；需要 interaction.enabled=true')
  const integer = (name, fallback, min, max) => {
    const n = value[name] ?? fallback
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`interaction.${name} 配置无效，拒绝发送`)
    return n
  }
  return {
    daily: integer('daily', 3, 0, 12),
    topLevelDaily: integer('topLevelDaily', 1, 0, 3),
    replyDaily: integer('replyDaily', 2, 0, 9),
    minIntervalSec: integer('minIntervalSec', 1200, 60, 86_400),
    maxChars: integer('maxChars', 160, 1, 500),
    noMention: value.noMention !== false,
    stopOnRisk: value.stopOnRisk !== false,
  }
}

function validate(config, request) {
  const limits = settings(config)
  if (String(request.type ?? '1') !== '1' || !validId(String(request.oid ?? '')) || !validBV(request.bvid)) {
    throw new Error('普通互动只允许有合法 BV 和 oid 的 type=1 视频评论')
  }
  const root = request.root ? String(request.root) : ''
  const parent = request.parent ? String(request.parent) : ''
  if (Boolean(root) !== Boolean(parent) || (root && (!validId(root) || !validId(parent)))) throw new Error('回复必须同时提供合法 root 和 parent')
  const message = typeof request.message === 'string' ? request.message.trim() : ''
  if (!message || [...message].length > limits.maxChars) throw new Error(`互动正文必须为 1–${limits.maxChars} 字`)
  const scan = normalized(message)
  if (limits.noMention && /@/.test(scan)) throw new Error('普通互动禁止 @ 提及')
  if (/(?:https?:\/\/|www\.|file:\/\/|\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b|(?:[a-z0-9][a-z0-9-]*\.)+(?:com|cn|net|org|io|xyz|top|me|app|dev|tv|co|ai|cc|info|link|gg|ly|us|uk|de|ru)\b)/i.test(scan)) {
    throw new Error('互动正文禁止网址或链接')
  }
  if (/(?:SESSDATA|bili_jct|buvid3|authorization\s*[:=]|bearer\s+|api[-_ ]?key|cookie\s*[:=]|(?:access|refresh)[_-]?token|\b(?:token|password)\s*[:=]|sk-[a-z0-9_-]{8,}|\/Users\/|\/home\/|\/var\/folders\/|\/private\/|~\/\.|\.bili-ai\b|\.dsh\b|[a-z]:[\\/]Users[\\/])/i.test(scan)) {
    throw new Error('互动正文包含疑似凭据或私人路径，拒绝发送')
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(scan)) throw new Error('互动正文包含控制字符')
  const kind = parent ? 'reply' : 'top'
  const fingerprint = crypto.createHash('sha256').update([request.oid, root, parent, message].join('\0')).digest('hex')
  return { limits, kind, oid: String(request.oid), bvid: request.bvid, root, parent, fingerprint }
}

function filenames(dataDir) {
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) throw new Error('互动数据目录必须是绝对路径')
  const directory = path.join(dataDir, '.bili-ai')
  return { directory, file: path.join(directory, 'interaction.json'), lock: path.join(directory, 'interaction.lock') }
}

function load(file) {
  let value
  try {
    const stat = fs.lstatSync(file)
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error('互动账本不是普通文件或体积异常')
    value = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return { version: VERSION, attempts: [], halted: null }
    throw new Error('互动账本无法读取或已损坏，拒绝发送', { cause: error })
  }
  const valid = value && value.version === VERSION && Array.isArray(value.attempts)
    && (value.halted === null || (typeof value.halted === 'object' && typeof value.halted.reason === 'string' && Number.isFinite(Date.parse(value.halted.at))))
    && value.attempts.every((item) => item && typeof item.id === 'string' && Number.isFinite(Date.parse(item.at))
      && ['top', 'reply'].includes(item.kind) && validBV(item.bvid) && validId(item.oid)
      && typeof item.root === 'string' && typeof item.parent === 'string'
      && (item.kind === 'top' ? item.root === '' && item.parent === '' : validId(item.root) && validId(item.parent))
      && /^[a-f0-9]{64}$/.test(item.fingerprint) && STATUSES.has(item.status))
  if (!valid) throw new Error('互动账本结构损坏，拒绝发送')
  return value
}

function save(file, value) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`
  let fd
  try {
    fd = fs.openSync(temporary, 'wx', 0o600)
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n')
    fs.fsyncSync(fd)
    fs.closeSync(fd); fd = undefined
    fs.renameSync(temporary, file)
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
    try { fs.unlinkSync(temporary) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}

function check(state, request, now) {
  if (state.halted) throw new Error(`互动已暂停，须人工检查后解除：${state.halted.reason}`)
  const n = timeOf(now)
  if (state.attempts.some((item) => timeOf(item.at) > n + 60_000)) throw new Error('互动账本存在未来记录，拒绝发送')
  if (state.attempts.some((item) => item.status === 'reserved')) throw new Error('存在未确认的发送预留，互动暂停，须人工核查')
  const today = state.attempts.filter((item) => dayOf(item.at) === dayOf(now))
  if (today.length >= request.limits.daily) throw new Error('普通互动每日总额度已到上限')
  const kindCount = today.filter((item) => item.kind === request.kind).length
  if (kindCount >= (request.kind === 'top' ? request.limits.topLevelDaily : request.limits.replyDaily)) throw new Error(`${request.kind === 'top' ? '顶层评论' : '回复'}每日额度已到上限`)
  if (request.kind === 'reply' && state.attempts.some((item) => item.parent === request.parent)) throw new Error('这个 parent 已尝试回复，不重复发送')
  if (request.kind === 'top' && state.attempts.some((item) => item.kind === 'top'
      && (item.bvid === request.bvid || item.oid === request.oid) && n - timeOf(item.at) < SEVEN_DAYS)) {
    throw new Error('同一视频 7 天内已尝试顶层评论，不重复发送')
  }
  const last = state.attempts.reduce((max, item) => Math.max(max, timeOf(item.at)), -Infinity)
  if (n - last < request.limits.minIntervalSec * 1000) throw new Error(`互动间隔不足 ${request.limits.minIntervalSec} 秒`)
}

/** Read-only policy preview: no ledger, lock, or budget is created. */
export function inspectInteraction({ dataDir, config, request, now = new Date() }) {
  const parsed = validate(config, request)
  const { file, lock } = filenames(dataDir)
  if (fs.existsSync(lock)) throw new Error('互动锁存在，可能正在处理或上次中断，须人工核查')
  check(load(file), parsed, now)
  return parsed
}

const risk = (http, out) => [401, 403, 412, 429].includes(http)
  || [-101, -102, -111, -352, -401, -403, -412, -509, -799, 12002, 12015, 12016, 12035, 12051, 12074].includes(Number(out?.code))
  || /验证码|风控|权限|频繁|封禁|封停|登录|等级|刷屏|captcha|rate.?limit|forbidden/i.test(String(out?.message ?? ''))

/** `send` must do exactly one POST and return {http, out}. Reservations count
 * toward all caps, including failures. The caller must not automatically retry. */
export async function executeInteraction({ dataDir, config, request, now = () => new Date(), send }) {
  const parsed = validate(config, request)
  const names = filenames(dataDir)
  fs.mkdirSync(names.directory, { recursive: true, mode: 0o700 })
  let fd
  try { fd = fs.openSync(names.lock, 'wx', 0o600) }
  catch (error) { throw new Error('互动锁存在或无法创建，拒绝并发发送，须人工核查', { cause: error }) }
  const token = crypto.randomUUID()
  let release = true
  try {
    fs.writeFileSync(fd, JSON.stringify({ token, pid: process.pid, at: new Date().toISOString() }))
    fs.fsyncSync(fd)
    const state = load(names.file)
    const at = now()
    check(state, parsed, at)
    const attempt = { id: crypto.randomUUID(), at: new Date(at).toISOString(), kind: parsed.kind,
      oid: parsed.oid, bvid: parsed.bvid, root: parsed.root, parent: parsed.parent,
      fingerprint: parsed.fingerprint, status: 'reserved' }
    state.attempts.push(attempt)
    save(names.file, state)
    let response
    let uncertain
    try {
      response = await send()
      if (!response || !Number.isInteger(response.http) || !response.out || typeof response.out.code !== 'number') throw new Error('POST 结果格式未知')
      const rpid = response.out.data?.rpid_str ?? response.out.data?.rpid
      if (response.out.code === 0 && (!rpid || !validId(String(rpid)))) throw new Error('成功响应缺少可验证 rpid')
      attempt.status = response.http >= 200 && response.http < 300 && response.out.code === 0 ? 'success' : 'failed'
      attempt.http = response.http
      attempt.code = response.out.code
      if (attempt.status === 'success') attempt.rpid = String(rpid)
      if (parsed.limits.stopOnRisk && risk(response.http, response.out)) state.halted = { at: new Date(now()).toISOString(), reason: `风控或权限错误 HTTP ${response.http} code ${response.out.code}` }
    } catch (error) {
      uncertain = error
      attempt.status = 'unknown'
      state.halted = { at: new Date(now()).toISOString(), reason: '发送结果未知；禁止自动重发，须人工回读核查' }
    }
    try { save(names.file, state) } catch (error) { release = false; throw new Error('POST 后账本无法保存，保留互动锁，须人工核查', { cause: error }) }
    if (uncertain) throw new Error('发送结果未确认，已暂停互动；不得自动重发', { cause: uncertain })
    return response
  } finally {
    fs.closeSync(fd)
    if (release) {
      const current = JSON.parse(fs.readFileSync(names.lock, 'utf8'))
      if (current.token !== token) throw new Error('互动锁身份变化，保留锁并停止')
      fs.unlinkSync(names.lock)
    }
  }
}
