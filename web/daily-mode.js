const dailyDefaults=()=>({version:1,weather:{active:'current',profiles:[{id:'current',label:'当前位置',shortcut:'副屏天气'}]},launchers:[{id:'safari',name:'浏览器',type:'app',target:'com.apple.Safari'},{id:'calendar',name:'日历',type:'app',target:'com.apple.iCal'},{id:'notes',name:'备忘录',type:'app',target:'com.apple.Notes'},{id:'weather',name:'天气',type:'app',target:'com.apple.weather'},{id:'settings',name:'系统设置',type:'app',target:'com.apple.systempreferences'}]});
let dailyConfig=dailyDefaults(),dailyLoaded=false,weatherBusy=false,weatherAgain=false,weatherPoll,catalog={apps:[],shortcuts:[]};
try{const local=JSON.parse(localStorage.getItem('focus-daily-settings-v1')||'null');if(local?.version===1)dailyConfig=local}catch{}
async function dailyAPI(path,method='GET',body){
 const run=()=>fetch(path,{method,cache:'no-store',headers:{'X-Dashboard-Token':liveFeishu.content,...(method==='GET'?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});
 let response=await run();
 if(response.status===403){const home=await(await fetch('/',{cache:'no-store'})).text();const next=new DOMParser().parseFromString(home,'text/html').querySelector('meta[name="dashboard-token"]');if(next){liveFeishu.content=next.content;response=await run()}}
 const result=await response.json();if(!response.ok)throw Error(result.error||'本机服务暂时不可用');return result;
}
function renderLaunchers(){
 $('launcher-list').replaceChildren();
 for(const item of dailyConfig.launchers){const button=document.createElement('button');button.className='quick-launcher';button.type='button';button.title=item.name;button.setAttribute('aria-label','打开'+item.name);const symbol=document.createElement('span');symbol.className='launcher-symbol';symbol.setAttribute('aria-hidden','true');symbol.textContent=item.type==='url'?'↗':item.name.slice(0,1);const name=document.createElement('span');name.className='launcher-name';name.textContent=item.name;button.append(symbol,name);button.onclick=async()=>{if(!liveFeishu){toast('请使用本机实时页面启动应用');return}button.disabled=true;try{await dailyAPI('/api/daily/launch','POST',{id:item.id})}catch(error){toast(error.message)}finally{button.disabled=false}};$('launcher-list').append(button)}
 if(!dailyConfig.launchers.length){const p=document.createElement('span');p.className='muted';p.textContent='添加常用应用或网址';$('launcher-list').append(p)}
 const current=$('weather-location');current.replaceChildren();for(const p of dailyConfig.weather.profiles){const option=document.createElement('option');option.value=p.id;option.textContent=p.label;current.append(option)}current.value=dailyConfig.weather.active;
}
async function loadDaily(force=false){
 renderLaunchers();if(!liveFeishu){renderWeather({status:'not_connected'});return}
 try{if(!dailyLoaded||force){const data=await dailyAPI('/api/daily/config');dailyConfig=data.config;dailyLoaded=true;renderLaunchers()}await refreshAppleWeather(force)}catch(error){$('weather-status').textContent='本机服务未连接';toast(error.message)}
}
function renderWeather(value){
 const ready=value.data;const temp=ready?.temperature;
 $('weather-temperature').textContent=typeof temp==='number'&&Number.isFinite(temp)?Math.round(temp)+'°':'—';
 const failures={weather_timeout:'天气读取超时',empty_weather:'快捷指令未返回天气',weather_command_failed:'天气读取失败'};
 const hints={missing_shortcut:'添加 Apple 天气',not_connected:'连接 Apple 天气',loading:'正在获取天气',error:'请先在快捷指令中运行天气',stale:'暂时无法更新'};
 $('weather-description').textContent=ready?(ready.description||'Apple 天气'):(failures[value.reason]||hints[value.status]||'连接 Apple 天气');
 $('weather-description').title=ready?.rawText||'';
 $('weather-import').hidden=!!ready||value.status==='loading';
 $('weather-refresh').disabled=value.refreshing===true;
 $('weather-status').textContent=ready?(value.status==='stale'?'上次数据 · ':'')+'Apple 天气 · '+new Date(value.fetchedAt||Date.now()).toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit'})+' 更新':value.status==='missing_shortcut'?'添加后在系统中允许定位':!liveFeishu?'请打开本机实时页面':'通过系统快捷指令读取';
}
async function refreshAppleWeather(force=false){
 if(!liveFeishu)return;if(weatherBusy){weatherAgain=true;return}weatherBusy=true;clearTimeout(weatherPoll);
 try{const value=await dailyAPI('/api/daily/weather',force?'POST':'GET',force?{}:undefined);const active=dailyConfig.weather.profiles.find(p=>p.id===dailyConfig.weather.active);if(value.profile?.id!==active?.id||value.profile?.shortcut!==active?.shortcut){weatherAgain=true;return}renderWeather(value);weatherPoll=setTimeout(()=>{if(document.body.dataset.view==='daily')refreshAppleWeather()},value.refreshing?2000:value.status==='ready'?900000:15000)}catch{renderWeather({status:'error'})}finally{weatherBusy=false;if(weatherAgain){weatherAgain=false;if(document.body.dataset.view==='daily')queueMicrotask(()=>refreshAppleWeather(true))}}
}
$('weather-refresh').onclick=()=>refreshAppleWeather(true);
$('weather-import').onclick=async()=>{if(!liveFeishu){toast('请在本机实时页面添加天气');return}try{await dailyAPI('/api/daily/weather/import','POST',{});toast('请在快捷指令窗口点击添加，并首次运行以允许定位。')}catch(error){toast(error.message)}};
$('weather-location').onchange=async event=>{const previous=dailyConfig.weather.active;dailyConfig.weather.active=event.target.value;renderWeather({status:'loading'});try{await saveDaily(dailyConfig);await refreshAppleWeather(true)}catch(error){dailyConfig.weather.active=previous;renderLaunchers();toast(error.message)}};
async function saveDaily(config){
 if(liveFeishu)dailyConfig=(await dailyAPI('/api/daily/config','PUT',config)).config;
 else{dailyConfig=JSON.parse(JSON.stringify(config));localStorage.setItem('focus-daily-settings-v1',JSON.stringify(dailyConfig))}
 renderLaunchers();return dailyConfig;
}
let calendarMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1),selectedCalendarDate=new Date();
function dateKey(date){return[date.getFullYear(),date.getMonth()+1,date.getDate()].join('-')}
function renderCalendar(){
 const today=new Date();const month=calendarMonth.getMonth(),year=calendarMonth.getFullYear();$('calendar-month').textContent=year+'年 '+(month+1)+'月';$('calendar-grid').replaceChildren();
 const first=new Date(year,month,1),offset=(first.getDay()+6)%7;
 for(let i=0;i<42;i++){const date=new Date(year,month,i-offset+1);const button=document.createElement('button');button.type='button';button.className='calendar-day';button.textContent=date.getDate();button.setAttribute('aria-label',date.toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'}));button.classList.toggle('other-month',date.getMonth()!==month);button.setAttribute('aria-pressed',String(dateKey(date)===dateKey(selectedCalendarDate)));if(dateKey(date)===dateKey(today))button.setAttribute('aria-current','date');button.onclick=()=>{selectedCalendarDate=date;if(date.getMonth()!==month)calendarMonth=new Date(date.getFullYear(),date.getMonth(),1);renderCalendar()};$('calendar-grid').append(button)}
}
$('calendar-prev').onclick=()=>{calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()-1,1);renderCalendar()};$('calendar-next').onclick=()=>{calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+1,1);renderCalendar()};$('calendar-today').onclick=()=>{calendarMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1);selectedCalendarDate=new Date();renderCalendar()};
let clockDay='';function updateDailyClock(){const now=new Date();$('clock').textContent=now.toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit'});$('seconds').textContent=String(now.getSeconds()).padStart(2,'0');$('date').textContent=now.toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'});document.querySelector('.timezone').textContent=Intl.DateTimeFormat().resolvedOptions().timeZone;const key=dateKey(now);if(clockDay&&clockDay!==key)renderCalendar();clockDay=key}updateDailyClock();setInterval(updateDailyClock,1000);renderCalendar();renderLaunchers();renderWeather({status:'not_connected'});
function option(value,text){const o=document.createElement('option');o.value=value;o.textContent=text;return o}
function addLauncherEditor(item){
 const row=document.createElement('div');row.className='launcher-editor';row.dataset.id=item.id;const name=document.createElement('input');name.className='edit-name';name.value=item.name;name.maxLength=20;name.setAttribute('aria-label','快捷方式名称');name.placeholder='名称';const type=document.createElement('select');type.className='edit-type';type.setAttribute('aria-label','快捷方式类型');type.append(option('app','应用'),option('url','网址'));type.value=item.type;const target=document.createElement('div');target.className='target-editor';
 function drawTarget(value){target.replaceChildren();if(type.value==='app'){const select=document.createElement('select');select.className='edit-target';select.setAttribute('aria-label','选择应用');const apps=[...catalog.apps];if(!apps.some(a=>a.id===value))apps.unshift({id:value||'com.apple.Safari',name:value?item.name||value:'浏览器'});for(const app of apps)select.append(option(app.id,app.name));select.value=value||'com.apple.Safari';target.append(select)}else{const input=document.createElement('input');input.className='edit-target';input.type='url';input.value=value&&/^https?:/.test(value)?value:'https://';input.placeholder='https://';input.setAttribute('aria-label','网址');target.append(input)}}drawTarget(item.target);type.onchange=()=>drawTarget(type.value==='app'?'com.apple.Safari':'https://');
 const up=document.createElement('button');up.type='button';up.className='small-control';up.textContent='↑';up.setAttribute('aria-label','上移快捷方式');up.onclick=()=>{if(row.previousElementSibling)row.parentElement.insertBefore(row,row.previousElementSibling)};const del=document.createElement('button');del.type='button';del.className='small-control';del.textContent='×';del.setAttribute('aria-label','移除快捷方式');del.onclick=()=>row.remove();row.append(name,type,target,up,del);$('launcher-editors').append(row);
}
function addWeatherEditor(profile){const row=document.createElement('div');row.className='weather-editor';row.dataset.id=profile.id;const label=document.createElement('input');label.className='weather-label';label.value=profile.label;label.maxLength=20;label.setAttribute('aria-label','天气位置名称');const shortcut=document.createElement('input');shortcut.className='weather-shortcut';shortcut.value=profile.shortcut;shortcut.setAttribute('aria-label','天气快捷指令名称');shortcut.setAttribute('list','weather-shortcut-options');const remove=document.createElement('button');remove.type='button';remove.className='small-control';remove.textContent='×';remove.setAttribute('aria-label','移除天气位置');remove.onclick=()=>row.remove();row.append(label,shortcut,remove);$('weather-editors').append(row)}
function renderDailySettings(){ $('launcher-editors').replaceChildren();dailyConfig.launchers.forEach(addLauncherEditor);$('weather-editors').replaceChildren();dailyConfig.weather.profiles.forEach(addWeatherEditor);$('daily-settings-error').textContent=''}
async function loadCatalog(){if(!liveFeishu)return;try{catalog=await dailyAPI('/api/daily/catalog');const options=$('weather-shortcut-options');options.replaceChildren();catalog.shortcuts.forEach(name=>options.append(option(name,name)));for(const row of $('launcher-editors').children){if(row.querySelector('.edit-type').value!=='app')continue;const select=row.querySelector('.edit-target');const value=select.value;if(!catalog.apps.some(a=>a.id===value))continue;select.replaceChildren(...catalog.apps.map(a=>option(a.id,a.name)));select.value=value}}catch{}}
$('settings').onclick=async()=>{if(liveFeishu&&!dailyLoaded)try{dailyConfig=(await dailyAPI('/api/daily/config')).config;dailyLoaded=true;renderLaunchers()}catch{}renderDailySettings();$('prefs').showModal();loadCatalog()};
$('launcher-add').onclick=()=>{if($('launcher-editors').children.length>=8){toast('最多添加8个快捷方式');return}addLauncherEditor({id:crypto.randomUUID(),name:'',type:'url',target:'https://'})};
$('weather-profile-add').onclick=()=>{if($('weather-editors').children.length>=6)return;addWeatherEditor({id:crypto.randomUUID(),label:'',shortcut:'副屏天气 '})};
$('daily-settings-save').onclick=async()=>{const button=$('daily-settings-save');button.disabled=true;try{const launchers=[...$('launcher-editors').children].map(row=>({id:row.dataset.id,name:row.querySelector('.edit-name').value,type:row.querySelector('.edit-type').value,target:row.querySelector('.edit-target').value}));const profiles=[...$('weather-editors').children].map(row=>({id:row.dataset.id,label:row.querySelector('.weather-label').value,shortcut:row.querySelector('.weather-shortcut').value}));if(!profiles.length)throw Error('至少保留一个天气位置');if(launchers.some(x=>!x.name.trim()||x.type==='url'&&!/^https?:\/\//.test(x.target)))throw Error('请填写快捷方式名称和有效网址');const active=profiles.some(p=>p.id===dailyConfig.weather.active)?dailyConfig.weather.active:profiles[0].id;await saveDaily({version:1,weather:{active,profiles},launchers});$('prefs').close();toast('日常配置已保存');if(document.body.dataset.view==='daily')refreshAppleWeather(true)}catch(error){$('daily-settings-error').textContent=error.message}finally{button.disabled=false}};
$('launcher-config').onclick=()=>$('settings').click();

const systemSamples=[];
function clearSystemMetrics(){
 for(const card of document.querySelectorAll('.metric')){card.querySelector('.metric-number').textContent='—';card.setAttribute('aria-label',card.querySelector('h2').textContent+'未连接');for(const e of card.querySelectorAll('.metric-ratio,.metric-total,.capacity-value,.metric-hardware'))e.textContent='—';const meter=card.querySelector('progress');if(meter)meter.removeAttribute('value')}
 document.querySelector('.sparkline polyline').setAttribute('points','');document.querySelector('.spark-area').setAttribute('d','');document.querySelector('.spark-current').setAttribute('r','0');
}
async function updateSystemMetrics(){
 if(document.body.dataset.view!=='work'||!liveFeishu)return;
 try{const m=await dailyAPI('/api/system/metrics');
 const cpu=document.querySelector('.metric-cpu'),n=m.cpu.percent;cpu.querySelector('.metric-number').textContent=typeof n==='number'?Math.round(n):'—';cpu.querySelector('.metric-hardware').textContent=m.cpu.cores+' 核';cpu.setAttribute('aria-label','CPU '+(typeof n==='number'?Math.round(n)+'%':'采样中'));
 if(typeof n==='number'){systemSamples.push(n);if(systemSamples.length>30)systemSamples.shift();const points=systemSamples.map((v,i)=>[systemSamples.length===1?180:i*180/(systemSamples.length-1),36-v*.36]);cpu.querySelector('polyline').setAttribute('points',points.map(p=>p.join(',')).join(' '));cpu.querySelector('.spark-area').setAttribute('d','M'+points.map(p=>p.join(' ')).join(' L')+' L180 36 L0 36 Z');const circle=cpu.querySelector('circle');circle.setAttribute('cx',points.at(-1)[0]);circle.setAttribute('cy',points.at(-1)[1]);circle.setAttribute('r','2.2')}
 for(const field of ['memory','disk']){const d=m[field],c=document.querySelector('.metric-'+field);if(typeof d?.used!=='number'||!(d.total>0))throw Error('unavailable');const used=d.used/1024**3,total=d.total/1024**3,ratio=Math.max(0,Math.min(100,Math.round(d.used/d.total*100)));c.querySelector('.metric-number').textContent=used.toFixed(field==='disk'?0:1);c.querySelector('.metric-unit').textContent='GiB';c.querySelector('.metric-total').textContent='/ '+total.toFixed(field==='disk'?0:1)+' GiB';c.querySelector('.metric-ratio').textContent=ratio+'%';c.querySelector('.capacity-value').textContent=((d.total-d.used)/1024**3).toFixed(1)+' GiB';c.querySelector('progress').value=ratio;c.querySelector('progress').setAttribute('aria-label',c.querySelector('h2').textContent+'使用率'+ratio+'%');c.setAttribute('aria-label',c.querySelector('h2').textContent+'已用'+used.toFixed(1)+' GiB，共'+total.toFixed(1)+' GiB')}
 document.querySelector('.demo-mark').textContent='本机监控';document.querySelector('.metrics').setAttribute('aria-label','实时系统监控');
 }catch{clearSystemMetrics();document.querySelector('.demo-mark').textContent='监控未连接'}
}
clearSystemMetrics();updateSystemMetrics();setInterval(updateSystemMetrics,2000);
