#!/usr/bin/env node
import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {existsSync, realpathSync} from 'node:fs';
import {spawn, spawnSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {DailyServices} from './daily-services.mjs';
import {NativeWindowBridge} from './native-window.mjs';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
export const READ_ARGS = Object.freeze(['task', '+get-my-tasks', '--as', 'user', '--complete=false', '--page-limit', '20', '--format', 'json']);
const CLI_ENV = {LARKSUITE_CLI_NO_UPDATE_NOTIFIER:'1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER:'1'};
export function locateCLI(env = process.env) {
  if (env.FOCUS_FEISHU_CLI) {
    if (!env.FOCUS_FEISHU_CLI.startsWith('/') || !existsSync(env.FOCUS_FEISHU_CLI)) return null;
    return realpathSync(env.FOCUS_FEISHU_CLI);
  }
  const found = spawnSync('/usr/bin/which', ['lark-cli'], {encoding:'utf8', env, timeout:2000});
  const candidate = found.status === 0 ? found.stdout.trim() : '';
  return candidate && existsSync(candidate) ? realpathSync(candidate) : null;
}
function timestamp(due) {
  const n = Number(due?.timestamp);
  return Number.isFinite(n) && n > 0 && n <= 8640000000000000 ? n : null;
}
export function normalizeTasks(envelope) {
  if (envelope?.ok !== true || envelope.identity !== 'user' || !Array.isArray(envelope.data?.items)) throw Error('invalid_response');
  const seen = new Set();
  const items = envelope.data.items.filter(item => {
    const id = item?.guid;
    if (typeof id !== 'string' || !id || id.length > 256 || seen.has(id)) return false;
    if (item.completed === true || (item.completed_at && String(item.completed_at) !== '0')) return false;
    seen.add(id); return true;
  }).map(item => ({
    id:item.guid,
    title:typeof item.summary === 'string' ? item.summary.slice(0,500) : '未命名待办',
    due:timestamp(item.due), allDay:item.due?.is_all_day === true,
    // Never trust arbitrary URLs supplied by remote task content.
    url:'https://applink.feishu.cn/client/todo/task?guid='+encodeURIComponent(item.guid)
  })).sort((a,b) => (a.due ?? Infinity) - (b.due ?? Infinity) || a.id.localeCompare(b.id));
  return {items, partial:envelope.data.has_more === true};
}
export function readCLI(cli, {timeout=20000} = {}) {
  return new Promise((resolve,reject) => {
    const child = spawn(cli, [...READ_ARGS], {env:{...process.env,...CLI_ENV}, stdio:['ignore','pipe','pipe'], shell:false});
    let output=[],errors=[],size=0,errorSize=0,finished=false;
    const finish = (error,value) => {if(finished)return;finished=true;clearTimeout(timer);error?reject(error):resolve(value)};
    const timer = setTimeout(()=>{child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),500).unref();finish(Error('timeout'))},timeout);
    child.stdout.on('data', chunk => {size+=chunk.length;if(size>4*1024*1024){child.kill();finish(Error('too_large'))}else output.push(chunk)});
    child.stderr.on('data', chunk => {errorSize+=chunk.length;if(errorSize<65536)errors.push(chunk)});
    child.on('error',()=>finish(Error('unavailable')));
    child.on('close',code=>{
      if(finished)return;
      if(code!==0){
        let type='query_failed';
        try{const error=JSON.parse(Buffer.concat(errors).toString()).error;if(error?.type==='authorization'||error?.subtype?.includes('token')||error?.subtype?.includes('scope'))type='authorization'}catch{}
        finish(Error(type));return;
      }
      try{finish(null,normalizeTasks(JSON.parse(Buffer.concat(output).toString())))}catch{finish(Error('invalid_response'))}
    });
  });
}
export class FeishuCache {
  constructor({cli=locateCLI(),reader=readCLI,clock=()=>Date.now()}={}){this.cli=cli;this.reader=reader;this.clock=clock;this.items=[];this.fetchedAt=null;this.error=null;this.pending=false;this.lastAttempt=0;this.partial=false;this.attempted=false}
  refresh(force=false){
    const now=this.clock();
    if(!this.cli||this.pending||this.attempted&&now-this.lastAttempt<(force?5000:60000))return;
    this.attempted=true;this.lastAttempt=now;this.pending=true;this.error=null;
    this.reader(this.cli).then(result=>{this.items=result.items;this.partial=result.partial;this.fetchedAt=this.clock();this.error=null}).catch(error=>{this.error=error.message;if(error.message==='authorization'){this.items=[];this.fetchedAt=null}}).finally(()=>{this.pending=false});
  }
  snapshot(){
    const status=!this.cli?'missing_cli':this.error==='authorization'?'authorization':this.error?(this.fetchedAt?'stale':'error'):this.fetchedAt?'ready':this.pending?'loading':'not_connected';
    return {status,source:'feishu-cli',scope:'assigned_to_me',items:this.items,fetchedAt:this.fetchedAt,refreshing:this.pending,partial:this.partial};
  }
}
const staticAllowed = path => path === '/index.html' || path === '/thumbs.html' || /^\/dir-[1-6]\.html$/.test(path) || /^\/(?:dir-[1-6](?:-(?:work|daily))?-\d+x\d+|six-directions|preview-hub|daily-preview-hub)\.png$/.test(path);
export function createPreviewServer({port=18767,cache=new FeishuCache(),root=join(projectRoot,'design-demos'),daily=new DailyServices({template:join(projectRoot,'integrations/weather/Apple-Weather.shortcut')}),nativeWindow=new NativeWindowBridge()}={}) {
  const token=randomBytes(32).toString('hex');
  let origin='http://127.0.0.1:'+port;
  let dailyReady;
  const bodyJSON=async req=>{let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>32768)throw Error('配置内容过大');chunks.push(chunk)}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}')}catch{throw Error('JSON格式无效')}};
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
    const send=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value))};
    const entryNavigation=req.method==='GET'&&['/','/index.html'].includes(req.url.split('?')[0])&&req.headers['sec-fetch-mode']==='navigate'&&req.headers['sec-fetch-dest']==='document';
    // A file or chat link may navigate to the public entry document. Browser
    // same-origin isolation still prevents its source from reading the token.
    // API requests remain subject to the full origin/site/token checks.
    if(req.headers.host!=='127.0.0.1:'+port||!entryNavigation&&(req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site'))return send(403,{error:'只允许本机同源访问'});
    const url=new URL(req.url,origin);const pathname=url.pathname==='/'?'/index.html':url.pathname;
    if(pathname.startsWith('/api/')){
      if(req.headers['x-dashboard-token']!==token)return send(403,{error:'请刷新本机预览页面'});
      if(pathname==='/api/system/metrics'&&req.method==='GET'){try{return send(200,await nativeWindow.metrics())}catch{return send(503,{error:'系统监控暂时不可用'})}}
      if(pathname==='/api/window/fullscreen'){
        if(req.method!=='POST')return send(405,{error:'只允许切换全屏'});
        if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'需要JSON请求'});
        if(Number(req.headers['content-length']||0)>1024||req.headers['transfer-encoding'])return send(413,{error:'请求过大'});
        req.resume();try{return send(200,await nativeWindow.toggle())}catch(error){return send(503,{error:error.message})}
      }
      if(pathname.startsWith('/api/daily/')){
        try{
          await(dailyReady??=daily.init());
          if(!['GET','POST','PUT'].includes(req.method))return send(405,{error:'操作不支持'});
          if(req.method!=='GET'&&!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'需要JSON请求'});
          if(Number(req.headers['content-length']||0)>32768)return send(413,{error:'配置内容过大'});
          if(pathname==='/api/daily/config'&&req.method==='GET')return send(200,{config:daily.store.config});
          if(pathname==='/api/daily/config'&&req.method==='PUT')return send(200,{config:await daily.store.save(await bodyJSON(req))});
          if(pathname==='/api/daily/catalog'&&req.method==='GET'){const[apps,shortcuts]=await Promise.all([daily.installedApps(),daily.shortcuts(true)]);return send(200,{apps,shortcuts})}
          if(pathname==='/api/daily/weather'&&['GET','POST'].includes(req.method)){req.resume();daily.refreshWeather(req.method==='POST');return send(200,daily.weatherSnapshot())}
          if(pathname==='/api/daily/launch'&&req.method==='POST'){const body=await bodyJSON(req);return send(200,await daily.launch(body.id))}
          if(pathname==='/api/daily/weather/import'&&req.method==='POST'){req.resume();return send(200,await daily.importWeather())}
          return send(404,{error:'接口不存在'});
        }catch(error){return send(400,{error:(error.cmd||error.path||error.message?.startsWith('spawn'))?'系统操作暂时不可用':error.message?.slice(0,120)||'日常配置操作失败'})}
      }
      if(pathname!=='/api/feishu/tasks')return send(404,{error:'接口不存在'});
      if(req.method!=='GET'&&req.method!=='POST')return send(405,{error:'只允许读取或刷新'});
      if(req.method==='POST'&&!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'需要JSON请求'});
      // No body fields, CLI arguments, tokens or command names are accepted from the browser.
      if(Number(req.headers['content-length']||0)>1024||req.headers['transfer-encoding'])return send(413,{error:'请求过大'});
      req.resume();cache.refresh(req.method==='POST');return send(200,cache.snapshot());
    }
    if(pathname==='/weather/Apple-Weather.shortcut'&&req.method==='GET'){
      try{const data=await readFile(join(projectRoot,'integrations/weather/Apple-Weather.shortcut'));res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="Apple-Weather.shortcut"'});res.end(data)}catch{send(404,{error:'天气快捷指令模板不可用'})}return;
    }
    if(req.method!=='GET'||!staticAllowed(pathname))return send(404,{error:'页面不存在'});
    try{
      let data=await readFile(join(root,pathname.slice(1)));
      if(pathname.endsWith('.html')){
        const nonce=randomBytes(18).toString('base64');
        data=Buffer.from(data.toString().replace('<head>','<head><meta name="dashboard-token" content="'+token+'">').replace(/<script>/g,'<script nonce="'+nonce+'">'));
        res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'nonce-"+nonce+"'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'");
      }
      res.writeHead(200,{'Content-Type':pathname.endsWith('.html')?'text/html; charset=utf-8':'image/png'});res.end(data);
    }catch{send(404,{error:'页面不存在'})}
  });
  server.on('listening',()=>{port=server.address().port;origin='http://127.0.0.1:'+port});
  server.requestTimeout=5000;server.headersTimeout=5000;server.maxHeadersCount=40;server.maxConnections=32;
  return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const i=process.argv.indexOf('--port');const port=i>=0?Number(process.argv[i+1]):18767;
  if(!Number.isInteger(port)||(port<1024&&!(port===0&&process.argv.includes("--managed")))||port>65535){console.error('端口必须为1024–65535');process.exit(1)}
  const server=createPreviewServer({port});
  server.on('error',()=>{console.error('无法启动：请检查端口是否占用。');process.exitCode=1});
  server.listen(port,'127.0.0.1',()=>{const url='http://127.0.0.1:'+server.address().port+'/';if(process.argv.includes('--managed'))console.log(JSON.stringify({event:'ready',url}));else console.log('副屏：'+url+'\n停止：Control–C');if(process.argv.includes('--open'))spawn('/usr/bin/open',[url],{stdio:'ignore'})});
  if(process.argv.includes('--managed')){process.stdin.resume();process.stdin.once('end',()=>{server.closeAllConnections();server.close(()=>process.exit(0))})}
}
