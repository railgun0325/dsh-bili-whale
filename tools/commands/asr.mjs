// 离线听写：没有官方字幕的视频，用本机 SenseVoice 把音轨转成文字。
//
// 用法: node asr.mjs <BV> [--seconds 180] [--from 0] [--json] [--keep]
//   例: node asr.mjs BV1fYpn6SEk9 --seconds 60
//
// 依赖: ffmpeg（lib/ffmpeg.mjs 查找）+ python3 + sherpa-onnx + 本机 SenseVoice 模型
//   模型: ~/.dsh/speech-to-text/sensevoice/models/sensevoice-onnx
//   缺依赖时只报错退出，不联网、不写任何外部状态。
//
// 成本：CPU 转写约 1–3 倍实时（60 秒音频约 10–30 秒）；纯本地，不花钱。
import { dataHome } from '../lib/data-home.mjs'
import { dshPath } from '../lib/paths.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { requireFfmpeg } from '../lib/ffmpeg.mjs'

const argv = process.argv.slice(2)
const bvid = argv.find((a) => !a.startsWith('--'))
if (!bvid) { console.error('用法: node asr.mjs <BV> [--seconds 180] [--from 0] [--json] [--keep]'); process.exit(2) }
const opt = {}
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[++i]
}
const seconds = Number(opt.seconds ?? 0)
const from = Number(opt.from ?? 0)
const asJson = !!opt.json
const keep = !!opt.keep

const MODEL_DIR = process.env.SENSEVOICE_DIR
  || dshPath('speech-to-text', 'sensevoice', 'models', 'sensevoice-onnx')   // 运行时资源：跟 DSH home 走（同 ffmpeg），不随数据根
const PY = process.env.PYTHON || 'python3'
const HELPER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'asr_transcribe.py')

let FFMPEG
try { FFMPEG = requireFfmpeg() } catch (e) { console.error(String(e.message)); process.exit(2) }
if (!fs.existsSync(path.join(MODEL_DIR, 'model.int8.onnx'))) {
  console.error(`找不到 SenseVoice 模型：${MODEL_DIR}\n（可用环境变量 SENSEVOICE_DIR 指到别处）`)
  process.exit(2)
}

const cred = JSON.parse(fs.readFileSync(path.join(dataHome(), '.bili-ai', 'credentials.json'), 'utf8'))
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const H = { 'user-agent': UA, referer: 'https://www.bilibili.com/', cookie: `SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}; buvid3=${cred.buvid3}` }
const jget = async (u) => {
  const r = await fetch(u, { headers: H })
  const t = await r.text()
  try { return JSON.parse(t) } catch { return { code: -1, message: `非 JSON（HTTP ${r.status}）`, _nonJson: true } }
}

const view = await jget(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`)
if (view.code !== 0) { console.error(`view 失败 code=${view.code} ${view.message}`); process.exit(3) }
const { aid, cid, title, duration } = view.data
const owner = view.data.owner?.name
console.error(`标题: ${title}`)
console.error(`UP: ${owner}   时长: ${duration}s`)

// ── 取音轨：优先 dash 的纯音频流（小、快），拿不到再退回 durl 的 mp4 ──────────
const pu = await jget(`https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&fnval=16&fnver=0&fourk=1&platform=pc&high_quality=1`)
let audioUrl = ''
let kind = ''
const dash = pu?.data?.dash
if (dash?.audio?.length) {
  const pick = [...dash.audio].sort((a, b) => (a.bandwidth ?? 0) - (b.bandwidth ?? 0))[0]
  audioUrl = pick.baseUrl || pick.base_url || ''
  kind = `dash 音频 ${Math.round((pick.bandwidth ?? 0) / 1000)}kbps`
}
if (!audioUrl) {
  const durl = pu?.data?.durl?.[0]?.url
  if (durl) { audioUrl = durl; kind = 'durl mp4（含画面，转写前抽音轨）' }
}
if (!audioUrl) { console.error(`没拿到音轨（playurl code=${pu?.code} ${pu?.message ?? ''}）`); process.exit(4) }

const dir = path.join(dataHome(), '.dsh', 'audio')
fs.mkdirSync(dir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const rawFile = path.join(dir, `${bvid}-${stamp}.src`)
const wav = path.join(dir, `${bvid}-${stamp}.wav`)

const res = await fetch(audioUrl, { headers: { 'user-agent': UA, referer: `https://www.bilibili.com/video/${bvid}/`, range: 'bytes=0-' } })
if (!res.ok) { console.error(`下载音轨失败 HTTP ${res.status}`); process.exit(5) }
fs.writeFileSync(rawFile, Buffer.from(await res.arrayBuffer()))
console.error(`音轨: ${kind}  ${(fs.statSync(rawFile).size / 1024 / 1024).toFixed(2)} MB`)

const ss = from > 0 ? ['-ss', String(from)] : []
const tt = seconds > 0 ? ['-t', String(seconds)] : []
execFileSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...ss, ...tt, '-i', rawFile,
  '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], { stdio: ['ignore', 'ignore', 'inherit'] })
const dur = seconds > 0 ? Math.min(seconds, duration - from) : duration - from
console.error(`转写中：${dur}s 音频（本机 SenseVoice，约 1–3 倍实时）…`)

const py = spawnSync(PY, [HELPER, wav, MODEL_DIR], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
if (py.status !== 0) {
  console.error(`转写失败（python 退出码 ${py.status}）：${(py.stderr || '').trim().slice(0, 400)}`)
  process.exit(6)
}
const text = String(py.stdout ?? '').trim()
if (!keep) { try { fs.unlinkSync(rawFile) } catch {} ; try { fs.unlinkSync(wav) } catch {} }

if (asJson) {
  console.log(JSON.stringify({ ok: true, bvid, aid, cid, title, up: owner, seconds: dur, from, chars: text.length, text }, null, 2))
} else {
  console.log(`\n══════════ 听写（${from}s 起 ${dur}s，本机 SenseVoice）══════════\n`)
  console.log(text || '（没识别出内容：可能是纯音乐/环境音）')
  console.log(`\n字数 ${text.length}；纯本地转写，无官方字幕时的兜底 ✓`)
}
