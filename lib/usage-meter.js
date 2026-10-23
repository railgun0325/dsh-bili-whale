import fs from 'node:fs'
import path from 'node:path'

export const PRICING = Object.freeze({
  checkedAt: '2026-10-24', currency: 'CNY', source: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
  models: { 'deepseek-flash': { input: 1, cacheRead: 0.02, output: 4 }, 'deepseek-v4-pro': { input: 4.5, cacheRead: 0.15, output: 13.5 } },
})
const count = v => Number.isSafeInteger(v) && v >= 0 ? v : 0
const parts = time => {
  const d = new Date(time + 8 * 3600000)
  return { date: d.toISOString().slice(0, 10), month: d.toISOString().slice(0, 7), weekday: d.getUTCDay(), hour: d.getUTCHours(), minute: d.getUTCMinutes() }
}
// 2026 State Council public holiday notice; weekends always use off-peak rates.
const holidays2026 = [['01-01','01-03'],['02-15','02-23'],['04-04','04-06'],['05-01','05-05'],['06-19','06-21'],['09-25','09-27'],['10-01','10-07']]
export function pricePeriod(time) {
  if (!Number.isFinite(time) || time <= 0) return 'unknown'
  const p = parts(time), minutes = p.hour * 60 + p.minute
  if (p.weekday === 0 || p.weekday === 6 || !((minutes >= 540 && minutes < 720) || (minutes >= 840 && minutes < 1080))) return 'off-peak'
  if (!p.date.startsWith('2026-')) return 'unknown'
  return holidays2026.some(([a,b]) => p.date.slice(5) >= a && p.date.slice(5) <= b) ? 'off-peak' : 'peak'
}
const aliases = { 'deepseek-v4-flash': 'deepseek-flash', 'deepseek-v4-flash-vision-exp': 'deepseek-flash' }
export function estimateCall(row) {
  const model = aliases[row.model] ?? row.model
  const rates = row.provider === 'deepseek-official' ? PRICING.models[model] : null
  if (!rates || count(row.cacheWrite) > 0) return null
  const base = (count(row.input) * rates.input + count(row.cacheRead) * rates.cacheRead + count(row.output) * rates.output) / 1e6
  const period = pricePeriod(row.time)
  return { low: base * (period === 'peak' ? 2 : 1), high: base * (period === 'off-peak' ? 1 : 2), period }
}
function finalUsage(data) {
  if (data.usage) return data.usage
  for (const record of [...(data.stream ?? [])].reverse()) if (record.type === 'chunk' && record.chunk?.type === 'usage') return record.chunk.usage
  return null
}

export function foldUsage(events, from = {}, previous = {}) {
  const state = { provider: from.provider ?? '', model: from.model ?? '', retry: from.retry ?? null }
  let rows = { ...previous }
  for (const event of events) {
    const d = event.data ?? {}
    if (event.type === 'request/header' && d.header?.config?.model) Object.assign(state, { provider: d.header.config.provider ?? '', model: d.header.config.model })
    if (event.type === 'request/context' && d.model) Object.assign(state, { provider: d.provider ?? '', model: d.model })
    if (event.type === 'llm/retry-started') state.retry = { turn: d.turn, step: d.step, count: state.retry?.turn === d.turn && state.retry.step === d.step ? state.retry.count + 1 : 1 }
    if (event.type === 'session/end-seed' && d.inherited === true) rows = {}
    if (!['assistant/message', 'assistant/attempt'].includes(event.type)) continue
    const usage = finalUsage(d)
    if (!usage) continue
    const attempt = state.retry?.turn === d.turn && state.retry.step === d.step ? state.retry.count : 0
    const key = `${d.turn}:${d.step}:${attempt}`
    rows[key] = { key, time: Number(event.time) || 0, provider: state.provider, model: state.model,
      input: count(usage.inputTokens), cacheRead: count(usage.cacheReadTokens), cacheWrite: count(usage.cacheWriteTokens), output: count(usage.outputTokens) }
  }
  return { state, rows }
}

