const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'star-ui-'));let browser,app;
 try{
  app=spawn(path.join(root,'build/Star Mini Screen.app/Contents/MacOS/StarMiniScreen'),['--data-dir',temp],{env:{...process.env,FOCUS_FEISHU_CLI:'/nonexistent'},stdio:['ignore','pipe','pipe']});
  const native=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('app start timeout')),20000);app.stdout.on('data',b=>{text+=b;const m=text.match(/ready: (http:\/\/127\.0\.0\.1:\d+)/);if(m){clearTimeout(timer);resolve(m[1])}})});
  let child;
  for(let i=0;i<60;i++){const out=require('node:child_process').execFileSync('/bin/ps',['-axo','pid=,ppid=,args='],{encoding:'utf8'});child=out.split('\n').map(s=>s.trim().split(/\s+/)).find(s=>s[1]===String(app.pid)&&s.slice(2).join(' ').includes('/runtime/'));if(child)break;await new Promise(r=>setTimeout(r,100))}
  assert(child);let port;
  for(let i=0;i<60;i++){try{const out=require('node:child_process').execFileSync('/usr/sbin/lsof',['-nP','-a','-p',child[0],'-iTCP','-sTCP:LISTEN'],{encoding:'utf8',stdio:['ignore','pipe','ignore']});port=out.match(/127\.0\.0\.1:(\d+)/)?.[1];if(port)break}catch{}await new Promise(r=>setTimeout(r,100))}
  assert(port);const base='http://127.0.0.1:'+port;
  browser=await chromium.launch({headless:true,...(fs.existsSync(process.env.BROWSER_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')?{executablePath:process.env.BROWSER_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/daily/weather',route=>route.fulfill({json:{provider:'apple-shortcuts',status:'ready',profile:{id:'current',shortcut:'副屏天气'},data:{temperature:20,description:'多云（示例）'},fetchedAt:Date.now(),refreshing:false}}));
  for(const theme of ['graphite','deepsea','amber'])for(const [width,height]of[[1024,600],[1280,800],[375,812]]){
   await page.setViewportSize({width,height});await page.goto(base+'/?mode=daily&theme='+theme);const frame=page.frameLocator('iframe');await frame.locator('.calendar-day').first().waitFor();assert.equal(await frame.locator('.calendar-day').count(),42);await frame.locator('#view-switch').click();await page.waitForFunction(()=>{const d=document.querySelector('iframe').contentDocument;return d.querySelector('.demo-mark').textContent==='本机监控'&&[...d.querySelectorAll('.metric-number')].every(e=>e.textContent!=='—')});const metrics=await frame.locator('.metric-number').allTextContents();assert(metrics.every(v=>v!=='—'));const layout=await page.evaluate(()=>{const d=document.querySelector('iframe').contentDocument;return{width:d.documentElement.scrollWidth,viewport:d.defaultView.innerWidth,height:d.documentElement.scrollHeight,vh:d.defaultView.innerHeight}});assert.equal(layout.width,layout.viewport);if(width>739)assert.equal(layout.height,layout.vh);
   if(width===1024){const output=path.join(root,'.test-results');fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,theme+'-work.png')});await frame.locator('#view-switch').click();await page.screenshot({path:path.join(output,theme+'-daily.png')})}
  }
  assert.deepEqual(errors,[]);console.log('PASS: three themes, two modes, three sizes, real metrics, no script errors; screenshots use synthetic weather and no Feishu data');
 }finally{if(browser)await browser.close();if(app&&app.exitCode===null&&app.signalCode===null){app.kill();await new Promise(r=>app.once('exit',r))}fs.rmSync(temp,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
