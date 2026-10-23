import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const day = at => new Date(at).toLocaleDateString('sv-SE', {timeZone:'Asia/Shanghai'})
export function dmReplyPolicy(cfg, request, inbox, now = Date.now()) {
  const p = cfg.privateReply
  if (!p || p.enabled !== true || cfg.listen?.dm !== true) throw Error('主人私信自动回复已关闭')
  const self = String(cfg.self?.mid ?? ''), owner = String(cfg.owner?.mid ?? '')
  if (!/^\d+$/.test(self) || !/^\d+$/.test(owner) || self === owner) throw Error('私信账号身份配置无效')
  const key = String(request.replyTo ?? '')
  const receipts = [...(inbox.delivered ?? []), ...(inbox.pending ? [inbox.pending] : [])]
  const incoming = receipts.find(x => String(x.key) === key && String(x.mid) === owner && String(x.selfMid) === self)
  if (!key || !incoming || !Number.isFinite(Number(incoming.ts)) || now - Number(incoming.ts)*1000 > 86400000 || Number(incoming.ts)*1000 > now + 60000) throw Error('只能回复最近一天已收到的主人私信；缺少有效 --reply-to')
  const text = String(request.message ?? '').trim().normalize('NFKC').replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
  const daily = Math.min(6, Math.max(0, Math.floor(Number(p.daily) || 0)))
  const interval = Math.max(120, Number(p.minIntervalSec) || 180)
  const chars = Math.min(200, Math.max(1, Number(p.maxChars) || 200))
  if (!text || [...text].length > chars) throw Error(`私信正文必须为1–${chars}字`)
  if (/(?:https?:\/\/|www\.|SESSDATA|bili_jct|buvid3|authorization\s*[:=]|bearer\s+|api[-_ ]?key|cookie\s*[:=]|(?:access|refresh)[_-]?token|\b(?:token|password)\s*[:=]|sk-[a-z0-9_-]{8,}|\/Users\/|\/home\/|\/private\/|~\/\.|\.bili-ai\b|\.dsh\b)/i.test(text)) throw Error('私信正文含网址、凭据或私人路径，已阻止')
  return {self, owner, key, daily, interval, chars, at:now, day:day(now)}
}
const atomic = (file, value) => {
  const temporary = file+'.'+crypto.randomUUID()+'.tmp'
  try { fs.writeFileSync(temporary, JSON.stringify(value,null,2)+'\n', {flag:'wx',mode:0o600}); fs.renameSync(temporary,file) }
  finally { fs.rmSync(temporary,{force:true}) }
}
export function readDmLedger(dir) {
  let state
  try { state = JSON.parse(fs.readFileSync(path.join(dir,'dm-replies.json'),'utf8')) }
  catch(e) { if(e.code==='ENOENT') return {version:1,attempts:[],halted:null}; throw Error('私信发送账本无法读取，拒绝发送') }
  if(state?.version !== 1 || !Array.isArray(state.attempts) || !('halted' in state) || state.attempts.some(x=>!x || !Number.isFinite(Date.parse(x.at)) || !['reserved','success','failed','unknown'].includes(x.status) || typeof x.key!=='string' || typeof x.self!=='string' || typeof x.owner!=='string')) throw Error('私信发送账本损坏，拒绝发送')
  return state
}
function check(state,p) {
  if(state.halted) throw Error('私信发送已暂停，须人工检查：'+state.halted.reason)
  if(state.attempts.some(x=>x.status==='reserved')) throw Error('存在未确认私信发送，不重复发送')
  const mine=state.attempts.filter(x=>x.self===p.self && x.owner===p.owner)
  if(mine.some(x=>x.key===p.key)) throw Error('这条主人私信已经尝试回复，不重复发送')
  if(mine.filter(x=>day(x.at)===p.day).length>=p.daily) throw Error('主人私信每日回复额度已用完')
  if(mine.some(x=>p.at-Date.parse(x.at)<p.interval*1000)) throw Error('主人私信回复间隔不足')
}
export function previewDmReply(dir,p) { const s=readDmLedger(dir); if(fs.existsSync(path.join(dir,'dm-replies.lock'))) throw Error('私信发送锁存在，拒绝并发'); check(s,p); return true }
export async function executeDmReply(dir,p,send) {
  fs.mkdirSync(dir,{recursive:true,mode:0o700})
  const lock=path.join(dir,'dm-replies.lock'), file=path.join(dir,'dm-replies.json')
  let fd
  try { fd=fs.openSync(lock,'wx',0o600) } catch { throw Error('私信发送锁存在，拒绝并发') }
  let release=true
  try {
    const state=readDmLedger(dir); check(state,p)
    const attempt={self:p.self,owner:p.owner,key:p.key,at:new Date(p.at).toISOString(),status:'reserved'}
    state.attempts.push(attempt); atomic(file,state)
    let result, uncertain
    try {
      result=await send()
      if(!result || !Number.isInteger(result.http) || !Number.isInteger(result.code)) throw Error('私信发送结果未知')
      attempt.status=result.http>=200 && result.http<300 && result.code===0?'success':'failed'
      attempt.http=result.http; attempt.code=result.code
      if(result.data?.msg_key) attempt.msgKey=String(result.data.msg_key)
      if(attempt.status!=='success') state.halted={at:new Date().toISOString(),reason:`HTTP ${result.http} code ${result.code}，停止自动重试`}
    } catch(e) { uncertain=e; attempt.status='unknown'; state.halted={at:new Date().toISOString(),reason:'发送结果未知，禁止自动重发'} }
    try { atomic(file,state) } catch(e) { release=false; throw e }
    if(uncertain) throw uncertain
    return result
  } finally { fs.closeSync(fd); if(release) fs.unlinkSync(lock) }
}
