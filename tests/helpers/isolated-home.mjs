// 本机补丁：在进程内加载插件模块的测试，必须先把 HOME 指到临时目录再 import ——
// paths.mjs / bili-api.mjs 在加载时就按 HOME 算数据路径（silence-seen.json、接口缓存等），
// 否则测试会写进真实的 ~/.bili-ai。作为第一个 import，它先于被测模块求值。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-whale-test-home-'))
fs.mkdirSync(path.join(home, '.bili-ai'), { recursive: true })
for (const key of ['BILI_WHALE_DATA_HOME', 'BILI_WHALE_CONFIG', 'DSH_HOME']) delete process.env[key]
process.env.HOME = home
process.env.USERPROFILE = home
process.on('exit', () => { try { fs.rmSync(home, { recursive: true, force: true }) } catch {} })