export function summarizeUsage(rows, now = Date.now()) {
  const current = parts(now)
  const empty = () => ({ calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, totalTokens: 0, estimatedCostLow: 0, estimatedCostHigh: 0, unpricedCalls: 0 })
  const total = empty(), today = empty(), month = empty(), models = new Map()
  let lastCallAt = null
  for (const row of Object.values(rows)) {
    const p = row.time > 0 ? parts(row.time) : {}
    const estimate = estimateCall(row), modelKey = `${row.provider}/${row.model}`
    const model = models.get(modelKey) ?? { provider: row.provider, model: row.model, ...empty() }
    models.set(modelKey, model)
    for (const sum of [total, model, ...(p.date === current.date ? [today] : []), ...(p.month === current.month ? [month] : [])]) {
      sum.calls++
      for (const key of ['input', 'cacheRead', 'cacheWrite', 'output']) sum[key] += count(row[key])
      sum.totalTokens += count(row.input) + count(row.cacheRead) + count(row.cacheWrite) + count(row.output)
      if (estimate) { sum.estimatedCostLow += estimate.low; sum.estimatedCostHigh += estimate.high } else sum.unpricedCalls++
    }
    if (row.time > 0 && (!lastCallAt || row.time > Date.parse(lastCallAt))) lastCallAt = new Date(row.time).toISOString()
  }
  return { total, today, month, models: [...models.values()], lastCallAt, pricing: PRICING, currency: 'CNY', billingExact: false, scope: 'Dedicated Whale session model attempts; excludes OpenBiliClaw, Codex and unrelated DSH sessions. Auxiliary requests not logged to this session may be absent.', date: current.date }
}

export function createUsageReader(ctx, { getSessionId, file, now = Date.now } = {}) {
  let saved = null, pending = null
  try { const value = JSON.parse(fs.readFileSync(file, 'utf8')); if (value.version === 1 && value.rows && value.fold) saved = value } catch {}
  const refresh = async () => {
    const sessionId = getSessionId()
    const projection = await ctx.sessionController.projections({ sessionId }, AbortSignal.timeout(10000))
    const through = projection?.asOfSeq
    if (!Number.isSafeInteger(through)) throw Error('Session usage is not yet available')
    const current = saved?.sessionId === sessionId && saved.through <= through ? saved : { version: 1, sessionId, through: -1, rows: {}, fold: {} }
    if (through > current.through) {
      const collected = []
      let beforeSeq, complete = false
      for (let pageNo = 0; pageNo < 20; pageNo++) {
        const page = await ctx.sessionController.page({ address: { kind: 'session', sessionId }, throughSeq: through, ...(beforeSeq === undefined ? {} : { beforeSeq }), maxMessages: 200 }, AbortSignal.timeout(15000))
        const got = (page.records ?? []).map(x => x.event)
        if (!got.length) { complete = !page.hasMore; break }
        for (let i = got.length - 1; i >= 0; i--) {
          if (got[i].seq <= current.through) { complete = true; break }
          collected.push(got[i])
        }
        if (complete || !page.hasMore) { complete = true; break }
        const next = got[0].seq
        if (!Number.isSafeInteger(next) || (beforeSeq !== undefined && next >= beforeSeq)) throw Error('Session usage pagination did not advance')
        beforeSeq = next
      }
      if (!complete) throw Error('Session usage history exceeds bounded scan')
      collected.reverse()
      if (collected.length && collected[0].seq !== current.through + 1) throw Error('Session usage history has a gap')
      const folded = foldUsage(collected, current.fold, current.rows)
      saved = { version: 1, sessionId, through, rows: folded.rows, fold: folded.state }
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const temporary = file + '.' + process.pid + '.tmp'
      fs.writeFileSync(temporary, JSON.stringify(saved), { mode: 0o600 }); fs.renameSync(temporary, file)
    } else saved = current
    const summary = summarizeUsage(saved.rows, now())
    const expected = projection.values?.tokenUsage
    const projectionMatches = !expected || (summary.total.input === expected.uncachedInputTokens && summary.total.cacheRead === expected.cacheReadTokens && summary.total.output === expected.outputTokens && summary.total.cacheWrite === expected.cacheWriteTokens)
    return { ok: true, sessionId, updatedAt: new Date(now()).toISOString(), throughSeq: through, projectionMatches, ...summary }
  }
  return { read() { if (pending) return pending; const job = refresh().finally(() => { if (pending === job) pending = null }); pending = job; return job } }
}
