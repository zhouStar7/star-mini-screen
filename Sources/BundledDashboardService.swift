import Foundation

/// Owns the bundled service. Closing stdin (including parent death) shuts it down.
final class BundledDashboardService {
    private var process: Process?
    private var input: Pipe?
    private var output: Pipe?
    private var timer: DispatchWorkItem?
    private var buffer = Data()
    private var completion: ((Result<URL, Error>) -> Void)?
    func start(nativePort: UInt16, dataDirectory: URL, completion: @escaping (Result<URL, Error>) -> Void) {
        guard let root = Bundle.main.resourceURL else { completion(.failure(AppError.message("缺少应用资源"))); return }
        #if arch(arm64)
        let architecture = "arm64"
        #else
        let architecture = "x64"
        #endif
        let runtime = root.appendingPathComponent("runtime/\(architecture)/node")
        let script = root.appendingPathComponent("dashboard/integrations/feishu-preview.mjs")
        guard FileManager.default.isExecutableFile(atPath: runtime.path), FileManager.default.fileExists(atPath: script.path) else {
            completion(.failure(AppError.message("缺少内置运行环境，请重新安装完整应用"))); return
        }
        self.completion = completion
        let child = Process(), stdin = Pipe(), stdout = Pipe()
        child.executableURL = runtime; child.arguments = [script.path, "--port", "0", "--managed"]
        child.currentDirectoryURL = root.appendingPathComponent("dashboard")
        var environment = ProcessInfo.processInfo.environment
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let paths = [runtime.deletingLastPathComponent().path, "/opt/homebrew/bin", "/usr/local/bin", home+"/.local/bin", home+"/.npm-global/bin", home+"/.volta/bin", home+"/.local/share/fnm/aliases/default/bin"]
        environment["PATH"] = paths.joined(separator: ":") + ":" + (environment["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin")
        environment["STAR_MINI_SCREEN_DATA_DIR"] = dataDirectory.path
        environment["FOCUS_NATIVE_ORIGIN"] = "http://127.0.0.1:\(nativePort)"
        child.environment = environment; child.standardInput = stdin; child.standardOutput = stdout; child.standardError = FileHandle.nullDevice
        process = child; input = stdin; output = stdout
        stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            DispatchQueue.main.async { self?.receive(data) }
        }
        child.terminationHandler = { [weak self] _ in DispatchQueue.main.async { self?.finish(.failure(AppError.message("内置服务未能启动，请重新打开应用"))) } }
        let timeout = DispatchWorkItem { [weak self] in self?.finish(.failure(AppError.message("内置服务启动超时"))); self?.stop() }
        timer = timeout
        DispatchQueue.main.asyncAfter(deadline: .now()+15, execute: timeout)
        do { try child.run() } catch { finish(.failure(AppError.message("无法运行内置服务"))); stop() }
    }
    private func receive(_ data: Data) {
        guard completion != nil, !data.isEmpty else { return }
        buffer.append(data); guard buffer.count < 32768 else { finish(.failure(AppError.message("服务响应无效"))); stop(); return }
        while let end = buffer.firstIndex(of: 10) {
            let line = buffer[..<end]; buffer.removeSubrange(...end)
            guard let value = try? JSONSerialization.jsonObject(with: Data(line)) as? [String:Any], value["event"] as? String == "ready",
                  let text = value["url"] as? String, let url = URL(string:text), url.scheme == "http", url.host == "127.0.0.1", let port = url.port, port > 1023, url.path == "/" else { continue }
            finish(.success(url)); return
        }
    }
    private func finish(_ result: Result<URL, Error>) { timer?.cancel(); timer = nil; let callback = completion; completion = nil; callback?(result) }
    func stop() {
        timer?.cancel(); timer = nil; completion = nil
        output?.fileHandleForReading.readabilityHandler = nil
        try? input?.fileHandleForWriting.close(); input = nil
        if let child = process, child.isRunning {
            DispatchQueue.global().asyncAfter(deadline:.now()+2) { if child.isRunning { child.terminate() } }
        }
    }
    deinit { stop() }
}
