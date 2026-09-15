import Foundation

/// TripGuard decision logic (the Swift RUNTIME twin of src/lib/tripWindow.js
/// and android/.../tripguard/TripGuardWindow.java).
///
/// PARITY: this must stay behaviourally identical to those two. Any change
/// here must be mirrored there (and vice-versa): there is no shared test
/// harness across all three languages, so this is a manual discipline, not
/// an enforced one.
///
/// SAFETY-FIRST: ambiguous/malformed config errs toward "active / should alert".
///
/// Window semantics (product decision 2026-06-23, ported unchanged): alert if
/// EITHER trip start OR trip end is inside the active window. Duration uses a
/// monotonic clock (`ProcessInfo.systemUptime`); window checks use wall-clock
/// local date/time.
enum TripGuardWindow {

    static func shouldAlert(config: [String: Any], tripStartWall: Date?, now: Date,
                             tripStartUptime: Double?, nowUptime: Double) -> Bool {
        guard (config["enabled"] as? Bool) == true else { return false }

        let endActive = isWithinActiveWindow(config: config, date: now)
        let startActive = tripStartWall.map { isWithinActiveWindow(config: config, date: $0) } ?? false
        guard endActive || startActive else { return false }

        let minMinutes = intValue(config["minTripMinutes"]) ?? 0
        return meetsMinDuration(startUptime: tripStartUptime, nowUptime: nowUptime, minMinutes: minMinutes)
    }

    static func isWithinActiveWindow(config: [String: Any], date: Date) -> Bool {
        return isActiveDay(config: config, date: date)
            && isActiveHour(config: config, date: date)
            && isActiveSeason(config: config, date: date)
    }

    static func isActiveDay(config: [String: Any], date: Date) -> Bool {
        guard let days = config["activeDays"] as? [Any] else { return true } // absent -> all days
        if days.isEmpty { return false } // explicit empty -> none
        // Calendar's weekday is 1=Sunday...7=Saturday; JS/Android use 0=Sun...6=Sat.
        let dow = Calendar(identifier: .gregorian).component(.weekday, from: date) - 1
        // Written long-hand rather than as a one-line `contains { ... }`: JSON
        // numbers arrive as NSNumber and can cast to either Int or Double, and
        // nesting a second `$0` closure inside the predicate to handle that is
        // exactly the shape Swift's type-checker gets ambiguous about.
        return days.contains { element in
            if let i = element as? Int { return i == dow }
            if let d = element as? Double { return Int(d) == dow }
            return false
        }
    }

    static func isActiveHour(config: [String: Any], date: Date) -> Bool {
        guard let hours = config["activeHours"] as? [String: Any] else { return true } // null/absent -> all day
        guard let start = parseHm(hours["start"] as? String),
              let end = parseHm(hours["end"] as? String) else { return true } // malformed -> fail open
        if start == end { return true } // equal -> all day (safety)
        let cal = Calendar(identifier: .gregorian)
        let cur = cal.component(.hour, from: date) * 60 + cal.component(.minute, from: date)
        if start < end { return cur >= start && cur < end } // end exclusive
        return cur >= start || cur < end // overnight wrap
    }

    static func isActiveSeason(config: [String: Any], date: Date) -> Bool {
        guard let season = config["activeSeason"] as? [String: Any] else { return true }
        guard let start = intValue(season["startMonth"]), let end = intValue(season["endMonth"]),
              start >= 1, start <= 12, end >= 1, end <= 12 else { return true } // malformed -> fail open
        let month = Calendar(identifier: .gregorian).component(.month, from: date) // already 1-12
        if start <= end { return month >= start && month <= end }
        return month >= start || month <= end // wraparound (e.g. Nov-Feb)
    }

    static func meetsMinDuration(startUptime: Double?, nowUptime: Double, minMinutes: Int) -> Bool {
        guard let startUptime = startUptime, startUptime > 0 else { return true } // unknown start -> alert (safety)
        let elapsed = nowUptime - startUptime
        if elapsed < 0 { return true } // clock anomaly -> fail open, matches the Android/JS twins
        let minSeconds = Double(max(0, minMinutes)) * 60.0
        return elapsed >= minSeconds
    }

    // MARK: - helpers

    private static func parseHm(_ s: String?) -> Int? {
        guard let s = s else { return nil }
        let parts = s.split(separator: ":")
        guard parts.count == 2, let h = Int(parts[0].trimmingCharacters(in: .whitespaces)),
              let m = Int(parts[1].trimmingCharacters(in: .whitespaces)),
              h >= 0, h <= 23, m >= 0, m <= 59 else { return nil }
        return h * 60 + m
    }

    private static func intValue(_ v: Any?) -> Int? {
        if let i = v as? Int { return i }
        if let d = v as? Double { return Int(d) }
        return nil
    }
}
