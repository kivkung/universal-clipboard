import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PNG } from 'pngjs';
import { Hub } from '../../src/hub.js';
import { Client } from '../../src/client.js';
import { hashText } from '../../src/protocol.js';
const dir=path.resolve('build/interop');fs.mkdirSync(dir,{recursive:true});
const records=[];
const record=data=>{records.push(data);fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify(records,null,2));};
const hub=new Hub({state:{deviceId:'test-host-endpoint',name:'My Windows PC',pin:'123456'},port:33030,discoveryPort:false,bind:'127.0.0.1'});
await hub.start();
function endpoint(id){let current;return new Client({host:'127.0.0.1',port:33030,pin:'123456',id,name:id==='test-host-endpoint'?'My Windows PC':'Other device',dir:path.join(dir,id),receiveDir:path.join(dir,id,'received'),clipboard:{
  async write(item){current=item;record({recipient:id,kind:item.kind,text:item.text,file:item.path});},
  async read(){return current?.kind==='text'?{...current,hash:hashText(current.text)}:null;}
}});}
const host=endpoint('test-host-endpoint'),other=endpoint('other-endpoint');await host.connect();await other.connect();
const dropped=new Set();const handle=host.store.handle.bind(host.store);
host.store.handle=async(body,from)=>{const result=await handle(body,from);if(!dropped.has(body.transferId)&&from==='android-wire-test'&&body.type==='file.chunk'){dropped.add(body.transferId);record({event:'forced-disconnect',offset:result.offset});hub.sessions.get(from)?.socket.destroy();}return result;};
console.log('TEST HOST READY 33030');
const fixture=path.join(dir,'receive-fixture.png');
const png=new PNG({width:512,height:512});crypto.randomFillSync(png.data);fs.writeFileSync(fixture,PNG.sync.write(png));
const ordinaryHandle=host.handle.bind(host);
host.handle=async b=>{
  if(b.type!=='test.receive')return ordinaryHandle(b);
  // Do not block the TCP read queue while awaiting the recipient's reply.
  (async()=>{
    let result;
    if(b.mode==='text')result=await host.push('รับจาก Host อัตโนมัติ ✓',b.target);
    else if(b.mode==='other'){
      let rejected=false;try{await other.push('must not be applied',b.target);}catch{rejected=true;}result={rejected};
    }else if(b.mode==='bad-hash'){
      let rejected=false;try{await host.request({type:'clipboard.text',to:b.target,text:'bad',hash:'0'.repeat(64)});}catch{rejected=true;}result={rejected};
    }else if(b.mode==='image')result=await host.sendFile(fixture,b.target,'image');
    else if(b.mode==='resume'){
      const bytes=fs.readFileSync(fixture),job={file:fixture,to:b.target,name:'receive-fixture.png',size:bytes.length,hash:crypto.createHash('sha256').update(bytes).digest('hex'),kind:'image',transferId:crypto.randomBytes(32).toString('hex')};
      await host.request({...job,file:undefined,type:'file.offer'});
      await host.request({type:'file.chunk',to:b.target,transferId:job.transferId,offset:0,sequence:0,data:bytes.subarray(0,65536).toString('base64')});
      hub.sessions.get(b.target)?.socket.destroy();
      await new Promise(r=>setTimeout(r,500));
      for(let i=0;i<100&&!hub.sessions.has(b.target);i++)await new Promise(r=>setTimeout(r,100));
      result=await host.runJob(job);record({event:'android-receive-resume',resumedBytes:result.resumedBytes});
    }else throw Error('Unknown test mode');
    if(Array.isArray(result)&&result.some(x=>x.error||x.clipboardError))throw Error(JSON.stringify(result));
    await host.send({type:'reply',to:b.from,replyTo:b.requestId,result:{value:result}});
  })().catch(e=>host.send({type:'reply',to:b.from,replyTo:b.requestId,error:e.message}).catch(()=>{}));
};
process.on('SIGINT',async()=>{await host.close();await other.close();await hub.close();process.exit();});
