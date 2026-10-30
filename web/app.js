'use strict';
const $ = id => document.getElementById(id);
let token = document.querySelector('meta[name="dashboard-token"]').content;
let snapshot = null, connected = false, lastSuccess = 0, sampleTime = 0;
let serverAnchor = 0, perfAnchor = 0, lastRendered = 0, lastCompletion = null;
let queue = Promise.resolve(), noticeTimeout, pollTimeout;
const dirty = new Set(), saving = new Set(), debounce = new Map(), cpuHistory = [];
const modeLabels = {focus: '专注', short: '短休', long: '长休'};
function notify(message) {
  $('notice').textContent = message; $('notice').hidden = false;
  clearTimeout(noticeTimeout); noticeTimeout = setTimeout(() => { $('notice').hidden = true; }, 6500);
}
async function request(path, body, renewed = false) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST', cache: 'no-store', credentials: 'omit',
    headers: {'X-Dashboard-Token': token, ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: AbortSignal.timeout(7000)
  });
  const result = await response.json();
  if (response.status === 403 && !renewed && result.error?.includes('会话已失效')) {
    const bootstrap = await fetch('/', {cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(7000)});
    if (bootstrap.ok) {
      const document = new DOMParser().parseFromString(await bootstrap.text(), 'text/html');
      const nextToken = document.querySelector('meta[name="dashboard-token"]')?.content;
      if (/^[a-f0-9]{64}$/.test(nextToken || '')) { token = nextToken; return request(path, body, true); }
    }
  }
  if (!response.ok) throw new Error(result.error || '本机服务暂时不可用');
  return result;
}
function accept(result) {
  if (result.serverNow < lastRendered) return;
  if (snapshot && snapshot.state.day !== result.state.day) {
    dirty.clear(); debounce.forEach(clearTimeout); debounce.clear();
    notify('新的一天，三项重点已清空。昨日记录保存在本机。');
  }
  snapshot = result; connected = true; lastSuccess = performance.now();
  serverAnchor = result.serverNow; perfAnchor = performance.now(); lastRendered = result.serverNow;
  document.body.classList.remove('offline');
  $('connection-status').textContent = '本机连接正常';
  const state = result.state;
  for (let i = 0; i < 3; i++) {
    if (!dirty.has(i) && !saving.has(i)) {
      if (document.activeElement !== $('task-' + i)) $('task-' + i).value = state.tasks[i].text;
      $('done-' + i).checked = state.tasks[i].done;
    }
    $('task-' + i).closest('.task-row').classList.toggle('is-done', $('done-' + i).checked);
  }
  $('task-count').textContent = state.tasks.filter(t => t.done).length + ' / 3';
  $('completed').textContent = `今日完成 ${state.completed} 轮`;
  const round = state.timer.cycles % 4;
  $('cycle-dots').textContent = Array.from({length: 4}, (_, i) => i < round ? '●' : '○').join(' ');
  $('cycle-dots').setAttribute('aria-label', `当前四轮进度：${round} 轮已完成`);
  document.querySelectorAll('[data-mode]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.mode === state.timer.mode));
  });
  const timer = state.timer;
  $('timer-toggle').textContent = timer.running ? '暂停' : `开始${modeLabels[timer.mode]}`;
  $('timer-hint').textContent = timer.running ? (timer.mode === 'focus' ? '正在专注，保持这个节奏' : '休息一下，让思绪呼吸') : '准备好，按自己的节奏开始';
  if (lastCompletion !== null && timer.completionID > lastCompletion) notify(`本轮已完成。${modeLabels[timer.mode]}已就绪，点击开始继续。`);
  lastCompletion = timer.completionID;
  renderMetrics(result.metrics); renderMeeting(); updateTimer(); updateSaveStatus();
  if (result.saveError) { $('save-status').textContent = result.saveError; }
}
function act(path, body) {
  const operation = queue.then(async () => { const result = await request(path, body); accept(result); return result; });
  queue = operation.catch(() => {});
  return operation;
}
function command(path, body) { return act(path, body).catch(error => notify(error.message)); }
function updateSaveStatus() {
  $('save-status').textContent = dirty.size || saving.size ? '任务尚未保存 · 正在重试' : '已保存 · 数据仅在本机';
}
function saveTask(index) {
  clearTimeout(debounce.get(index)); debounce.delete(index);
  if (!snapshot || saving.has(index) || !dirty.has(index)) return;
  const text = $('task-' + index).value, done = $('done-' + index).checked;
  const day = snapshot.state.day;
  saving.add(index); updateSaveStatus();
  act('/api/tasks', {index, text, done, day}).then(() => {
    if ($('task-' + index).value === text && $('done-' + index).checked === done) dirty.delete(index);
  }).catch(error => notify('任务还未保存：' + error.message)).finally(() => {
    saving.delete(index); updateSaveStatus();
    if (dirty.has(index) && connected) debounce.set(index, setTimeout(() => saveTask(index), 2000));
  });
}
for (let i = 0; i < 3; i++) {
  $('task-' + i).addEventListener('input', () => {
    dirty.add(i); updateSaveStatus(); clearTimeout(debounce.get(i));
    debounce.set(i, setTimeout(() => saveTask(i), 400));
  });
  $('task-' + i).addEventListener('blur', () => saveTask(i));
  $('task-' + i).addEventListener('keydown', event => { if (event.key === 'Enter') { event.target.blur(); saveTask(i); } });
  $('done-' + i).addEventListener('change', () => {
    if (!$('task-' + i).value.trim()) { $('done-' + i).checked = false; notify('先写下这一项任务。'); return; }
    dirty.add(i); $('task-' + i).closest('.task-row').classList.toggle('is-done', $('done-' + i).checked); saveTask(i);
  });
}
window.addEventListener('beforeunload', event => { if (dirty.size || saving.size) { event.preventDefault(); event.returnValue = ''; } });
$('timer-toggle').onclick = () => { if (snapshot) command('/api/timer', {action: snapshot.state.timer.running ? 'pause' : 'start'}); };
$('timer-reset').onclick = () => command('/api/timer', {action: 'reset'});
document.querySelectorAll('[data-mode]').forEach(button => { button.onclick = () => command('/api/timer', {action: 'mode', mode: button.dataset.mode}); });
$('calendar-refresh').onclick = () => command('/api/calendar/refresh', {});
$('calendar-connect').onclick = () => {
  const status = snapshot?.calendar.status;
  if (['denied', 'restricted', 'writeOnly', 'error'].includes(status)) {
    notify('请在“系统设置 → 隐私与安全性 → 日历”中允许 Focus Display 完全访问，然后刷新。'); return;
  }
  command('/api/calendar/authorize', {});
};
$('fullscreen').onclick = () => {
  if (snapshot?.nativeWindow) command('/api/window/fullscreen', {});
  else if (document.fullscreenElement) document.exitFullscreen().catch(error => notify(error.message));
  else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => notify('请使用浏览器菜单的全屏功能。'));
  else notify('请使用浏览器菜单的全屏功能。');
};
function serverTime() { return serverAnchor + (performance.now() - perfAnchor) / 1000; }
function updateClock() {
  const now = new Date();
  $('clock').textContent = now.toLocaleTimeString('zh-CN', {hour12: false, hour: '2-digit', minute: '2-digit'});
  $('seconds').textContent = String(now.getSeconds()).padStart(2, '0');
  $('date').textContent = now.toLocaleDateString('zh-CN', {month: 'long', day: 'numeric', weekday: 'long'});
  $('greeting').textContent = now.getHours() < 12 ? '早安，慢慢进入状态' : now.getHours() < 18 ? '此刻，专注于重要的事' : '夜色渐深，给自己一点留白';
  $('timezone').textContent = Intl.DateTimeFormat().resolvedOptions().timeZone.replaceAll('_', ' ');
  if (snapshot && performance.now() - lastSuccess > 6500) {
    connected = false; document.body.classList.add('offline');
    $('connection-status').textContent = '本机服务断开 · 正在重连';
    $('sample-status').textContent = '监控值已过期';
  }
}
function updateTimer() {
  if (!snapshot) return;
  const {timer, preferences} = snapshot.state;
  const seconds = Math.max(0, timer.running ? (timer.endsAt || serverTime()) - serverTime() : timer.remaining);
  const whole = Math.ceil(seconds);
  $('timer-digits').textContent = `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
  const duration = preferences[timer.mode] * 60;
  $('timer-progress').value = Math.min(1, Math.max(0, 1 - seconds / duration));
}
const gib = number => (number / 1024 ** 3).toFixed(1) + ' GB';
function metricValue(id, number) {
  const element = $(id); element.replaceChildren(document.createTextNode(number === null ? '—' : String(Math.round(number))));
  const small = document.createElement('small'); small.textContent = '%'; element.append(small);
}
function renderMetrics(metrics) {
  if (!metrics.cpu) return;
  const cpu = metrics.cpu.percent;
  metricValue('cpu-value', cpu);
  $('cpu-detail').textContent = metrics.cpu.cores + ' 核 · 60 秒';
  if (metrics.sampledAt !== sampleTime) {
    sampleTime = metrics.sampledAt;
    if (cpu !== null) cpuHistory.push({at: sampleTime, value: cpu});
    while (cpuHistory.length && cpuHistory[0].at < sampleTime - 60) cpuHistory.shift();
    $('cpu-chart').querySelector('polyline').setAttribute('points', cpuHistory.map(point => `${180 - (sampleTime - point.at) * 3},${34 - point.value * .32}`).join(' '));
    $('cpu-chart').setAttribute('aria-label', `CPU 当前 ${cpu === null ? '正在采样' : Math.round(cpu) + '%'}，曲线显示最近一分钟`);
  }
  for (const name of ['memory', 'disk']) {
    const m = metrics[name], percent = m.used === null || !m.total ? null : m.used / m.total * 100;
    metricValue(name + '-value', percent); $(name + '-bar').value = percent ?? 0;
    $(name + '-detail').textContent = percent === null ? '采集不可用' : `${gib(m.used)} / ${gib(m.total)}`;
  }
  $('sample-status').textContent = '每 2 秒更新 · 系统实测';
}
function renderMeeting() {
  if (!snapshot) return;
  const calendar = snapshot.calendar, status = calendar.status, event = calendar.event;
  $('calendar-connect').hidden = status === 'ready' || status === 'requesting';
  $('meeting-badge').hidden = true;
  if (status === 'ready' && event) {
    const now = serverTime(), start = new Date(event.start * 1000), end = new Date(event.end * 1000);
    const sameDay = start.toDateString() === new Date(now * 1000).toDateString();
    const hm = date => date.toLocaleTimeString('zh-CN', {hour12: false, hour: '2-digit', minute: '2-digit'});
    $('meeting-time').textContent = `${sameDay ? '今天' : start.toLocaleDateString('zh-CN', {month:'numeric',day:'numeric'})} ${hm(start)} — ${hm(end)}`;
    $('meeting-title').textContent = event.title; $('meeting-title').title = event.title;
    $('meeting-detail').textContent = event.calendar; $('meeting-detail').title = event.calendar;
    $('meeting-badge').hidden = false;
    const mins = Math.max(1, Math.ceil((event.start - now) / 60));
    $('meeting-badge').textContent = event.end <= now ? '正在刷新' : event.start <= now ? '进行中' : mins < 60 ? `${mins} 分钟后` : mins < 1440 ? `${Math.ceil(mins / 60)} 小时后` : `${Math.ceil(mins / 1440)} 天后`;
  } else {
    const messages = {
      disabled: ['让日程，恰好在视线里', '连接 macOS 日历', '只在本机读取，不上传日程。', '连接本机日历 ↗'],
      notDetermined: ['需要一次系统授权', '允许读取本机日历', '点击连接，在系统弹窗中允许完全访问。', '请求日历授权 ↗'],
      requesting: ['等待系统授权', '请查看 macOS 权限弹窗', '允许后自动更新；取消授权不影响其他功能。', '等待授权'],
      denied: ['日历访问未获允许', '还没有日历权限', '系统设置 → 隐私与安全性 → 日历', '查看授权说明 ↗'],
      restricted: ['日历访问受系统限制', '当前无法读取日历', '检查设备管理或隐私限制。', '查看授权说明 ↗'],
      writeOnly: ['需要日历完全访问', '当前权限无法读取日程', '请在系统设置中改为完全访问。', '查看授权说明 ↗'],
      error: ['日历服务暂时不可用', '请检查系统日历权限', '确认已授权后，点击刷新重试。', '查看授权说明 ↗'],
      ready: ['未来 7 天，暂时没有日程', '留一段时间给自己', '不含全天、已结束、已取消或已拒绝的日程。', '']
    };
    const m = messages[status] || messages.error;
    $('meeting-time').textContent = m[0]; $('meeting-title').textContent = m[1]; $('meeting-title').title = '';
    $('meeting-detail').textContent = m[2]; $('meeting-detail').title = m[2]; $('calendar-connect').textContent = m[3];
  }
}
$('settings-open').onclick = () => {
  if (!snapshot) { notify('请等待本机服务连接。'); return; }
  const p = snapshot.state.preferences;
  for (const key of ['focus', 'short', 'long']) $('pref-' + key).value = p[key];
  $('pref-calendar').checked = p.calendarEnabled; $('pref-hide').checked = p.hideMeetingTitle;
  $('pref-fullscreen').checked = p.fullscreenOnLaunch;
  const list = $('pref-calendars'); list.replaceChildren();
  for (const c of snapshot.calendar.calendars || []) {
    const option = document.createElement('option'); option.value = c.id; option.textContent = c.title;
    option.selected = p.calendarIDs.includes(c.id); list.append(option);
  }
  list.disabled = !list.options.length;
  $('settings-error').textContent = ''; $('settings').showModal();
};
$('settings-close').onclick = () => $('settings').close();
$('settings-form').onsubmit = async event => {
  event.preventDefault();
  const button = event.submitter; button.disabled = true;
  try {
    const p = {...snapshot.state.preferences};
    for (const key of ['focus', 'short', 'long']) p[key] = Number($('pref-' + key).value);
    p.calendarEnabled = $('pref-calendar').checked; p.hideMeetingTitle = $('pref-hide').checked;
    p.fullscreenOnLaunch = $('pref-fullscreen').checked;
    if (!$('pref-calendars').disabled) p.calendarIDs = Array.from($('pref-calendars').selectedOptions, option => option.value);
    await act('/api/preferences', p); $('settings').close(); notify('设置已保存。');
  } catch (error) { $('settings-error').textContent = error.message; }
  finally { button.disabled = false; }
};
async function poll() {
  try {
    accept(await request('/api/snapshot'));
    for (const i of dirty) if (!saving.has(i) && !debounce.has(i)) saveTask(i);
  } catch (_) {
    if (!snapshot) {
      connected = false; document.body.classList.add('offline');
      $('connection-status').textContent = '无法连接本机服务 · 正在重试';
      $('sample-status').textContent = '等待服务恢复';
    }
    // Keep the last sample; staleness is shown after 6.5 seconds.
  }
  pollTimeout = setTimeout(poll, document.hidden ? 10000 : 2000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { clearTimeout(pollTimeout); poll(); } });
window.addEventListener('pageshow', () => { updateClock(); });
updateClock(); poll();
setInterval(() => { updateClock(); updateTimer(); renderMeeting(); }, 500);
