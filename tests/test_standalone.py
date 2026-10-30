#!/usr/bin/env python3
"""Run a relocated app without an external Node on PATH; check owned service and shutdown."""
import os,re,select,subprocess,tempfile,time,json,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
APP=Path(os.environ.get('STAR_TEST_APP',ROOT/'build/Star Mini Screen.app'))
HTTP=urllib.request.build_opener(urllib.request.ProxyHandler({}))
with tempfile.TemporaryDirectory(prefix='star-standalone-') as tmp:
    env=dict(os.environ,PATH='/usr/bin:/bin:/usr/sbin:/sbin',FOCUS_FEISHU_CLI='/nonexistent')
    p=subprocess.Popen([str(APP/'Contents/MacOS/StarMiniScreen'),'--data-dir',tmp],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    lines=[];base=None;native=None;deadline=time.time()+25
    try:
        while time.time()<deadline:
            ready,_,_=select.select([p.stdout],[],[],.25)
            if ready:
                line=p.stdout.readline();lines.append(line)
                m=re.search(r'ready: (http://127\.0\.0\.1:\d+)',line)
                if m:native=m[1]
                if 'interface:' in line:
                    value=json.loads(line.split('interface:',1)[1]);assert value['calendarDays']==42;break
            if p.poll() is not None:raise AssertionError('App exited before ready')
        else:raise AssertionError('Bundled dashboard did not become ready')
        assert native
        # Find the owned child, not a machine-wide preview server.
        listing=subprocess.check_output(['/bin/ps','-axo','pid=,ppid=,args='],text=True)
        children=[line.split(None,2) for line in listing.splitlines() if len(line.split(None,2))==3 and line.split(None,2)[1]==str(p.pid) and '/runtime/' in line]
        assert len(children)==1,children
        child_pid=int(children[0][0]);assert '--managed' in children[0][2]
        from subprocess import check_output
        # The service port is exposed only via the app's own WebKit URL store;
        # use lsof to obtain the child-owned listener without reading preferences.
        sockets=check_output(['/usr/sbin/lsof','-nP','-a','-p',str(child_pid),'-iTCP','-sTCP:LISTEN'],text=True)
        port=re.search(r'127\.0\.0\.1:(\d+)',sockets)[1];base='http://127.0.0.1:'+port
        with HTTP.open(base) as r:html=r.read().decode()
        token=re.search(r'name="dashboard-token" content="([a-f0-9]{64})"',html)[1]
        req=urllib.request.Request(base+'/api/system/metrics',headers={'X-Dashboard-Token':token})
        with HTTP.open(req) as r:metrics=json.load(r)
        assert metrics['memory']['total']>0 and metrics['disk']['total']>0
        assert 'state' not in metrics and 'calendar' not in metrics
        print('PASS: app starts bundled runtime with restricted PATH, loads new UI and returns real system metrics')
    finally:
        p.terminate();p.wait(timeout=5)
    for _ in range(30):
        try:os.kill(child_pid,0)
        except ProcessLookupError:break
        time.sleep(.1)
    else:raise AssertionError('Bundled service outlived its app')
    print('PASS: owned service exits when parent application terminates')
