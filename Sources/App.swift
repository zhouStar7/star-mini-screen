import AppKit
import WebKit
import Foundation

final class DashboardApp: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    let store: StateStore
    let metrics = Metrics()
    let calendar = CalendarService()
    let server: HTTPServer
    let resources: URL
    let headless: Bool
    let denyCalendarRequests: Bool
    private(set) var dashboardURL: URL?
    private var bundledService: BundledDashboardService?
    private var window: NSWindow?
    private var statusItem: NSStatusItem?
    private var ticker: Timer?
    private var urlObservation: NSKeyValueObservation?
    private var lastCompletion = 0
    private(set) var lastSaveError: String?
    init(store: StateStore, server: HTTPServer, resources: URL, headless: Bool, denyCalendarRequests: Bool, dashboardURL: URL? = nil) {
        self.store = store; self.server = server; self.resources = resources
        self.headless = headless; self.denyCalendarRequests = denyCalendarRequests
        self.dashboardURL = dashboardURL
        super.init()
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        server.route = { [weak self] in self?.route($0) ?? .json(["error": "正在退出"], status: 503) }
        server.ready = { [weak self] in
            guard let self = self else { return }
            print("Star Mini Screen ready: http://127.0.0.1:\(self.server.port)")
            if !self.headless {
                self.setupStatusItem()
                if self.dashboardURL == nil && !CommandLine.arguments.contains("--classic-interface") {
                    let service = BundledDashboardService(); self.bundledService = service
                    service.start(nativePort: self.server.port, dataDirectory: self.store.directory) { [weak self] result in
                        guard let self = self else { return }
                        switch result {
                        case .success(let base):
                            let parts = URLComponents(url: base, resolvingAgainstBaseURL: false)!
                            
                            self.dashboardURL = parts.url; self.showWindow()
                        case .failure(let error):
                            let alert = NSAlert(); alert.messageText = "无法启动副屏"; alert.informativeText = error.localizedDescription; alert.runModal(); NSApplication.shared.terminate(nil)
                        }
                    }
                } else { self.showWindow() }
            }
        }
        server.failed = { [weak self] _ in
            // Do not expose request tokens or user data in logs.
            fputs("Star Mini Screen: 无法监听端口，可能已有实例运行。\n", stderr)
            if self?.headless == false {
                let alert = NSAlert(); alert.messageText = "无法启动本机服务"
                alert.informativeText = "端口可能已被占用。请退出已有实例，或按 README 使用其他端口。"; alert.runModal()
            }
            exit(1)
        }
        metrics.sample(); lastCompletion = store.state.timer.completionID
        ticker = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.tick() }
        RunLoop.main.add(ticker!, forMode: .common)
        server.start()
    }
    func applicationWillTerminate(_ notification: Notification) { bundledService?.stop() }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !headless { restoreWindow(nil) }; return true
    }
    private func setupStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let image = NSImage(systemSymbolName: "rectangle.split.2x2", accessibilityDescription: "Star Mini Screen") {
            image.isTemplate = true; item.button?.image = image
        } else { item.button?.title = "FD" }
        item.button?.toolTip = "Star Mini Screen"
        let menu = NSMenu()
        let show = menu.addItem(withTitle: "显示 Dashboard", action: #selector(restoreWindow(_:)), keyEquivalent: "")
        show.target = self
        let fullscreen = menu.addItem(withTitle: "切换全屏", action: #selector(toggleWindowFullscreen(_:)), keyEquivalent: "")
        fullscreen.target = self
        menu.addItem(.separator())
        let quit = menu.addItem(withTitle: "退出 Star Mini Screen", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        quit.target = NSApplication.shared
        item.menu = menu; statusItem = item
    }
    @objc func restoreWindow(_ sender: Any?) {
        guard !headless else { return }
        if let window = window {
            if window.isMiniaturized { window.deminiaturize(nil) }
            window.makeKeyAndOrderFront(nil)
            NSApplication.shared.activate(ignoringOtherApps: true)
        } else { showWindow() }
    }
    @objc private func toggleWindowFullscreen(_ sender: Any?) {
        restoreWindow(nil); window?.toggleFullScreen(nil)
    }
    private func showWindow() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = dashboardURL == nil ? .nonPersistent() : .default()
        if dashboardURL != nil { configuration.userContentController.add(self, name: "focusWindow") }
        let web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.underPageBackgroundColor = NSColor(calibratedWhite: 0.055, alpha: 1)
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1024, height: 600),
                         styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        w.title = "Star Mini Screen"; w.minSize = NSSize(width: 740, height: 500)
        w.backgroundColor = NSColor(calibratedWhite: 0.055, alpha: 1)
        w.contentView = web; w.isReleasedWhenClosed = false
        w.collectionBehavior = [.fullScreenPrimary]
        w.center(); w.setFrameAutosaveName("FocusDisplayWindow")
        w.setFrameUsingName("FocusDisplayWindow")
        if CommandLine.arguments.contains("--secondary-display"), let display = NSScreen.screens.dropFirst().first {
            w.setFrame(display.visibleFrame, display: false)
        }
        w.makeKeyAndOrderFront(nil); window = w
        let startURL = dashboardURL ?? URL(string: "http://127.0.0.1:\(server.port)/")!
        if dashboardURL != nil {
            urlObservation = web.observe(\.url, options: [.new]) { [weak self] web, _ in
                guard let self = self, let url = web.url, self.isDashboardOrigin(url), url.path == "/" else { return }
                // Mode and theme live in the persistent WebKit store. Never persist ephemeral service ports.
                if self.bundledService == nil { UserDefaults.standard.set(url.absoluteString, forKey: "FocusDisplayDashboardURL") }
            }
        }
        web.load(URLRequest(url: startURL))
        NSApplication.shared.activate(ignoringOtherApps: true)
        if store.state.preferences.fullscreenOnLaunch { DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { w.toggleFullScreen(nil) } }
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if isDashboardOrigin(url) { decisionHandler(.allow); return }
        if dashboardURL != nil, action.navigationType == .linkActivated, ["https", "http"].contains(url.scheme ?? ""), url.user == nil, url.password == nil {
            NSWorkspace.shared.open(url)
        }
        decisionHandler(.cancel)
    }
    private func isDashboardOrigin(_ url: URL) -> Bool {
        url.scheme == "http" && url.host == "127.0.0.1" && url.port == (dashboardURL?.port ?? Int(server.port)) && url.user == nil && url.password == nil
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        let origin = message.frameInfo.securityOrigin
        guard dashboardURL != nil, message.name == "focusWindow", origin.protocol == "http", origin.host == "127.0.0.1",
              origin.port == dashboardURL?.port, let body = message.body as? [String: Any], body["action"] as? String == "toggleFullscreen" else { return }
        toggleWindowFullscreen(nil)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        // Explicit user-clicked external links open in the user's browser, never inside the dashboard.
        if dashboardURL != nil, action.navigationType == .linkActivated, let url = action.request.url,
           ["https", "http"].contains(url.scheme ?? ""), url.user == nil, url.password == nil { NSWorkspace.shared.open(url) }
        return nil
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard dashboardURL != nil else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak webView] in
            webView?.evaluateJavaScript("JSON.stringify((()=>{const d=document.querySelector('iframe')?.contentDocument||document;return {mode:d.body.dataset.view||null,theme:d.body.dataset.theme||null,calendarDays:d.querySelectorAll('.calendar-day').length}})())") { value, error in
                if error == nil, let value = value as? String { print("Star Mini Screen interface: \(value)") }
                else { print("Star Mini Screen: 本机页面已载入，界面状态尚未就绪") }
            }
        }
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard dashboardURL != nil else { return }
        let alert = NSAlert(); alert.messageText = "新设计的本机服务未连接"
        alert.informativeText = "请运行项目中的 Feishu-Preview.command，然后从菜单栏显示 Dashboard，或重新打开副屏应用。"
        if let window = window { alert.beginSheetModal(for: window) }
    }
    private func tick() {
        metrics.sample()
        do { try store.update { $0.settle(at: Date()) }; lastSaveError = nil }
        catch { lastSaveError = "本地保存失败，请检查磁盘空间与数据目录权限。" }
        if store.state.timer.completionID != lastCompletion {
            lastCompletion = store.state.timer.completionID
            if !headless { NSSound(named: "Glass")?.play() }
        }
    }
    private func snapshot() -> HTTPResponse {
        let data = try! JSONEncoder().encode(store.state)
        var state = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        state.removeValue(forKey: "history")
        return .json(["state": state, "metrics": metrics.latest,
                      "calendar": calendar.snapshot(preferences: store.state.preferences),
                      "serverNow": Date().timeIntervalSince1970, "nativeWindow": !headless,
                      "saveError": lastSaveError as Any? ?? NSNull()])
    }
    private func route(_ request: HTTPRequest) -> HTTPResponse {
        if request.method == "GET", ["/", "/app.js", "/style.css", "/favicon.svg"].contains(request.path) {
            let name = request.path == "/" ? "index.html" : String(request.path.dropFirst())
            guard var data = try? Data(contentsOf: resources.appendingPathComponent(name)) else { return .json(["error": "缺少界面文件"], status: 404) }
            if name == "index.html" { data = Data(String(decoding: data, as: UTF8.self).replacingOccurrences(of: "__SESSION_TOKEN__", with: server.token).utf8) }
            let type = name.hasSuffix(".js") ? "text/javascript" : name.hasSuffix(".css") ? "text/css" : name.hasSuffix(".svg") ? "image/svg+xml" : "text/html"
            return HTTPResponse(type: type + "; charset=utf-8", body: data)
        }
        if request.method == "GET", request.path == "/api/metrics" { return .json(metrics.latest) }
        if request.method == "GET", request.path == "/api/snapshot" { return snapshot() }
        guard request.method == "POST" else { return .json(["error": "接口不存在"], status: 404) }
        guard let body = try? JSONSerialization.jsonObject(with: request.body) as? [String: Any] else { return .json(["error": "JSON 格式无效"], status: 400) }
        do {
            switch request.path {
            case "/api/tasks":
                guard let index = body["index"] as? Int, (0..<3).contains(index),
                      let text = body["text"] as? String, text.count <= 120,
                      let done = body["done"] as? Bool else { return .json(["error": "任务需要序号、文字（最多120字）和完成状态"], status: 400) }
                guard body["day"] as? String == DashboardState.dayKey(Date()) else {
                    return .json(["error": "日期已切换，请刷新后编辑今日任务。"], status: 400)
                }
                try store.update { s in s.settle(at: Date()); s.tasks[index] = TaskItem(text: text, done: done && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
            case "/api/timer":
                guard let action = body["action"] as? String, ["start", "pause", "reset", "mode"].contains(action) else { return .json(["error": "计时操作无效"], status: 400) }
                if action == "mode", !["focus", "short", "long"].contains(body["mode"] as? String ?? "") { return .json(["error": "计时模式无效"], status: 400) }
                try store.update { s in
                    let now = Date(); s.settle(at: now)
                    switch action {
                    case "start":
                        if !s.timer.running { s.timer.running = true; s.timer.endsAt = now.timeIntervalSince1970 + s.timer.remaining }
                    case "pause": s.timer.remaining = s.timer.seconds(at: now); s.timer.running = false; s.timer.endsAt = nil
                    case "reset": s.timer.running = false; s.timer.endsAt = nil; s.timer.remaining = s.duration(s.timer.mode)
                    default: s.timer.mode = body["mode"] as! String; s.timer.running = false; s.timer.endsAt = nil; s.timer.remaining = s.duration(s.timer.mode)
                    }
                }
            case "/api/preferences":
                let prefs = try JSONDecoder().decode(Preferences.self, from: request.body)
                try store.update { s in
                    s.settle(at: Date()); s.preferences = prefs
                    // Duration changes apply to the next/reset session; current countdown is preserved.
                }
                calendar.invalidate()
            case "/api/calendar/authorize":
                guard !denyCalendarRequests else { return .json(["error": "测试模式不请求日历权限"], status: 403) }
                try store.update { $0.preferences.calendarEnabled = true }; calendar.authorize()
            case "/api/calendar/refresh": calendar.invalidate()
            case "/api/window/fullscreen":
                guard let window = window else { return .json(["error": "浏览器中请使用自身全屏功能"], status: 400) }
                restoreWindow(nil); window.toggleFullScreen(nil)
                return .json(["ok": true])
            default: return .json(["error": "接口不存在"], status: 404)
            }
            return snapshot()
        } catch let error as DecodingError {
            _ = error; return .json(["error": "设置格式无效"], status: 400)
        } catch let error as AppError { return .json(["error": error.localizedDescription], status: 400) }
        catch { return .json(["error": "无法保存，请检查磁盘空间与数据目录权限。"], status: 500) }
    }
}
