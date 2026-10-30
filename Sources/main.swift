import AppKit
import Foundation
import Darwin

// Include atomic-write temporary files in the current-user-only policy.
umask(0o077)
setbuf(stdout, nil)

let args = CommandLine.arguments
func argument(_ key: String) -> String? {
    guard let i = args.firstIndex(of: key), i + 1 < args.count else { return nil }; return args[i + 1]
}
do {
    if args.contains("--write-launch-agent") {
        let executable = Bundle.main.executableURL ?? URL(fileURLWithPath: args[0]).standardizedFileURL
        let path = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/LaunchAgents/local.starminiscreen.agent.plist")
        let plist: [String: Any] = ["Label": "local.starminiscreen.agent", "ProgramArguments": [executable.path, "--login"],
                                  "RunAtLoad": true, "KeepAlive": false, "LimitLoadToSessionType": "Aqua", "ProcessType": "Interactive"]
        try FileManager.default.createDirectory(at: path.deletingLastPathComponent(), withIntermediateDirectories: true)
        try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0).write(to: path, options: .atomic)
        print(path.path); exit(0)
    }
    let rawPort = argument("--port") ?? (args.contains("--headless") || args.contains("--classic-interface") ? "8765" : "0")
    guard let port = UInt16(rawPort), port >= 1024 || (port == 0 && !args.contains("--headless")) else { throw AppError.message("端口必须是 1024–65535。") }
    let headless = args.contains("--headless")
    if args.contains("--classic-interface") { UserDefaults.standard.removeObject(forKey: "FocusDisplayDashboardURL") }
    let requestedDashboard = argument("--dashboard-url")
    var dashboardURL: URL?
    if let value = requestedDashboard {
        guard let url = URL(string: value), url.scheme == "http", url.host == "127.0.0.1",
              let dashboardPort = url.port, (1024...65535).contains(dashboardPort),
              url.user == nil, url.password == nil, url.path == "/", url.fragment == nil else {
            throw AppError.message("新界面地址必须是带端口号的本机 http://127.0.0.1 地址。")
        }
        dashboardURL = url
    }
    let directory = argument("--data-dir").map { URL(fileURLWithPath: $0, isDirectory: true) }
        ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/StarMiniScreen")
    let resources = argument("--web-dir").map { URL(fileURLWithPath: $0, isDirectory: true) }
        ?? Bundle.main.resourceURL!.appendingPathComponent("web")
    guard FileManager.default.fileExists(atPath: resources.appendingPathComponent("index.html").path) else {
        throw AppError.message("找不到前端资源，请运行 scripts/build.sh 重新构建。")
    }
    let store = try StateStore(directory: directory)
    let server = try HTTPServer(port: port)
    let app = NSApplication.shared
    app.setActivationPolicy(headless ? .prohibited : .accessory)
    let delegate = DashboardApp(store: store, server: server, resources: resources, headless: headless,
                                denyCalendarRequests: args.contains("--deny-calendar-requests"), dashboardURL: dashboardURL)
    app.delegate = delegate; app.run()
    withExtendedLifetime(delegate) {}
} catch {
    fputs("Focus Display: \(error.localizedDescription)\n", stderr); exit(1)
}
