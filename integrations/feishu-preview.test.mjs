import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import {normalizeTasks,FeishuCache,createPreviewServer,READ_ARGS} from './feishu-preview.mjs';
const fixture={ok:true,identity:'user',data:{has_more:false,items:[{guid:'later',summary:'稍后任务',completed:false,due:{timestamp:'2000000000000'}},{guid:'first',summary:'<script>仅作为文字</script>',completed:false,due:{timestamp:'1000000000000'}},{guid:'none',summary:'无截止时间',completed:false},{guid:'done',summary:'已完成',completed:true},{guid:'first',summary:'重复',completed:false}]}};
const sleep=()=>new Promise(resolve=>setTimeout(resolve,0));
test('normalize: pending only, deduplicate, due ordering, no token/member leakage',()=>{
 const result=normalizeTasks(fixture);assert.deepEqual(result.items.map(x=>x.id),['first','later','none']);
 assert.equal(result.items[0].title,'<script>仅作为文字</script>');assert.equal(result.items[2].due,null);
 assert.deepEqual(Object.keys(result.items[0]).sort(),['allDay','due','id','title','url']);
 assert.throws(()=>normalizeTasks({...fixture,identity:'bot'}));assert.throws(()=>normalizeTasks({ok:false}));
 assert(READ_ARGS.includes('--complete=false'));assert(READ_ARGS.includes('user'));
});
test('cache: lazy query, 60-second polling, refresh cooldown, auth clears old private data',async()=>{
 let time=1000,calls=0,fail=false;const cache=new FeishuCache({cli:'/fixture',clock:()=>time,reader:async()=>{calls++;if(fail)throw Error('authorization');return normalizeTasks(fixture)}});
 assert.equal(calls,0);cache.refresh();cache.refresh();await sleep();assert.equal(calls,1);assert.equal(cache.snapshot().status,'ready');
 time+=1000;cache.refresh(true);await sleep();assert.equal(calls,1);
 time+=60000;fail=true;cache.refresh();await sleep();assert.equal(cache.snapshot().status,'authorization');assert.deepEqual(cache.snapshot().items,[]);
});
test('HTTP: loopback, token, origin/host, no command input, HTML nonce, no-store',async()=>{
 const port=await new Promise(resolve=>{const probe=net.createServer();probe.listen(0,'127.0.0.1',()=>{const p=probe.address().port;probe.close(()=>resolve(p))})});
 const cache=new FeishuCache({cli:'/fixture',reader:async()=>normalizeTasks(fixture)});const server=createPreviewServer({port,cache});
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));const base='http://127.0.0.1:'+port;
 try{
  const page=await fetch(base);const html=await page.text();const token=html.match(/name="dashboard-token" content="([a-f0-9]{64})"/)[1];
  assert(page.headers.get('content-security-policy').includes("script-src 'nonce-"));assert.equal(page.headers.get('cache-control'),'no-store');assert(html.includes('<script nonce='));
  const navigate=path=>new Promise((resolve,reject)=>{const request=http.get(base+path,{headers:{'X-Dashboard-Token':token,'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document'}},response=>{response.resume();resolve(response.statusCode)});request.on('error',reject)});
  assert.equal(await navigate('/'),200);
  assert.equal(await navigate('/api/daily/config'),403);
  assert.equal((await fetch(base+'/api/feishu/tasks')).status,403);
  assert.equal((await fetch(base+'/api/feishu/tasks',{headers:{'X-Dashboard-Token':token,Origin:'https://example.com'}})).status,403);
  const forgedHostStatus=await new Promise((resolve,reject)=>{
    const request=http.get(base+'/api/feishu/tasks',{headers:{'X-Dashboard-Token':token,Host:'example.com'}},response=>{response.resume();resolve(response.statusCode)});
    request.on('error',reject);
  });
  assert.equal(forgedHostStatus,403);
  const headers={'X-Dashboard-Token':token};await fetch(base+'/api/feishu/tasks',{headers});await sleep();
  const data=await(await fetch(base+'/api/feishu/tasks',{headers})).json();assert.equal(data.status,'ready');assert.equal(data.items.length,3);
  assert.equal((await fetch(base+'/api/feishu/tasks',{method:'POST',headers:{...headers,'Content-Type':'text/plain'},body:'{}'})).status,415);
  assert.equal((await fetch(base+'/api/anything',{headers})).status,404);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
});
test('daily HTTP: protected config, URL validation, saved launch IDs and sanitized command failures',async()=>{
 const {DailyStore,DailyServices,defaults}=await import('./daily-services.mjs');const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const folder=await mkdtemp(join(tmpdir(),'focus-daily-http-'));let calls=0;
 const daily=new DailyServices({store:new DailyStore({file:join(folder,'daily.json')}),run:async()=>{calls++;throw Object.assign(Error('Command failed: /private/local-detail'),{cmd:'/private/local-detail'})}});
 const port=await new Promise(resolve=>{const probe=net.createServer();probe.listen(0,'127.0.0.1',()=>{const p=probe.address().port;probe.close(()=>resolve(p))})});const server=createPreviewServer({port,daily});await new Promise(r=>server.listen(port,'127.0.0.1',r));const base='http://127.0.0.1:'+port;
 try{const html=await(await fetch(base)).text();const token=html.match(/name="dashboard-token" content="([a-f0-9]{64})"/)[1];const headers={'X-Dashboard-Token':token,'Content-Type':'application/json'};
 assert.equal((await fetch(base+'/api/daily/config')).status,403);assert.equal((await fetch(base+'/api/daily/launch',{method:'POST',headers:{...headers,Origin:'https://example.com'},body:'{"id":"notes"}'})).status,403);assert.equal(calls,0);
 const config=defaults();config.launchers=[{id:'site',name:'示例',type:'url',target:'file:///private/file'}];assert.equal((await fetch(base+'/api/daily/config',{method:'PUT',headers,body:JSON.stringify(config)})).status,400);
 config.launchers[0].target='https://example.com';assert.equal((await fetch(base+'/api/daily/config',{method:'PUT',headers,body:JSON.stringify(config)})).status,200);const saved=await(await fetch(base+'/api/daily/config',{headers})).json();assert.equal(saved.config.launchers[0].target,'https://example.com');
 assert.equal((await fetch(base+'/api/daily/launch',{method:'POST',headers,body:'{"id":"arbitrary"}'})).status,400);assert.equal(calls,0);
 const failed=await(await fetch(base+'/api/daily/launch',{method:'POST',headers,body:'{"id":"site"}'})).json();assert.equal(calls,1);assert.equal(failed.error,'系统操作暂时不可用');assert(!JSON.stringify(failed).includes('/private'));
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(folder,{recursive:true,force:true})}
});
