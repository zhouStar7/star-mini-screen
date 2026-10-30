#!/usr/bin/env python3
"""Real macOS app integration tests. Uses an isolated data directory; never requests calendar permission."""
import json
import os
from pathlib import Path
import re
import socket
import stat
import subprocess
import tempfile
import time
import unittest
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'build/Star Mini Screen.app/Contents/MacOS/StarMiniScreen'
# Always connect directly to loopback; a user's proxy can otherwise intercept Host tests.
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))

class Integration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='focus-display-test-')
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0)); cls.port = s.getsockname()[1]
        cls.base = f'http://127.0.0.1:{cls.port}'
        cls.start()

    @classmethod
    def start(cls):
        cls.process = subprocess.Popen([str(APP), '--headless', '--deny-calendar-requests', '--port', str(cls.port), '--data-dir', cls.temp.name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(80):
            try:
                with HTTP.open(cls.base, timeout=1) as r:
                    cls.token = re.search(r'name="dashboard-token" content="([a-f0-9]+)"', r.read().decode())[1]
                    return
            except (OSError, TypeError):
                if cls.process.poll() is not None: raise RuntimeError('App exited before ready')
                time.sleep(.1)
        raise RuntimeError('Server startup timed out')

    @classmethod
    def stop(cls):
        cls.process.terminate(); cls.process.wait(timeout=5)

    @classmethod
    def tearDownClass(cls):
        cls.stop(); cls.temp.cleanup()

    def call(self, path='/api/snapshot', body=None, headers=None, expected=200):
        request_headers = {'X-Dashboard-Token': self.token, 'Content-Type': 'application/json'}
        request_headers.update(headers or {})
        req = urllib.request.Request(self.base + path, data=None if body is None else json.dumps(body).encode(), headers=request_headers)
        try: response = HTTP.open(req, timeout=8)
        except urllib.error.HTTPError as error: response = error
        self.assertEqual(response.code, expected)
        with response: return json.load(response)

    def test_01_real_metrics_and_default_privacy(self):
        time.sleep(1.2)
        result = self.call()
        self.assertEqual(result['calendar']['status'], 'disabled')
        self.assertTrue(0 <= result['metrics']['cpu']['percent'] <= 100)
        for field in ('memory', 'disk'):
            m = result['metrics'][field]
            self.assertGreater(m['total'], 0); self.assertTrue(0 <= m['used'] <= m['total'])

    def test_02_security(self):
        self.call(headers={'X-Dashboard-Token':'bad'}, expected=403)
        self.call(headers={'Origin':'https://example.com'}, expected=403)
        self.call(headers={'Host':'attacker.invalid'}, expected=403)
        self.call(headers={'Sec-Fetch-Site':'cross-site'}, expected=403)
        self.call('/api/timer', {'action':'start'}, {'Content-Type':'text/plain'}, expected=415)
        self.call('/api/calendar/authorize', {}, expected=403)
        with HTTP.open(self.base) as response:
            self.assertIn("frame-ancestors 'none'", response.headers['Content-Security-Policy'])
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
            self.assertNotIn('Access-Control-Allow-Origin', response.headers)
        mode = stat.S_IMODE(os.stat(Path(self.temp.name) / 'state.json').st_mode)
        self.assertEqual(mode, 0o600)

    def test_03_persistence_and_timer(self):
        day = self.call()['state']['day']
        payload = {'index':0, 'text':'本地持久化 <script>测试</script>', 'done':True, 'day':day}
        state = self.call('/api/tasks', payload)['state']
        self.assertEqual(state['tasks'][0]['text'], payload['text'])
        state = self.call('/api/timer', {'action':'start'})['state']
        deadline = state['timer']['endsAt']
        old_token = self.token
        type(self).stop(); type(self).start()
        self.call(headers={'X-Dashboard-Token': old_token}, expected=403)
        state = self.call()['state']
        self.assertTrue(state['timer']['running']); self.assertEqual(state['timer']['endsAt'], deadline)
        self.assertEqual(state['tasks'][0], {'text':payload['text'], 'done':True})
        time.sleep(.1)
        state = self.call('/api/timer', {'action':'pause'})['state']
        self.assertFalse(state['timer']['running']); self.assertLess(state['timer']['remaining'], 1500)
        remaining = state['timer']['remaining']; time.sleep(.1)
        self.assertEqual(self.call()['state']['timer']['remaining'], remaining)
        state = self.call('/api/timer', {'action':'reset'})['state']
        self.assertEqual(state['timer']['remaining'], 1500)
        for mode, seconds in [('short',300), ('long',900), ('focus',1500)]:
            self.assertEqual(self.call('/api/timer', {'action':'mode','mode':mode})['state']['timer']['remaining'], seconds)

    def test_04_validation_and_preferences(self):
        state = self.call()['state']; p = state['preferences'].copy()
        self.call('/api/preferences', {**p, 'focus':0}, expected=400)
        self.call('/api/preferences', {**p, 'focus':181}, expected=400)
        self.call('/api/timer', {'action':'mode','mode':'bogus'}, expected=400)
        self.call('/api/tasks', {'index':3,'text':'bad','done':False}, expected=400)
        self.call('/api/tasks', {'index':0,'text':'bad','done':False,'day':'1900-01-01'}, expected=400)
        result = self.call('/api/preferences', {**p,'focus':30,'hideMeetingTitle':True})
        self.assertEqual(result['state']['preferences']['focus'],30)
        type(self).stop(); type(self).start()
        self.assertTrue(self.call()['state']['preferences']['hideMeetingTitle'])
        self.call('/api/preferences', p)

if __name__ == '__main__': unittest.main(verbosity=2)
