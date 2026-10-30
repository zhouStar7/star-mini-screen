import Foundation

@main struct StateTests {
    static func main() throws {
        func check(_ condition: @autoclosure () -> Bool, _ message: String) {
            if !condition() { fputs("FAIL: \(message)\n", stderr); exit(1) }
        }
        let now = Date()
        var state = DashboardState()
        state.timer.running = true; state.timer.endsAt = now.timeIntervalSince1970 + 60
        check(abs(state.timer.seconds(at: now.addingTimeInterval(20)) - 40) < 0.01, "deadline countdown")
        let encoded = try JSONEncoder().encode(state)
        let restored = try JSONDecoder().decode(DashboardState.self, from: encoded)
        check(restored == state, "running state roundtrip")
        state.settle(at: now.addingTimeInterval(61))
        check(state.completed == 1 && state.timer.mode == "short" && !state.timer.running, "completion switches to paused break")
        state.settle(at: now.addingTimeInterval(3600))
        check(state.completed == 1, "completion must be counted once")
        state.timer.mode = "focus"; state.timer.cycles = 3
        state.timer.running = true; state.timer.endsAt = now.timeIntervalSince1970 - 1
        state.settle(at: now)
        check(state.timer.mode == "long" && state.timer.cycles == 4, "long break after four focus rounds")
        let today = Calendar.current.startOfDay(for: now)
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: today)!
        for end in [today.addingTimeInterval(-60), today.addingTimeInterval(60)] {
            var daily = DashboardState(); daily.day = DashboardState.dayKey(yesterday)
            daily.tasks[0].text = "Yesterday"; daily.timer.running = true
            daily.timer.endsAt = end.timeIntervalSince1970
            daily.settle(at: today.addingTimeInterval(120))
            check(daily.tasks[0].text.isEmpty, "daily tasks reset")
            check(daily.history.first(where: { $0.day == DashboardState.dayKey(yesterday) })?.tasks.first?.text == "Yesterday", "archive preserves previous tasks")
            check(daily.completed == (end >= today ? 1 : 0), "completion attribution across midnight")
            check(daily.history.first(where: { $0.day == DashboardState.dayKey(yesterday) })?.completed == (end < today ? 1 : 0), "yesterday completion attribution")
        }
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        do {
            let disk = try StateStore(directory: folder)
            try disk.update { $0.tasks[0] = TaskItem(text: "Persisted", done: true) }
            do { _ = try StateStore(directory: folder); check(false, "second instance must be rejected") } catch {}
            do { try disk.update { $0.preferences.focus = 0 }; check(false, "invalid duration rejected") } catch {}
            check(disk.state.preferences.focus == 25, "failed mutation rolls back")
        }
        do {
            let reloaded = try StateStore(directory: folder)
            check(reloaded.state.tasks[0].text == "Persisted", "atomic state persistence")
        }
        try Data("damaged".utf8).write(to: folder.appendingPathComponent("state.json"))
        do { _ = try StateStore(directory: folder); check(false, "damaged data must not be silently reset") } catch {}
        func meeting(_ id: String, _ start: Double, _ end: Double, allDay: Bool = false, canceled: Bool = false, declined: Bool = false) -> MeetingCandidate {
            MeetingCandidate(id: id, start: now.addingTimeInterval(start), end: now.addingTimeInterval(end), allDay: allDay, canceled: canceled, declined: declined)
        }
        let candidates = [meeting("ended", -90, -1), meeting("allDay", -300, 300, allDay: true),
            meeting("canceled", -200, 300, canceled: true), meeting("declined", -100, 300, declined: true),
            meeting("future", 60, 120), meeting("ongoing", -60, 60)]
        check(nextMeetingIndex(candidates, now: now) == 5, "ongoing meeting takes precedence; exclusions apply")
        check(nextMeetingIndex(Array(candidates.prefix(4)), now: now) == nil, "excluded events do not appear")
        check(nextMeetingIndex([meeting("b", 60, 120), meeting("a", 60, 120)], now: now) == 1, "simultaneous event order is deterministic")
        print("PASS: deadline, restart, completion, long break, midnight attribution, archive, disk persistence, directory lock, validation, damaged data, meeting filtering")
    }
}
