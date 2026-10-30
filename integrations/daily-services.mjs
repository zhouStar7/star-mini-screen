import {readFile,writeFile,mkdir,rename,readdir,mkdtemp,rm,stat} from 'node:fs/promises';
import {homedir,tmpdir} from 'node:os';
import {join,basename,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile as execFileCallback} from 'node:child_process';
export function runSystemCommand(file,args,options={}){
 return new Promise((resolve,reject)=>{
  const child=execFileCallback(file,args,options,(error,stdout,stderr)=>{
   if(error){error.stdout=stdout;error.stderr=stderr;reject(error)}else resolve({stdout,stderr});
  });
  // shortcuts run consumes piped stdin before running. Always send EOF when
  // this service has no input, as an interactive terminal would.
  child.stdin?.end();
 });
}
const weatherName=/^(?:Apple-Weather|副屏天气(?:[ ·_-][^\n\r\0]{1,40})?)$/u;
const bundleID=/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/;
export const defaults=()=>({version:1,weather:{active:'current',profiles:[{id:'current',label:'当前位置',shortcut:'副屏天气'}]},launchers:[{id:'safari',name:'浏览器',type:'app',target:'com.apple.Safari'},{id:'calendar',name:'日历',type:'app',target:'com.apple.iCal'},{id:'notes',name:'备忘录',type:'app',target:'com.apple.Notes'},{id:'weather',name:'天气',type:'app',target:'com.apple.weather'},{id:'settings',name:'系统设置',type:'app',target:'com.apple.systempreferences'}]});
export function validateConfig(input){
 if(input?.version!==1||!Array.isArray(input.launchers)||input.launchers.length>8||!Array.isArray(input.weather?.profiles)||input.weather.profiles.length<1||input.weather.profiles.length>6)throw Error('配置格式无效');
 const ids=new Set();const launchers=input.launchers.map(item=>{
  if(typeof item.id!=='string'||!item.id||item.id.length>80||ids.has(item.id)||typeof item.name!=='string'||!item.name.trim()||item.name.length>20||typeof item.target!=='string'||item.target.length>2048)throw Error('快捷启动名称或标识无效');ids.add(item.id);
  if(item.type==='app'){if(!bundleID.test(item.target))throw Error('请选择已安装的应用')}
  else if(item.type==='url'){let url;try{url=new URL(item.target)}catch{throw Error('网址格式无效')}if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('网址只支持http或https，且不能包含登录信息')}
  else throw Error('快捷启动类型无效');
  return{id:item.id,name:item.name.trim(),type:item.type,target:item.target};
 });
 const pids=new Set();const profiles=input.weather.profiles.map(p=>{if(typeof p.id!=='string'||!p.id||p.id.length>80||pids.has(p.id)||typeof p.label!=='string'||!p.label.trim()||p.label.length>20||typeof p.shortcut!=='string'||!weatherName.test(p.shortcut))throw Error('天气城市名称无效，快捷指令需命名为“副屏天气”或“副屏天气 城市”');pids.add(p.id);return{id:p.id,label:p.label.trim(),shortcut:p.shortcut}});
 if(!pids.has(input.weather.active))throw Error('请选择有效天气位置');
 return{version:1,weather:{active:input.weather.active,profiles},launchers};
}
export class DailyStore{
 constructor({file=join(process.env.STAR_MINI_SCREEN_DATA_DIR||join(homedir(),'Library/Application Support/StarMiniScreen'),'daily.json')}={}){this.file=file;this.config=defaults();this.queue=Promise.resolve()}
 async load(){try{this.config=validateConfig(JSON.parse(await readFile(this.file,'utf8')))}catch(error){if(error.code!=='ENOENT')throw Error('日常配置损坏，请先备份配置文件')}return this.config}
 save(input){const candidate=validateConfig(input);const operation=this.queue.then(async()=>{await mkdir(dirname(this.file),{recursive:true,mode:0o700});const temp=this.file+'.'+randomUUID()+'.tmp';try{await writeFile(temp,JSON.stringify(candidate),{mode:0o600,flag:'wx'});await rename(temp,this.file);this.config=candidate;return candidate}finally{await rm(temp,{force:true})}});this.queue=operation.catch(()=>{});return operation}
}
export function parseAppleWeather(text){
 if(typeof text!=='string'||!text.trim()||text.length>65536)throw Error('天气未返回可用文本');
 const raw=text.trim();let data;try{data=JSON.parse(raw)}catch{}
 if(data&&typeof data==='object'&&!Array.isArray(data)){
  const t=Number(data.temperature);return{temperature:Number.isFinite(t)&&data.temperature!==null&&data.temperature!==''?t:null,description:String(data.condition||data.description||'Apple 天气').slice(0,160),high:Number.isFinite(Number(data.high))&&data.high!=null?Number(data.high):null,low:Number.isFinite(Number(data.low))&&data.low!=null?Number(data.low):null,rawText:raw.slice(0,1000)};
 }
 const match=raw.match(/(-?\d+(?:[.,]\d+)?)\s*°\s*([CF℃℉])?/i)||raw.match(/(-?\d+(?:[.,]\d+)?)\s*([℃℉])/);
 let temperature=match?Number(match[1].replace(',','.')):null;
 if(match&&/[F℉]/i.test(match[2]||''))temperature=(temperature-32)*5/9;
 const description=(match?raw.replace(match[0],''):raw).replace(/^[\s,，·:：|/–—-]+|[\s,，·:：|/–—-]+$/g,'').trim()||'Apple 天气';
 return{temperature,description:description.slice(0,160),high:null,low:null,rawText:raw.slice(0,1000)};
}
export class DailyServices{
 constructor({store=new DailyStore(),run=runSystemCommand,template=null,clock=()=>Date.now()}={}){this.store=store;this.run=run;this.template=template;this.clock=clock;this.entries=new Map();this.shortcutNames=null;this.shortcutAt=0;this.apps=null}
 async init(){await this.store.load();return this}
 async shortcuts(force=false){if(!force&&this.shortcutNames&&this.clock()-this.shortcutAt<30000)return this.shortcutNames;try{const{stdout}=await this.run('/usr/bin/shortcuts',['list'],{timeout:6000,maxBuffer:65536});this.shortcutNames=stdout.split(/\r?\n/).map(s=>s.trim()).filter(s=>weatherName.test(s));this.shortcutAt=this.clock();return this.shortcutNames}catch{return[]}}
 async installedApps(){
  if(this.apps)return this.apps;
  const roots=['/Applications','/System/Applications','/System/Applications/Utilities',join(homedir(),'Applications')];let paths=[];
  for(const root of roots){try{for(const e of await readdir(root,{withFileTypes:true}))if(e.name.endsWith('.app')&&(e.isDirectory()||e.isSymbolicLink()))paths.push(join(root,e.name))}catch{}}
  const apps=[];let cursor=0;await Promise.all(Array.from({length:6},async()=>{while(cursor<paths.length){const path=paths[cursor++];try{const{stdout}=await this.run('/usr/bin/plutil',['-convert','json','-o','-',join(path,'Contents/Info.plist')],{timeout:2000,maxBuffer:262144});const p=JSON.parse(stdout);if(bundleID.test(p.CFBundleIdentifier||''))apps.push({id:p.CFBundleIdentifier,name:String(p.CFBundleDisplayName||p.CFBundleName||basename(path,'.app')).slice(0,80)})}catch{}}}));
  const map=new Map(apps.map(a=>[a.id,a]));this.apps=[...map.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));return this.apps;
 }
 async launch(id){const item=this.store.config.launchers.find(x=>x.id===id);if(!item)throw Error('快捷启动不存在');const args=item.type==='app'?['-b',item.target]:[item.target];await this.run('/usr/bin/open',args,{timeout:5000,maxBuffer:65536});return{ok:true}}
 async importWeather(){if(this.template){await stat(this.template);await this.run('/usr/bin/open',[this.template],{timeout:5000,maxBuffer:65536})}else await this.run('/usr/bin/open',['-a','Shortcuts'],{timeout:5000,maxBuffer:65536});return{ok:true,requiresUserAdd:true}}
 refreshWeather(force=false){
  const profile=this.store.config.weather.profiles.find(p=>p.id===this.store.config.weather.active);if(!profile)return;
  let entry=this.entries.get(profile.shortcut);if(!entry){entry={pending:false,attempted:false,attemptAt:0,data:null,fetchedAt:null,status:'not_connected'};this.entries.set(profile.shortcut,entry)}
  const now=this.clock();if(entry.pending||entry.attempted&&now-entry.attemptAt<(force?5000:entry.status==='ready'?900000:30000))return;
  entry.pending=true;entry.attempted=true;entry.attemptAt=now;entry.reason=null;entry.status=entry.data?'ready':'loading';
  this.readWeather(profile.shortcut,force).then(data=>{entry.data=data;entry.fetchedAt=this.clock();entry.status='ready';entry.reason=null}).catch(error=>{entry.reason=['missing_shortcut','weather_timeout','empty_weather','weather_command_failed'].includes(error.message)?error.message:'weather_command_failed';entry.status=error.message==='missing_shortcut'?'missing_shortcut':entry.data?'stale':'error'}).finally(()=>entry.pending=false);
 }
 async readWeather(name,force){
  const names=await this.shortcuts(force);
  // macOS imports .shortcut files using their filename rather than WFWorkflowName.
  // Only the exact bundled filename is an alias; other shortcut names stay restricted.
  if(name==='副屏天气'&&!names.includes(name)&&names.includes('Apple-Weather'))name='Apple-Weather';
  if(!names.includes(name))throw Error('missing_shortcut');
  const folder=await mkdtemp(join(tmpdir(),'focus-apple-weather-'));const file=join(folder,'weather.txt');
  try{const result=await this.run('/usr/bin/shortcuts',['run',name,'--output-path',file,'--output-type','public.plain-text'],{timeout:25000,maxBuffer:65536});let text=result.stdout||'';try{if((await stat(file)).size>65536)throw Error('too_large');text=await readFile(file,'utf8')}catch(error){if(error.code!=='ENOENT')throw error}return parseAppleWeather(text)}catch(error){throw Error(error.killed?'weather_timeout':error.message==='天气未返回可用文本'?'empty_weather':'weather_command_failed')}finally{await rm(folder,{recursive:true,force:true})}
 }
 weatherSnapshot(){const profile=this.store.config.weather.profiles.find(p=>p.id===this.store.config.weather.active);const e=this.entries.get(profile?.shortcut);return{provider:'apple-shortcuts',profile:profile||null,status:e?.status||'not_connected',reason:e?.reason||null,data:e?.data||null,fetchedAt:e?.fetchedAt||null,refreshing:e?.pending||false}}
}
