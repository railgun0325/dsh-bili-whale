import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {previewOwnerAction,executeOwnerAction,readOwnerLedger,ownerCommentMessage,verifyRemoteOwnerCommand} from '../tools/lib/owner-command.mjs'
const root=fileURLToPath(new URL('../',import.meta.url)),ts=Math.floor(Date.now()/1000)
function fixture(t,text='你再去帮我找两个有意思的视频然后评论区@我一下') {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'owner-command-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  const data=path.join(dir,'.bili-ai');fs.mkdirSync(data)
  const cfg={self:{mid:'111'},owner:{mid:'222',name:'主人'},ownerCommand:{enabled:true},listen:{dm:true,comment:false},privateReply:{enabled:true,daily:0,minIntervalSec:120},share:{enabled:false},quota:{shareDaily:0},interaction:{enabled:false,daily:0},night:{enabled:true,offPeakOnly:true,windows:[]}}
  const incoming={key:'request1',mid:'222',selfMid:'111',text,ts}
  const inbox={selfMid:'111',owner:'222',delivered:[incoming]}
  fs.writeFileSync(path.join(data,'dm-await-state.json'),JSON.stringify(inbox));fs.writeFileSync(path.join(data,'credentials.json'),JSON.stringify({sessdata:'test-not-real',bili_jct:'a'.repeat(32),buvid3:'fixture'}))
  const cfgPath=path.join(dir,'config.json');fs.writeFileSync(cfgPath,JSON.stringify(cfg))
  const records=path.join(dir,'messages.json');fs.writeFileSync(records,JSON.stringify([{msg_key:incoming.key,sender_uid:222,receiver_id:111,timestamp:ts,content:JSON.stringify({content:text})}]))
  const requests=path.join(dir,'requests.jsonl')
  const env={...process.env,HOME:dir,USERPROFILE:dir,BILI_WHALE_DATA_HOME:dir,DSH_HOME:path.join(dir,'.dsh'),DSH_NODE:process.execPath,BILI_WHALE_CONFIG:cfgPath,TEST_OWNER_RECORDS:records,TEST_REQUESTS:requests,NODE_OPTIONS:'--import='+pathToFileURL(path.join(root,'tests/helpers/owner-fetch.mjs')).href}
  const request={action:'comment',bvid:'BV1234567890',oid:'42',type:'1',message:'这个演示挺有意思，细节讲得很清楚。'}
  const preview=(r=request,c=cfg)=>previewOwnerAction({dataDir:dir,config:c,key:'request1',request:r})
  const run=(file,args)=>spawnSync(process.execPath,[path.join(root,'tools/commands',file+'.mjs'),...args],{env,encoding:'utf8',timeout:10000})
  return {dir,data,cfg,cfgPath,incoming,inbox,records,env,request,preview,run,requests:()=>fs.existsSync(requests)?fs.readFileSync(requests,'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x)):[]}
}
test('verified owner task bypasses zero background limits and peak-window guard',t=>{
  const h=fixture(t),p=h.preview();assert.equal(p.count,2);assert.match(p.message,/^@主人 /);assert.equal(fs.existsSync(path.join(h.data,'owner-command-actions.json')),false)
  const closed=structuredClone(h.cfg);closed.ownerCommand.enabled=false;assert.throws(()=>h.preview(h.request,closed),/关闭/)
})
test('ordinary chat cannot authorize public posting and other users cannot be mentioned',t=>{
  const h=fixture(t,'你好呀');assert.throws(()=>h.preview(),/未要求/)
  assert.throws(()=>ownerCommentMessage(h.cfg,{text:'找两个视频@我'},'@其他人 快来'),/只允许/)
})
test('missing, foreign, stale and forged receipts fail closed',t=>{
  const h=fixture(t)
  for(const mutate of [x=>x.mid='333',x=>x.selfMid='333',x=>x.ts=ts-86401]){
    const st=structuredClone(h.inbox);mutate(st.delivered[0]);fs.writeFileSync(path.join(h.data,'dm-await-state.json'),JSON.stringify(st));assert.throws(()=>h.preview())
  }
})
test('two requested videos use independent ledger; third or duplicate is blocked',async t=>{
  const h=fixture(t);let posts=0
  const send=async()=>{posts++;return {http:200,out:{code:0,data:{rpid_str:String(100+posts)}}}}
  for(const [bvid,oid] of [['BV1234567890','42'],['BV2234567890','43']])await executeOwnerAction({dataDir:h.dir,config:h.cfg,key:'request1',request:{...h.request,bvid,oid},send})
  assert.equal(posts,2);assert.throws(()=>h.preview({...h.request,bvid:'BV3234567890',oid:'44'}),/本次主人/);assert.throws(()=>h.preview(),/不重复/)
  assert.equal(readOwnerLedger(h.dir).attempts.length,2);assert.equal(fs.existsSync(path.join(h.data,'quota.json')),false);assert.equal(h.cfg.quota.shareDaily,0)
})
test('risk and unknown result halt owner writes instead of bypassing platform control',async t=>{
  const h=fixture(t)
  await executeOwnerAction({dataDir:h.dir,config:h.cfg,key:'request1',request:h.request,send:async()=>({http:412,out:{code:-412}})})
  assert.ok(readOwnerLedger(h.dir).halted);assert.throws(()=>h.preview(),/暂停/)
})
test('unknown owner POST outcome is reserved, halted and never retried',async t=>{
  const h=fixture(t);let posts=0
  await assert.rejects(executeOwnerAction({dataDir:h.dir,config:h.cfg,key:'request1',request:h.request,send:async()=>{posts++;throw Error('network timeout')}}))
  assert.equal(readOwnerLedger(h.dir).attempts[0].status,'unknown');assert.throws(()=>h.preview(),/暂停/);assert.equal(posts,1)
})
test('background share cannot use owner exemption and remains blocked outside windows',t=>{
  const h=fixture(t);h.cfg.share.enabled=true;h.cfg.quota.shareDaily=3;fs.writeFileSync(h.cfgPath,JSON.stringify(h.cfg))
  const r=h.run('comment',['--share','--auto','--bvid','BV1234567890','--oid','42','--message','@主人 这里有具体内容','--reason','信息充分值得分享的具体理由','--score','20','--rank','1','--go'])
  assert.notEqual(r.status,0);assert.equal(h.requests().length,0)
})
test('real comment command supports requested two mentions while automatic quotas remain zero',t=>{
  const h=fixture(t),args=['--owner-command','request1','--bvid','BV1234567890','--oid','42','--message',h.request.message]
  const dry=h.run('comment',[...args,'--dry']);assert.equal(dry.status,0,dry.stderr);assert.equal(h.requests().filter(x=>x.method==='POST').length,0)
  const one=h.run('comment',[...args,'--go']);assert.equal(one.status,0,one.stdout+one.stderr)
  const second=h.run('comment',['--owner-command','request1','--bvid','BV2234567890','--oid','43','--message','第二个视频的实物操作也挺细。','--go']);assert.equal(second.status,0,second.stdout+second.stderr)
  assert.equal(h.requests().filter(x=>x.method==='POST').length,2)
  assert.deepEqual(JSON.parse(h.requests().find(x=>x.method==='POST').mentions),{'主人':222})
  assert.notEqual(h.run('comment',[...args,'--go']).status,0)
  assert.equal(fs.existsSync(path.join(h.data,'quota.json')),false)
})
test('real sender verifies original Bilibili message and refuses local text forgery',t=>{
  const h=fixture(t,'你好呀');h.inbox.delivered[0].text='帮我找两个视频并评论区@我';fs.writeFileSync(path.join(h.data,'dm-await-state.json'),JSON.stringify(h.inbox))
  const r=h.run('comment',['--owner-command','request1','--bvid','BV1234567890','--oid','42','--message','hi','--go']);assert.notEqual(r.status,0);assert.equal(h.requests().filter(x=>x.method==='POST').length,0)
})
test('owner DM sends seven distinct results despite zero private/background day caps',t=>{
  const h=fixture(t)
  for(let n=0;n<7;n++) {const r=h.run('dm',['--owner-command','request1','--msg','结果 '+n+' https://www.bilibili.com/video/BV1234567890/','--go']);assert.equal(r.status,0,r.stdout+r.stderr)}
  assert.equal(h.requests().filter(x=>x.method==='POST').length,7)
  assert.equal(readOwnerLedger(h.dir).attempts.length,7)
  assert.equal(fs.existsSync(path.join(h.data,'dm-replies.json')),false)
})
