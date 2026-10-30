import AppKit
import WebKit
import Foundation

// Optional native-renderer smoke test. Connect only to an isolated QA server.
final class Smoke: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var web: WKWebView!
    let url: URL
    let output: String
    init(url: URL, output: String) { self.url = url; self.output = output }
    func applicationDidFinishLaunching(_ notification: Notification) {
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1024, height: 600))
        web.navigationDelegate = self
        web.load(URLRequest(url: url))
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { fputs("FAIL: WebKit timeout\n", stderr); exit(1) }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { verify(after: 0) }
    func verify(after attempt: Int) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            self.web.evaluateJavaScript("JSON.stringify({connected:document.getElementById('connection-status').textContent, width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,clock:document.getElementById('clock').textContent,cpu:document.getElementById('cpu-value').textContent})") { value, error in
                guard let text = value as? String, let data = text.data(using: .utf8),
                      let result = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                    fputs("FAIL: WebKit JavaScript\n", stderr); exit(1)
                }
                if result["connected"] as? String != "本机连接正常" {
                    if attempt < 15 { self.verify(after: attempt + 1); return }
                    fputs("FAIL: WebKit API connection\n", stderr); exit(1)
                }
                guard result["width"] as? Int == 1024, result["height"] as? Int == 600,
                      result["scrollWidth"] as? Int == 1024, result["scrollHeight"] as? Int == 600 else {
                    fputs("FAIL: WebKit overflow\n", stderr); exit(1)
                }
                try? data.write(to: URL(fileURLWithPath: self.output), options: .atomic)
                print("PASS: native WKWebView loads UI, executes JavaScript, connects to API, and fits 1024x600")
                exit(0)
            }
        }
    }
}
@main struct WebKitSmoke {
    static func main() {
        guard CommandLine.arguments.count == 3, let url = URL(string: CommandLine.arguments[1]), url.host == "127.0.0.1" else {
            fputs("Usage: webkit-smoke http://127.0.0.1:PORT/ output.json\n", stderr); exit(1)
        }
        let app = NSApplication.shared; app.setActivationPolicy(.prohibited)
        let delegate = Smoke(url: url, output: CommandLine.arguments[2]); app.delegate = delegate
        app.run(); withExtendedLifetime(delegate) {}
    }
}
