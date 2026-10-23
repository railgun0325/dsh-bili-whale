import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export const ownerCommandsEnabled = cfg => cfg?.ownerCommand?.enabled === true
const bv = value => /^BV[0-9A-Za-z]{10}$/.test(String(value))
const id = value => /^[1-9]\d*$/.test(String(value))
const clean = text => String(text??'').normalize('NFKC').replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g,'')
export function safeOwnerText(text) {
  const value=clean(text).trim()
  if(!value || [...value].length>1000) throw Error('单条正文需为1–1000字；长结果分条发送')
  if(/(?:SESSDATA|bili_jct|buvid3|authorization\s*[:=]|bearer\s+|api[-_ ]?key|cookie\s*[:=]|(?:access|refresh)[_-]?token|\b(?:token|password)\s*[:=]|sk-[a-z0-9_-]{8,}|\/Users\/|\/home\/|\/private\/|~\/\.|\.bili-ai\b|\.dsh\b)/i.test(value)) throw Error('正文含凭据或私人路径，拒绝发送')
  return value
}
export function receivedOwnerCommand(dataDir,cfg,key,now=Date.now()) {
  if(!ownerCommandsEnabled(cfg) || cfg.listen?.dm!==true || cfg.privateReply?.enabled!==true) throw Error('主人指令通道已关闭')
  const self=String(cfg.self?.mid??''),owner=String(cfg.owner?.mid??'')
  if(!id(self)||!id(owner)||self===owner) throw Error('主人指令账号配置无效')
  let inbox
  try {inbox=JSON.parse(fs.readFileSync(path.join(dataDir,'.bili-ai/dm-await-state.json'),'utf8'))} catch {throw Error('无法核实主人来信记录')}
  const incoming=[...(inbox.delivered??[]),...(inbox.pending?[inbox.pending]:[])].find(x=>String(x.key)===String(key) && String(x.mid)===owner && String(x.selfMid)===self)
  if(!incoming || typeof incoming.text!=='string' || !Number.isFinite(Number(incoming.ts)) || now-Number(incoming.ts)*1000>86400000 || Number(incoming.ts)*1000>now+60000) throw Error('缺少最近一天真实主人来信；不能用昵称或网友内容授权')
  return {...incoming,self,owner,key:String(key)}
}
function taskSize(text) {
  const nums={'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10}
  const match=String(text).match(/([1-9]\d*|[一二两三四五六七八九十])\s*(?:个|条|部|则|段)(?:[\s\S]{0,30})(?:视频|推荐|分享|评论|@|艾特)/)
  return match ? Number(nums[match[1]]??match[1]) : null
}
export function ownerCommentMessage(cfg,incoming,text) {
  const task=clean(incoming.text)
  if(!/(?:评论|留言|回复|@我|艾特我|at我)/i.test(task) || /(?:不要|别|不许|禁止)\s*(?:再)?\s*(?:发)?\s*(?:评论|留言|回复|@|艾特)/.test(task)) throw Error('该条主人私信未要求公开评论或@')
  let message=safeOwnerText(text)
  const mention=/(?:@我|艾特我|at我)/i.test(task) || task.includes('@'+String(cfg.owner?.name??''))
  if(mention && !String(cfg.owner?.name??'').trim())throw Error('@主人需要有效昵称')
  if(mention && !message.startsWith('@'+cfg.owner?.name)) {
    if(message.includes('@')) throw Error('主人任务只允许@配置中的主人')
    message='@'+cfg.owner.name+' '+message
  }
  const rest=message.startsWith('@'+cfg.owner?.name)?message.slice(('@'+cfg.owner.name).length):message
  if(rest.includes('@') || (!mention&&message.includes('@'))) throw Error('不能将主人授权扩大成@其他账号')
  return safeOwnerText(message)
}
export async function verifyRemoteOwnerCommand(incoming,headers) {
  const u='https://api.vc.bilibili.com/svr_sync/v1/svr_sync/fetch_session_msgs?talker_id='+incoming.owner+'&session_type=1&size=100&mobi_app=web'
  const r=await fetch(u,{headers,signal:AbortSignal.timeout(15000),redirect:'error'})
  const j=await r.json()
  if(j.code!==0)throw Error('无法从B站核实主人指令：code='+j.code)
  const real=(j.data?.messages??[]).find(x=>String(x.msg_key??x.msg_seqno)===incoming.key && String(x.sender_uid)===incoming.owner && String(x.receiver_id)===incoming.self)
  let text
  try{text=JSON.parse(real?.content).content}catch{text=real?.content}
  if(!real || typeof text!=='string' || text!==incoming.text)throw Error('主人来信与B站原始消息不一致，拒绝授权')
  return true
}
const names=dir=>({directory:path.join(dir,'.bili-ai'),file:path.join(dir,'.bili-ai/owner-command-actions.json'),lock:path.join(dir,'.bili-ai/owner-command-actions.lock')})
export function readOwnerLedger(dir) {
  let state
  try {state=JSON.parse(fs.readFileSync(names(dir).file,'utf8'))}catch(e){if(e.code==='ENOENT')return {version:1,attempts:[],halted:null};throw Error('主人指令账本无法读取，停止发送')}
  if(state?.version!==1 || !Array.isArray(state.attempts) || !('halted'in state) || state.attempts.some(x=>!x||!['comment','dm'].includes(x.action)||!['reserved','success','failed','unknown'].includes(x.status)||!Number.isFinite(Date.parse(x.at))||typeof x.key!=='string'||typeof x.fingerprint!=='string'))throw Error('主人指令账本损坏，停止发送')
  return state
}
export function assertOwnerSafety(dir,cfg) {
  const s=readOwnerLedger(dir)
  if(s.halted && (!s.halted.self || s.halted.self===String(cfg.self?.mid)))throw Error('账号写操作已暂停：'+s.halted.reason)
  for(const name of ['interaction.json','dm-replies.json']) {
    let old
    try{old=JSON.parse(fs.readFileSync(path.join(dir,'.bili-ai',name),'utf8'))}catch(e){if(e.code==='ENOENT')continue;throw Error('已有发送账本无法读取，停止写操作')}
    if(old?.halted)throw Error('已有账号风控/未知发送结果尚未解除：'+old.halted.reason)
  }
  return s
}
function prepare(dir,cfg,key,request,now) {
  const incoming=receivedOwnerCommand(dir,cfg,key,now)
  const {action}=request
  if(!['dm','comment'].includes(action))throw Error('主人通道仅开放当前工具支持的私信与视频评论')
  const message=action==='comment'?ownerCommentMessage(cfg,incoming,request.message):safeOwnerText(request.message)
  if(action==='comment' && (!bv(request.bvid)||!id(request.oid)||String(request.type??'1')!=='1'))throw Error('主人评论需要合法视频BV、oid和type=1')
  if(action==='comment' && Boolean(request.root)!==Boolean(request.parent))throw Error('楼中楼回复须同时提供root和parent')
  const target=action==='comment'?[request.oid,request.root??'',request.parent??''].join(':'):incoming.owner
  const fingerprint=crypto.createHash('sha256').update([action,target,message].join('\0')).digest('hex')
  return {self:incoming.self,owner:incoming.owner,key:incoming.key,action,target,bvid:request.bvid??'',message,fingerprint,count:taskSize(incoming.text),at:new Date(now).toISOString()}
}
function check(state,p) {
  if(state.halted && (!state.halted.self||state.halted.self===p.self))throw Error('主人指令发送已暂停：'+state.halted.reason)
  if(state.attempts.some(x=>x.status==='reserved'))throw Error('存在未确认的主人指令发送，先人工回读')
  const mine=state.attempts.filter(x=>x.self===p.self && x.owner===p.owner && x.key===p.key)
  if(mine.some(x=>x.fingerprint===p.fingerprint || (p.action==='comment'&&x.action==='comment'&&x.target===p.target)))throw Error('本次主人任务已尝试发送该条内容或同一视频评论，不重复发送')
  if(p.action==='comment' && p.count!==null && mine.filter(x=>x.action==='comment').length>=p.count)throw Error('本次主人明确要求的评论数量已经完成；这不是每日后台额度')
}
export function previewOwnerAction({dataDir,config,key,request,now=Date.now()}) {
  const p=prepare(dataDir,config,key,request,now),n=names(dataDir)
  if(fs.existsSync(n.lock))throw Error('主人指令发送锁存在，拒绝并发')
  check(assertOwnerSafety(dataDir,config),p)
  return p
}
function save(file,state) {
  const temp=file+'.'+crypto.randomUUID()+'.tmp'
  try {fs.writeFileSync(temp,JSON.stringify(state,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(temp,file)}finally{fs.rmSync(temp,{force:true})}
}
export async function executeOwnerAction({dataDir,config,key,request,send,now=Date.now()}) {
  const p=prepare(dataDir,config,key,request,now),n=names(dataDir)
  fs.mkdirSync(n.directory,{recursive:true,mode:0o700})
  let fd;try{fd=fs.openSync(n.lock,'wx',0o600)}catch{throw Error('主人指令发送锁存在，拒绝并发')}
  let release=true
  try {
    const state=assertOwnerSafety(dataDir,config);check(state,p)
    const attempt={...p,status:'reserved'};delete attempt.message;delete attempt.count
    state.attempts.push(attempt);save(n.file,state)
    let result,unknown
    try {
      result=await send();const out=result?.out??result
      if(!Number.isInteger(result?.http)||!Number.isInteger(out?.code))throw Error('发送结果未知')
      if(p.action==='comment'&&out.code===0&&!id(out.data?.rpid_str??out.data?.rpid))throw Error('评论响应缺少rpid')
      attempt.status=result.http>=200&&result.http<300&&out.code===0?'success':'failed';attempt.http=result.http;attempt.code=out.code
      if(out.data?.rpid_str??out.data?.rpid)attempt.rpid=String(out.data.rpid_str??out.data.rpid)
      if(out.data?.msg_key)attempt.msgKey=String(out.data.msg_key)
      if(attempt.status!=='success')state.halted={self:p.self,at:new Date().toISOString(),reason:`HTTP ${result.http} code ${out.code}，停止自动重试`}
    }catch(e){unknown=e;attempt.status='unknown';state.halted={self:p.self,at:new Date().toISOString(),reason:'发送结果未知，禁止自动重发'}}
    try{save(n.file,state)}catch(e){release=false;throw e}
    if(unknown)throw unknown
    return result
  }finally{fs.closeSync(fd);if(release)fs.unlinkSync(n.lock)}
}
