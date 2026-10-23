// A conservative, local policy, not a public-holiday calendar. When explicitly
// enabled, the same saved windows apply every day and never admit 09–12/14–18
// Beijing time. This is narrower than the provider's weekend/holiday discount.
const zone = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})
const parseTime = (value, end = false) => {
  if (end && value === '24:00') return 1440
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value))
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN
}

/** Only opt-in changes existing installations. `now` is injectable for tests. */
export function activityAllowed(cfg, now = new Date()) {
  if (cfg?.night?.offPeakOnly !== true) return { allowed: true, reason: '未启用谷时活动限制' }
  const instant = new Date(now)
  if (!Number.isFinite(instant.getTime())) return { allowed: false, reason: '活动时钟无效' }
  const p = Object.fromEntries(zone.formatToParts(instant).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]))
  const minute = Number(p.hour) * 60 + Number(p.minute)
  if ((minute >= 540 && minute < 720) || (minute >= 840 && minute < 1080)) return { allowed: false, reason: '北京时间高峰保护时段，等待谷时窗口' }
  const windows = Array.isArray(cfg.night.windows) ? cfg.night.windows : []
  const active = windows.map((w) => ({ start: parseTime(w.start), end: parseTime(w.end, true) }))
    .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start && minute >= w.start && minute < w.end)
  if (!active.length) return { allowed: false, reason: '当前不在已保存的谷时活动窗口' }
  const end = Math.min(Math.max(...active.map((w) => w.end)), minute < 540 ? 540 : minute < 840 ? 840 : 1440)
  const dayStart = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) - 8 * 60 * 60 * 1000
  return { allowed: true, reason: '谷时活动窗口内', deadline: new Date(dayStart + end * 60_000).toISOString() }
}
