import Foundation
import Network
import Security

struct HTTPRequest {
    let method: String
    let path: String
    let headers: [String: String]
    let body: Data
}
struct HTTPResponse {
    var status: Int = 200
    var type = "application/json; charset=utf-8"
    var body: Data
    static func json(_ value: Any, status: Int = 200) -> HTTPResponse {
        HTTPResponse(status: status, body: (try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])) ?? Data("{}".utf8))
    }
}

final class HTTPServer {
    private(set) var port: UInt16
    let token: String
    private let listener: NWListener
    private let queue = DispatchQueue(label: "local.focusdisplay.http")
    private var clients: [UUID: NWConnection] = [:]
    var route: ((HTTPRequest) -> HTTPResponse)?
    var ready: (() -> Void)?
    var failed: ((String) -> Void)?
    init(port: UInt16) throws {
        self.port = port
        var random = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, random.count, &random) == errSecSuccess else {
            throw AppError.message("无法生成本机会话密钥。")
        }
        token = random.map { String(format: "%02x", $0) }.joined()
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!)
        parameters.allowLocalEndpointReuse = true
        listener = try NWListener(using: parameters)
    }
    func start() {
        listener.stateUpdateHandler = { [weak self] state in
            if case .ready = state { DispatchQueue.main.async { guard let self = self else { return }; self.port = self.listener.port?.rawValue ?? self.port; self.ready?() } }
            if case .failed(let error) = state { DispatchQueue.main.async { self?.failed?(error.localizedDescription) } }
        }
        listener.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
        listener.start(queue: queue)
    }
    private func accept(_ connection: NWConnection) {
        guard clients.count < 32 else { connection.cancel(); return }
        let id = UUID(); clients[id] = connection
        connection.stateUpdateHandler = { [weak self] state in
            switch state { case .cancelled, .failed: self?.clients.removeValue(forKey: id); default: break }
        }
        connection.start(queue: queue)
        queue.asyncAfter(deadline: .now() + 5) { [weak self, weak connection] in
            connection?.cancel(); self?.clients.removeValue(forKey: id)
        }
        receive(connection, buffer: Data())
    }
    private func receive(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 24576) { [weak self] chunk, _, complete, error in
            guard let self = self else { return }
            var data = buffer; if let chunk = chunk { data.append(chunk) }
            guard data.count <= 24576 else { self.send(.json(["error": "请求过大"], status: 413), to: connection); return }
            guard let separator = data.range(of: Data("\r\n\r\n".utf8)) else {
                if data.count > 8192 || complete || error != nil { connection.cancel() }
                else { self.receive(connection, buffer: data) }; return
            }
            guard separator.lowerBound <= 8192,
                  let header = String(data: data[..<separator.lowerBound], encoding: .utf8) else {
                self.send(.json(["error": "请求头无效"], status: 400), to: connection); return
            }
            let lines = header.components(separatedBy: "\r\n")
            let first = lines[0].split(separator: " ")
            var headers: [String: String] = [:]
            for line in lines.dropFirst() {
                guard let colon = line.firstIndex(of: ":") else { connection.cancel(); return }
                let key = String(line[..<colon]).lowercased()
                guard headers[key] == nil else { connection.cancel(); return }
                headers[key] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            }
            guard first.count == 3, first[2] == "HTTP/1.1", headers["transfer-encoding"] == nil,
                  let length = Int(headers["content-length"] ?? "0"), length >= 0, length <= 16384 else {
                self.send(.json(["error": "请求格式无效"], status: 400), to: connection); return
            }
            if data.count < separator.upperBound + length {
                if complete || error != nil { connection.cancel() } else { self.receive(connection, buffer: data) }; return
            }
            let request = HTTPRequest(method: String(first[0]), path: String(first[1]), headers: headers,
                                      body: data.subdata(in: separator.upperBound..<(separator.upperBound + length)))
            let origin = "http://127.0.0.1:\(self.port)"
            guard headers["host"] == "127.0.0.1:\(self.port)",
                  headers["origin"] == nil || headers["origin"] == origin,
                  headers["sec-fetch-site"] != "cross-site" else {
                self.send(.json(["error": "仅允许本机同源访问"], status: 403), to: connection); return
            }
            if request.path.hasPrefix("/api/") {
                guard headers["x-dashboard-token"] == self.token else {
                    self.send(.json(["error": "会话已失效，请刷新页面"], status: 403), to: connection); return
                }
                if request.method == "POST", headers["content-type"]?.lowercased().hasPrefix("application/json") != true {
                    self.send(.json(["error": "需要 JSON 请求"], status: 415), to: connection); return
                }
            }
            DispatchQueue.main.async {
                let response = self.route?(request) ?? .json(["error": "服务不可用"], status: 503)
                self.send(response, to: connection)
            }
        }
    }
    private func send(_ response: HTTPResponse, to connection: NWConnection) {
        let csp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
        let reason = [200: "OK", 400: "Bad Request", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed", 413: "Content Too Large", 415: "Unsupported Media Type", 500: "Internal Server Error", 503: "Unavailable"][response.status] ?? "Error"
        let header = "HTTP/1.1 \(response.status) \(reason)\r\nContent-Type: \(response.type)\r\nContent-Length: \(response.body.count)\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Security-Policy: \(csp)\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nReferrer-Policy: no-referrer\r\nCross-Origin-Resource-Policy: same-origin\r\n\r\n"
        var output = Data(header.utf8); output.append(response.body)
        connection.send(content: output, completion: .contentProcessed { _ in connection.cancel() })
    }
}
