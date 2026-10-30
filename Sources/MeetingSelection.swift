import Foundation

// Pure selection logic, shared by the EventKit adapter and deterministic tests.
struct MeetingCandidate {
    let id: String
    let start: Date
    let end: Date
    let allDay: Bool
    let canceled: Bool
    let declined: Bool
}
func nextMeetingIndex(_ candidates: [MeetingCandidate], now: Date) -> Int? {
    candidates.indices.filter {
        let e = candidates[$0]
        return !e.allDay && !e.canceled && !e.declined && e.end > now
    }.min {
        let a = candidates[$0], b = candidates[$1]
        return a.start == b.start ? a.id < b.id : a.start < b.start
    }
}
