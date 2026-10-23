// Shared planning engine: absolute timestamps and persistent per-window history.
//
// 本机补丁（从 0.2.0 本地版移植到共享计划引擎上）：
//   · 配置缺失/损坏 → 停止，不采用默认配置派发
//   · night.enabled=false → plan / clock 直接返回 paused（不写状态、不触发测试唤醒）
//   · night.offPeakOnly=true → 北京时间高峰或不在保存窗口内时只返回 waiting
//   · 状态文件损坏 → 停止计划，不重置额度；写入走临时文件 + rename，跟随符号链接
import fs from 'node:fs'
import path from 'node:path'
import { dataDshPath, configPath } from '../lib/paths.mjs'
import { readNightConfig } from '../lib/night-config.mjs'
import { makePlan, completePlan, dayOf, maxWakes } from '../lib/night-plan.mjs'
import { activityAllowed } from '../../lib/offpeak.js'
// 与宿主共用 DSH home 里的状态；设置了 BILI_WHALE_DATA_HOME 时落在数据根（工作区入口跑 night 时会去掉该变量）
const STATE = dataDshPath('whale-night.json')
try { const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')); if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid config') }
catch { console.error('鲸鱼配置缺失或损坏，停止生物钟，不采用默认配置派发'); process.exit(2) }
const count = (n) => n === undefined || (Number.isInteger(n) && n >= 0)
const load = () => {
  try {
    const value = JSON.parse(fs.readFileSync(STATE, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid clock state')
    if (!count(value.wakes) || (value.usedCount !== undefined && (!value.usedCount || typeof value.usedCount !== 'object' || Array.isArray(value.usedCount) || !Object.values(value.usedCount).every(count)))) throw new Error('invalid wake count')
    return value
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('生物钟状态损坏，停止计划，不重置额度')
    try { if (fs.lstatSync(STATE).isSymbolicLink()) throw new Error('dangling clock alias') } catch (e) { if (e.code !== 'ENOENT') throw e }
    return {}
  }
}
const save = (file, value) => {
  let target = file
  try { target = fs.realpathSync(file) } catch (e) { if (e.code !== 'ENOENT') throw e }
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const temporary = target + '.' + process.pid + '.' + Math.random().toString(16).slice(2) + '.tmp'
  try { fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, target) }
  finally { try { fs.unlinkSync(temporary) } catch {} }
}
const [cmd, ...args] = process.argv.slice(2)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const night = readNightConfig()
// The host scheduler and explicitly launched CLI clocks share the pause flag.
// Pausing does not erase the saved plan, consume a window, or emit a wake marker.
if (night.enabled === false && (cmd === 'plan' || cmd === 'clock')) {
  console.log(JSON.stringify({ action: 'paused', reason: '生物钟已暂停' }))
  process.exit(0)
}
const gate = () => activityAllowed({ night }, new Date())
if (cmd === 'plan') {
  const g = gate()
  if (!g.allowed) { console.log(JSON.stringify({ action: 'waiting', reason: g.reason })); process.exit(0) }
  const p = makePlan(night, load())
  save(STATE, p)
  console.log(JSON.stringify(p, null, 2))
} else if (cmd === 'mark') {
  save(dataDshPath('whale-wake'), { date: dayOf(), at: new Date().toISOString(), by: 'task' })
  console.log('已留唤醒标记')
} else if (cmd === 'status') {
  // 本机补丁：带上今天实际的醒来上限（maxWakesPerDay 与各窗口次数取小）
  console.log(JSON.stringify({ config: night, maxWakesToday: maxWakes(night), state: load() }, null, 2))
} else if (cmd === 'clock') {
  if (args.includes('--test')) {
    await sleep(Math.max(0, Number(args[args.indexOf('--test') + 1] ?? 5)) * 1000)
    console.log('WHALE_WAKE (test; 不修改正式计划)')
  } else {
    const g = gate()
    if (!g.allowed) { console.log(JSON.stringify({ action: 'waiting', reason: g.reason })); process.exit(0) }
    const p = makePlan(night, load())
    save(STATE, p)
    if (p.action === 'done') console.log('WHALE_DONE ' + p.reason)
    else {
      while (Date.now() < p.atMs) {
        await sleep(Math.min(60000, p.atMs - Date.now()))
        const current = load()
        if (current.fired || current.atMs !== p.atMs || current.action !== p.action) {
          console.log('WHALE_DONE 计划已由宿主处理或更新'); process.exit(0)
        }
      }
      const finalGate = gate()
      if (Date.now() >= p.endsAt) console.log('WHALE_DONE 窗口已结束，不补发过期唤醒')
      else if (!finalGate.allowed) console.log('WHALE_WAIT ' + finalGate.reason)
      else {
        save(STATE, completePlan(p))
        console.log(p.action === 'skip' ? 'WHALE_SKIP ' + p.reason : 'WHALE_WAKE at=' + p.atText)
      }
    }
  }
} else { console.error('用法: night plan | clock [--test 秒] | mark | status'); process.exitCode = 2 }
