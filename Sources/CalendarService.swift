import Foundation
import EventKit

final class CalendarService {
    // Created lazily: no EventKit connection or permission request until enabled.
    private var store: EKEventStore?
    private var cache: [String: Any]?
    private var cacheTime = Date.distantPast
    private var pending = false
    private var permissionError = false
    func invalidate() { cache = nil; cacheTime = .distantPast }
    private func eventStore() -> EKEventStore {
        if let store = store { return store }
        let new = EKEventStore(); store = new
        NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: new, queue: .main) { [weak self] _ in
            self?.invalidate()
        }
        return new
    }
    func authorize() {
        guard !pending else { return }
        let status = EKEventStore.authorizationStatus(for: .event)
        guard status == .notDetermined else { invalidate(); return }
        pending = true; permissionError = false
        eventStore().requestFullAccessToEvents { [weak self] granted, error in
            DispatchQueue.main.async {
                self?.pending = false; self?.permissionError = error != nil
                self?.invalidate()
            }
        }
    }
    func snapshot(preferences p: Preferences, now: Date = Date()) -> [String: Any] {
        guard p.calendarEnabled else { return ["status": "disabled", "event": NSNull(), "calendars": []] }
        let status = EKEventStore.authorizationStatus(for: .event)
        if pending { return ["status": "requesting", "event": NSNull(), "calendars": []] }
        guard status == .fullAccess else {
            return ["status": permissionError ? "error" : status == .notDetermined ? "notDetermined" : status == .restricted ? "restricted" : status == .writeOnly ? "writeOnly" : "denied",
                    "event": NSNull(), "calendars": []]
        }
        if let cache = cache, now.timeIntervalSince(cacheTime) < 30,
           ((cache["event"] as? [String: Any])?["end"] as? Double ?? .greatestFiniteMagnitude) > now.timeIntervalSince1970 { return cache }
        let store = eventStore()
        let calendars = store.calendars(for: .event)
        let selected = p.calendarIDs.isEmpty ? calendars : calendars.filter { p.calendarIDs.contains($0.calendarIdentifier) }
        let from = Calendar.current.startOfDay(for: now)
        let to = Calendar.current.date(byAdding: .day, value: 7, to: now)!
        let events: [EKEvent] = selected.isEmpty ? [] : store.events(matching: store.predicateForEvents(withStart: from, end: to, calendars: selected))
        let candidates = events.map { event in
            MeetingCandidate(id: event.eventIdentifier ?? "", start: event.startDate, end: event.endDate,
                allDay: event.isAllDay, canceled: event.status == .canceled,
                declined: event.attendees?.contains { $0.isCurrentUser && $0.participantStatus == .declined } ?? false)
        }
        let next = nextMeetingIndex(candidates, now: now).map { events[$0] }
        var value: [String: Any] = ["status": "ready", "event": NSNull(), "fetchedAt": now.timeIntervalSince1970,
            "calendars": calendars.map { ["id": $0.calendarIdentifier, "title": $0.title] }]
        if let next = next {
            value["event"] = ["title": p.hideMeetingTitle ? "日历事项" : (next.title ?? "未命名日程"),
                "calendar": p.hideMeetingTitle ? "本机日历" : next.calendar.title,
                "start": next.startDate.timeIntervalSince1970, "end": next.endDate.timeIntervalSince1970]
        }
        cache = value; cacheTime = now; return value
    }
}
