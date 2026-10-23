import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const command = fileURLToPath(new URL('../tools/commands/whale-night.mjs', import.meta.url))
function plan({ cap, wakes = [1, 1], time = '12:20', morning = false }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-clock-fixture-'))
  try {
    const configFile = path.join(dir, 'config.json')
    fs.writeFileSync(configFile, JSON.stringify({ night: { enabled: true, offPeakOnly: true, maxWakesPerDay: cap, skipChance: 0, windows: [...(morning ? [{ start: '00:00', end: '08:30', wakes: 1 }] : []), { start: '12:10', end: '13:30', wakes: wakes[0] }, { start: '18:10', end: '24:00', wakes: wakes[1] }] } }))
    fs.writeFileSync(path.join(dir, 'clock.mjs'), `const D=Date; class Fixed extends D{constructor(...args){super(...(args.length?args:[${Date.parse(`2026-10-23T${time}:00+08:00`)}]))} static now(){return ${Date.parse(`2026-10-23T${time}:00+08:00`)}}}; globalThis.Date=Fixed; Math.random=()=>0.5;`)
    const result = spawnSync(process.execPath, ['--import', path.join(dir, 'clock.mjs'), command, 'status'], { encoding: 'utf8', env: { ...process.env, TZ: 'Asia/Shanghai', HOME: dir, USERPROFILE: dir, BILI_WHALE_CONFIG: configFile, BILI_WHALE_DATA_HOME: dir }, timeout: 3000 })
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout).maxWakesToday   // 共享引擎的 status 输出 JSON
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

test('daily wake cap limits a larger sum of per-window allowances', () => {
  assert.equal(plan({ cap: 1 }), 1)
})
test('zero daily cap and zero per-window quotas stay zero', () => {
  assert.equal(plan({ cap: 0 }), 0)
  assert.equal(plan({ cap: 2, wakes: [0, 0] }), 0)
})
test('three saved windows still obey the chosen two-wake daily limit', () => {
  assert.equal(plan({ cap: 2, morning: true }), 2)
})
