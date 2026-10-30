import Foundation
import Darwin

struct TaskItem: Codable, Equatable {
    var text = ""
    var done = false
}
struct DayRecord: Codable, Equatable {
    var day: String
    var tasks: [TaskItem]
    var completed: Int
}
struct Preferences: Codable, Equatable {
    var focus = 25
    var short = 5
    var long = 15
    var calendarEnabled = false
    var hideMeetingTitle = false
    var calendarIDs: [String] = [] // empty means every visible event calendar
    var fullscreenOnLaunch = false
}
struct Pomodoro: Codable, Equatable {
    var mode = "focus"
    var running = false
    var remaining: Double = 1500
    var endsAt: Double? = nil // Unix seconds; survives reload, app exit, and sleep
    var cycles = 0
    var completionID = 0
    func seconds(at now: Date) -> Double {
        running ? max(0, (endsAt ?? now.timeIntervalSince1970) - now.timeIntervalSince1970) : remaining
    }
}
struct DashboardState: Codable, Equatable {
    var version = 1
    var day = DashboardState.dayKey(Date())
    var tasks = Array(repeating: TaskItem(), count: 3)
    var completed = 0
    var history: [DayRecord] = []
    var timer = Pomodoro()
    var preferences = Preferences()
    static func dayKey(_ date: Date) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current; f.dateFormat = "yyyy-MM-dd"; return f.string(from: date)
    }
    func duration(_ mode: String) -> Double {
        Double(mode == "focus" ? preferences.focus : mode == "short" ? preferences.short : preferences.long) * 60
    }
    mutating func settle(at now: Date) {
        let today = Self.dayKey(now)
        if day != today {
            history.removeAll { $0.day == day }
            history.append(DayRecord(day: day, tasks: tasks, completed: completed))
            day = today; tasks = Array(repeating: TaskItem(), count: 3); completed = 0
        }
        // Attribute a focus session to its actual deadline's local calendar day.
        if timer.running, let end = timer.endsAt, end <= now.timeIntervalSince1970 {
            let completionDay = Self.dayKey(Date(timeIntervalSince1970: end))
            if timer.mode == "focus" {
                timer.cycles += 1
                if completionDay == day { completed += 1 }
                else if let i = history.firstIndex(where: { $0.day == completionDay }) { history[i].completed += 1 }
                else { history.append(DayRecord(day: completionDay, tasks: [], completed: 1)) }
                timer.mode = timer.cycles % 4 == 0 ? "long" : "short"
            } else { timer.mode = "focus" }
            timer.running = false; timer.endsAt = nil
            timer.remaining = duration(timer.mode); timer.completionID += 1
        }
        history.sort { $0.day < $1.day }; history = Array(history.suffix(30))
    }
    func validated() -> Bool {
        version == 1 && tasks.count == 3 && tasks.allSatisfy { $0.text.count <= 120 }
        && ["focus", "short", "long"].contains(timer.mode)
        && timer.remaining.isFinite && timer.remaining >= 0 && timer.remaining <= 10800
        && (!timer.running || (timer.endsAt?.isFinite == true))
        && timer.cycles >= 0 && completed >= 0 && timer.completionID >= 0
        && (1...180).contains(preferences.focus) && (1...60).contains(preferences.short)
        && (1...120).contains(preferences.long) && preferences.calendarIDs.count <= 100
    }
}

final class StateStore {
    let directory: URL
    private let file: URL
    private var lockDescriptor: Int32 = -1
    private(set) var state = DashboardState()
    init(directory: URL) throws {
        self.directory = directory; file = directory.appendingPathComponent("state.json")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                              attributes: [.posixPermissions: 0o700])
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
        let descriptor = open(directory.appendingPathComponent(".lock").path, O_CREAT | O_RDWR | O_CLOEXEC, 0o600)
        guard descriptor >= 0 else { throw AppError.message("无法锁定本地数据目录，请检查权限。") }
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
            close(descriptor); throw AppError.message("这个数据目录已有应用实例使用，请先退出原实例。")
        }
        lockDescriptor = descriptor
        do {
            if FileManager.default.fileExists(atPath: file.path) {
                // Never silently overwrite damaged or incompatible user data.
                let decoded = try JSONDecoder().decode(DashboardState.self, from: Data(contentsOf: file))
                guard decoded.validated() else { throw AppError.message("本地数据格式不兼容，请先备份 state.json。") }
                state = decoded
            }
            try update { $0.settle(at: Date()) }
        } catch { close(lockDescriptor); lockDescriptor = -1; throw error }
    }
    func update(_ mutate: (inout DashboardState) throws -> Void) throws {
        var candidate = state; try mutate(&candidate)
        guard candidate.validated() else { throw AppError.message("设置值超出允许范围。") }
        if candidate != state || !FileManager.default.fileExists(atPath: file.path) {
            let data = try JSONEncoder().encode(candidate)
            try data.write(to: file, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        }
        state = candidate
    }
    deinit { if lockDescriptor >= 0 { close(lockDescriptor) } }
}
enum AppError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let s) = self { return s }; return nil }
}
