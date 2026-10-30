const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const {spawn} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = process.env.FOCUS_TEST_OUTPUT || path.join(root, '.test-results');
fs.mkdirSync(output, {recursive:true});
let app, browser, temporary;
async function start(port) {
 app=spawn(path.join(root, 'build/Star Mini Screen.app/Contents/MacOS/StarMiniScreen'), ['--headless','--deny-calendar-requests','--port',String(port),'--data-dir',temporary], {stdio:'ignore'});
 for(let i=0;i<100;i++) { try {if((await fetch(`http://127.0.0.1:${port}/`)).ok)return;}catch{} await new Promise(r=>setTimeout(r,100)); }
 throw Error('Server did not start');
}
async function stop(){if(app && app.exitCode===null){const process=app;await new Promise(resolve=>{process.once('exit',resolve);process.kill('SIGTERM')});}app=null;}
(async()=>{
 const port=await new Promise(resolve=>{const probe=net.createServer();probe.listen(0,'127.0.0.1',()=>{const port=probe.address().port;probe.close(()=>resolve(port));});});
 temporary=fs.mkdtempSync(path.join(os.tmpdir(),'focus-display-browser-'));
 await start(port);
 const chrome=process.env.BROWSER_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 browser=await chromium.launch({headless:true,...(fs.existsSync(chrome)?{executablePath:chrome}:{})});
 const results={browser:browser.version(),viewports:[],checks:[],consoleErrors:[],expectedRecovery403:0};
 let recovering=false;
 const page=await browser.newPage({viewport:{width:1024,height:600},deviceScaleFactor:1});
 page.on('pageerror',e=>results.consoleErrors.push(e.message));
 page.on('console',m=>{if(m.type()==='error' && !(recovering && m.text().includes('status of 403')))results.consoleErrors.push(m.text())});
 page.on('response',r=>{if(recovering && r.status()===403)results.expectedRecovery403++});
 await page.goto(`http://127.0.0.1:${port}/`);
 await page.waitForFunction(()=>document.getElementById('connection-status').textContent==='本机连接正常');
 await page.locator('#task-0').fill('完成今天最重要的方案');
 await page.locator('#task-0').press('Enter');
 await page.waitForTimeout(700);
 await page.locator('#task-1').fill('留出一段不被打断的时间');
 await page.locator('#task-1').press('Enter');
 await page.waitForTimeout(700);
 await page.locator('#task-2').fill('整理工作，轻松收尾');
 await page.locator('#task-2').press('Enter');
 await page.waitForTimeout(700);
 await page.locator('#done-0').check();
 await page.waitForTimeout(700);
 await page.reload();
 await page.waitForFunction(()=>document.getElementById('task-0').value==='完成今天最重要的方案');
 assert(await page.locator('#done-0').isChecked()); results.checks.push('tasks and checkbox survive reload');
 await page.locator('#timer-toggle').click();
 await page.waitForTimeout(2300);
 assert.equal(await page.locator('#timer-toggle').textContent(),'暂停');
 assert.notEqual(await page.locator('#timer-digits').textContent(),'25:00');
 await page.reload(); await page.waitForFunction(()=>document.getElementById('timer-toggle').textContent==='暂停');
 results.checks.push('running countdown survives reload');
 await page.locator('#timer-toggle').click(); await page.waitForTimeout(300);
 const paused=await page.locator('#timer-digits').textContent(); await page.waitForTimeout(1500);
 assert.equal(await page.locator('#timer-digits').textContent(),paused); results.checks.push('paused countdown remains stable');
 await page.locator('[data-mode="short"]').click(); await page.waitForFunction(()=>document.getElementById('timer-digits').textContent==='05:00');
 await page.locator('[data-mode="focus"]').click(); await page.waitForFunction(()=>document.getElementById('timer-digits').textContent==='25:00');
 results.checks.push('short break and focus mode switching');
 await page.locator('#settings-open').click(); await page.locator('#pref-focus').fill('30');
 await page.locator('.settings-save').click(); await page.waitForTimeout(300);
 await page.reload(); await page.waitForFunction(()=>document.getElementById('connection-status').textContent==='本机连接正常');
 await page.locator('#settings-open').click(); assert.equal(await page.locator('#pref-focus').inputValue(),'30');
 await page.locator('#pref-focus').fill('25'); await page.locator('.settings-save').click();
 await page.waitForFunction(()=>!document.getElementById('settings').open);
 results.checks.push('preferences persist after reload');
 recovering=true;
 await stop(); await start(port);
 await page.waitForFunction(()=>document.getElementById('connection-status').textContent==='本机连接正常');
 await page.locator('#timer-toggle').click();
 await page.waitForFunction(()=>document.getElementById('timer-toggle').textContent==='暂停');
 await page.locator('#timer-toggle').click();
 await page.waitForFunction(()=>document.getElementById('timer-toggle').textContent==='开始专注');
 assert(results.expectedRecovery403>=1); recovering=false;
 results.checks.push('browser renews session token after backend restart');
 await page.waitForTimeout(7000);
 for(const [width,height] of [[1024,600],[1280,800]]){
  await page.setViewportSize({width,height}); await page.waitForTimeout(900);
  const layout=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,width:innerWidth,height:innerHeight,overflows:[...document.querySelectorAll('.panel,.clock-panel,.metrics')].filter(e=>e.scrollHeight>e.clientHeight+2||e.scrollWidth>e.clientWidth+2).map(e=>e.className)}));
  assert.equal(layout.scrollWidth,width); assert.equal(layout.scrollHeight,height); assert.deepEqual(layout.overflows,[]);
  await page.screenshot({path:path.join(output,`dashboard-${width}x${height}.png`)}); results.viewports.push(layout);
 }
 await page.locator('#task-2').fill('<img src=x onerror=alert(1)>'); await page.locator('#task-2').press('Enter'); await page.waitForTimeout(700); await page.reload();
 await page.waitForFunction(()=>document.getElementById('task-2').value==='<img src=x onerror=alert(1)>');
 assert.equal(await page.locator('img').count(),0); results.checks.push('task text is rendered safely');
 await page.locator('#task-2').fill('整理工作，轻松收尾'); await page.locator('#task-2').press('Enter'); await page.waitForTimeout(700);
 // UI states below are fixtures, never a request for real calendar permission.
 let fixture={status:'ready',event:{title:'会议显示测试：很长的会议标题也应保持布局稳定',calendar:'测试日历（合成数据）',start:Date.now()/1000-60,end:Date.now()/1000+1200},calendars:[]};
 await page.route('**/api/snapshot',async route=>{
   const response=await route.fetch();const json=await response.json();json.calendar=fixture;
   await route.fulfill({response,json});
 });
 await page.waitForFunction(()=>document.getElementById('meeting-title').textContent.startsWith('会议显示测试'));
 assert.equal(await page.locator('#meeting-badge').textContent(),'进行中');
 for(const [width,height] of [[1024,600],[1280,800]]){
   await page.setViewportSize({width,height});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth && document.documentElement.scrollHeight===innerHeight));
 }
 fixture={status:'denied',event:null,calendars:[]};
 await page.waitForFunction(()=>document.getElementById('meeting-title').textContent==='还没有日历权限');
 assert(await page.locator('#calendar-connect').isVisible());
 fixture={status:'ready',event:null,calendars:[]};
 await page.waitForFunction(()=>document.getElementById('meeting-title').textContent==='留一段时间给自己');
 results.checks.push('calendar ongoing, long title, denied and empty UI states (synthetic fixtures)');
 await page.unroute('**/api/snapshot');
 assert.deepEqual(results.consoleErrors,[]);fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify(results,null,2));await browser.close();await stop();fs.rmSync(temporary,{recursive:true,force:true});
})().catch(async e=>{console.error(e);if(browser)await browser.close();await stop();if(temporary)fs.rmSync(temporary,{recursive:true,force:true});process.exit(1)});
