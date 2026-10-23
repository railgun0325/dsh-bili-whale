import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {dmReplyPolicy,executeDmReply,previewDmReply} from '../tools/lib/dm-reply-policy.mjs'
const root=fileURLToPath(new URL('../',import.meta.url))
const now=Date.now()
const config=()=>({self:{mid:'111'},owner:{mid:'222'},listen:{dm:true},privateReply:{enabled:true,daily:6,minIntervalSec:180,maxChars:200}})
const inbox=(key='received-1')=>({delivered:[{key,mid:'222',selfMid:'111',ts:Math.floor(now/1000)}]})
const permit=(key='received-1',cfg=config(),at=now)=>dmReplyPolicy(cfg,{replyTo:key,message:'我在呀，今天想看什么？'},inbox(key),at)
const tmp=t=>{const p=fs.mkdtempSync(path.join(os.tmpdir(),'whale-dm-policy-'));t.after(()=>fs.rmSync(p,{recursive:true,force:true}));return p}
test('DM reply requires enabled owner channel, correct self and real incoming receipt',()=>{
  for(const change of [c=>c.privateReply.enabled=false,c=>c.listen.dm=false,c=>c.self.mid='222',c=>c.owner.mid='333',c=>c.self.mid='999']){
    const c=config();change(c);assert.throws(()=>permit('received-1',c))
  }
  assert.throws(()=>dmReplyPolicy(config(),{replyTo:'invented',message:'hi'},inbox()))
  assert.throws(()=>permit('received-1',config(),now+86401000))
})
test('private paths, credentials, links and oversized DMs are blocked',()=>{
  for(const message of ['https://example.com','SESSDATA=secret','/Users/private/file','a'.repeat(201)]) assert.throws(()=>dmReplyPolicy(config(),{replyTo:'received-1',message},inbox()))
})
test('a received message can be sent once; duplicate never invokes send',async t=>{
  const dir=tmp(t);let posts=0;const p=permit()
  assert.equal(previewDmReply(dir,p),true)
  await executeDmReply(dir,p,async()=>{posts++;return {http:200,code:0,data:{msg_key:'sent-1'}}})
  await assert.rejects(executeDmReply(dir,p,async()=>{posts++}))
  assert.equal(posts,1)
})
test('daily cap and minimum interval survive separate executions',async t=>{
  const dir=tmp(t), c=config(); c.privateReply.daily=1
  await executeDmReply(dir,permit('first',c),async()=>({http:200,code:0}))
  assert.throws(()=>previewDmReply(dir,permit('second',c,now+181000)),/额度/)
  c.privateReply.daily=6
  assert.throws(()=>previewDmReply(dir,permit('second',c,now+60000)),/间隔/)
})
test('network rejection or unknown result halts future DM sends',async t=>{
  for(const send of [async()=>({http:200,code:10031}),async()=>{throw Error('timeout')}]){
    const dir=path.join(tmp(t),'case')
    await executeDmReply(dir,permit(),send).catch(()=>{})
    const state=JSON.parse(fs.readFileSync(path.join(dir,'dm-replies.json')))
    assert.ok(state.halted);assert.equal(state.attempts.length,1)
    assert.throws(()=>previewDmReply(dir,permit('second',config(),now+181000)),/暂停/)
  }
})
test('concurrent DM send has one sender; damaged ledger never sends',async t=>{
  const dir=tmp(t);let release,posts=0
  const wait=new Promise(r=>release=r)
  const first=executeDmReply(dir,permit(),async()=>{posts++;await wait;return {http:200,code:0}})
  await assert.rejects(executeDmReply(dir,permit('second'),async()=>{posts++}))
  release();await first;assert.equal(posts,1)
  fs.writeFileSync(path.join(dir,'dm-replies.json'),'{broken')
  assert.throws(()=>previewDmReply(dir,permit('second')),/无法读取/)
})
function cli(t,cfg=config()){
  const home=tmp(t),data=path.join(home,'.bili-ai'),file=path.join(home,'config.json')
  fs.mkdirSync(data);fs.writeFileSync(file,JSON.stringify({...cfg,share:{enabled:false}}))
  fs.writeFileSync(path.join(data,'credentials.json'),JSON.stringify({sessdata:'test-not-real',bili_jct:'a'.repeat(32)}))
  fs.writeFileSync(path.join(data,'dm-await-state.json'),JSON.stringify(inbox()))
  const env={...process.env,HOME:home,USERPROFILE:home,BILI_WHALE_DATA_HOME:home,BILI_WHALE_CONFIG:file,DSH_HOME:path.join(home,'.dsh'),TEST_REQUESTS:path.join(home,'requests.jsonl'),NODE_OPTIONS:'--import='+pathToFileURL(path.join(root,'tests/helpers/mock-fetch.mjs')).href}
  return {env,run:args=>spawnSync(process.execPath,[path.join(root,'tools/commands/dm.mjs'),...args],{env,encoding:'utf8',timeout:10000}),requests:()=>fs.existsSync(env.TEST_REQUESTS)?fs.readFileSync(env.TEST_REQUESTS,'utf8'):''}
}
test('real DM command enforces reply receipt and disabled channel before any network',t=>{
  const h=cli(t);assert.notEqual(h.run(['--msg','hello','--go']).status,0);assert.equal(h.requests(),'')
  const c=config();c.listen.dm=false;const closed=cli(t,c)
  assert.notEqual(closed.run(['--reply-to','received-1','--msg','hi','--go']).status,0);assert.equal(closed.requests(),'')
})
test('real DM command dry-run does not send; go posts exactly once',t=>{
  const h=cli(t),args=['--reply-to','received-1','--msg','我在呀。']
  const dry=h.run([...args,'--dry']);assert.equal(dry.status,0,dry.stderr);assert.doesNotMatch(h.requests(),/POST/)
  const go=h.run([...args,'--go']);assert.equal(go.status,0,go.stderr);assert.equal((h.requests().match(/POST/g)??[]).length,1)
  assert.notEqual(h.run([...args,'--go']).status,0);assert.equal((h.requests().match(/POST/g)??[]).length,1)
})
