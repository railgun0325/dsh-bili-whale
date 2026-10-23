import fs from 'node:fs'
globalThis.fetch=async(url,opts={})=>{
  const u=String(url),method=opts.method??'GET'
  const body=new URLSearchParams(opts.body??'')
  fs.appendFileSync(process.env.TEST_REQUESTS,JSON.stringify({url:u,method,...(method==='POST'?{message:body.get('message')??body.get('msg[content]'),mentions:body.get('at_name_to_mid')}:{} )})+'\n')
  let out
  if(u.includes('/nav'))out={code:0,data:{isLogin:true,mid:Number(process.env.TEST_LOGIN_MID??111),uname:'fish'}}
  else if(u.includes('/fetch_session_msgs'))out={code:0,data:{messages:JSON.parse(fs.readFileSync(process.env.TEST_OWNER_RECORDS,'utf8'))}}
  else if(u.includes('/view?')) {const b=new URL(u).searchParams.get('bvid');out={code:0,data:{bvid:b,aid:b==='BV1234567890'?42:b==='BV2234567890'?43:44}}}
  else if(u.includes('/x/relation'))out={code:0,data:{attribute:6}}
  else if(u.includes('/reply/add'))out={code:Number(process.env.TEST_OWNER_POST_CODE??0),data:{rpid_str:String(9000+fs.readFileSync(process.env.TEST_REQUESTS,'utf8').split('POST').length)}}
  else if(u.includes('/send_msg'))out={code:Number(process.env.TEST_OWNER_POST_CODE??0),data:{msg_key:'777777'}}
  else throw Error('Unexpected network in owner fixture: '+u)
  return {status:200,ok:true,json:async()=>out,text:async()=>JSON.stringify(out)}
}
