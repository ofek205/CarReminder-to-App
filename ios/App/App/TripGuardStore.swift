import Foundation

/// TripGuard config/state store (UserDefaults-backed), the Swift twin of
/// android/.../tripguard/TripGuardStore.java.
///
/// Why UserDefaults and not Capacitor Preferences (read from JS): the two
/// detection monitors (Bluetooth route-change, location significant-change)
/// run natively and must work even when the WebView was never loaded this
/// launch (a background relaunch triggered purely by CoreLocation). They
/// read/write here directly, no JS round-trip.
///
/// Two INDEPENDENT trip-timing tracks (bt* / loc*) because Bluetooth and
/// location detect trip start/end from completely different signals and can
/// be enabled together ("both" mode); conflating them would let one
/// mechanism's timestamp corrupt the other's window/duration calculation.
enum TripGuardStore {
    private static let suiteKey = "tripguard" // segregated like Android's own "tripguard" SharedPreferences file
    private static var defaults: UserDefaults { UserDefaults.standard }

    private static let kConfig = "tripguard.config"
    private static let kSnooze = "tripguard.snoozeNextTrip"
    private static let kBtTripStartWall = "tripguard.bt.tripStartWall"
    private static let kBtTripStartUptime = "tripguard.bt.tripStartUptime"
    private static let kLocTripStartWall = "tripguard.loc.tripStartWall"
    private static let kLocTripStartUptime = "tripguard.loc.tripStartUptime"
    private static let kLocDriving = "tripguard.loc.driving"
    private static let kLastAlertFiredAt = "tripguard.lastAlertFiredAt"
    private static let kTripLog = "tripguard.tripLog"
    private static let logMax = 10
    // Two independent detectors ("both" mode) can each decide, from their own
    // signal, that the same real-world parking moment is a trip end. Without
    // this the user gets two alerts for one trip. Wide enough to cover the
    // realistic worst case (location's significant-change delivery lag can
    // legitimately be several minutes), narrow enough it can never suppress a
    // genuinely new trip that starts shortly after.
    private static let dedupWindowSeconds: TimeInterval = 10 * 60

    // MARK: - Config

    /// Safety-first defaults, matching DEFAULT_CONFIG in
    /// src/lib/tripGuard/definitions.js. `iosDetectionMode` defaults to
    /// "both": a forgetful parent is better served by the strongest available
    /// protection than by the smallest permission ask.
    static func defaultConfig() -> [String: Any] {
        [
            "enabled": false,
            "carDeviceIds": [],
            "activeDays": [0, 1, 2, 3, 4, 5, 6],
            "minTripMinutes": 2,
            "alertDelaySeconds": 0,
            "escalateAfterSeconds": 30,
            "iosDetectionMode": "both",
        ]
    }

    static func getConfig() -> [String: Any] {
        guard let data = defaults.data(forKey: kConfig),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return defaultConfig()
        }
        return defaultConfig().merging(obj) { _, new in new }
    }

    static func saveConfig(_ patch: [String: Any]) {
        let next = getConfig().merging(patch) { _, new in new }
        guard JSONSerialization.isValidJSONObject(next),
              let data = try? JSONSerialization.data(withJSONObject: next) else { return }
        defaults.set(data, forKey: kConfig)
    }

    static func setEnabled(_ enabled: Bool) {
        saveConfig(["enabled": enabled])
    }

    static func detectionMode() -> String {
        (getConfig()["iosDetectionMode"] as? String) ?? "both"
    }

    static func wantsBluetooth() -> Bool {
        let m = detectionMode()
        return m == "bluetooth" || m == "both"
    }

    static func wantsLocation() -> Bool {
        let m = detectionMode()
        return m == "location" || m == "both"
    }

    // MARK: - Snooze (one-shot, consumed by whichever detector ends the next trip)

    static func setSnoozeNextTrip(_ snooze: Bool) {
        defaults.set(snooze, forKey: kSnooze)
    }

    static func isSnoozeNextTrip() -> Bool {
        defaults.bool(forKey: kSnooze)
    }

    // MARK: - Bluetooth trip timing

    static func setBtTripStart(wall: Date, uptime: Double) {
        defaults.set(wall.timeIntervalSince1970, forKey: kBtTripStartWall)
        defaults.set(uptime, forKey: kBtTripStartUptime)
    }

    static func btTripStartWall() -> Date? {
        let v = defaults.double(forKey: kBtTripStartWall)
        return v > 0 ? Date(timeIntervalSince1970: v) : nil
    }

    static func btTripStartUptime() -> Double? {
        let v = defaults.double(forKey: kBtTripStartUptime)
        return v > 0 ? v : nil
    }

    // Deliberately no "clear" (see TripGuardReceiver.java's 2026-09-14 fix).
    // Clearing on every disconnect destroyed the exact state a reconnect
    // debounce needs; the next genuine trip overwrites these via
    // setBtTripStart on its own connect event instead.

    // MARK: - Location trip timing

    static func setLocTripStart(wall: Date, uptime: Double) {
        defaults.set(wall.timeIntervalSince1970, forKey: kLocTripStartWall)
        defaults.set(uptime, forKey: kLocTripStartUptime)
    }

    static func locTripStartWall() -> Date? {
        let v = defaults.double(forKey: kLocTripStartWall)
        return v > 0 ? Date(timeIntervalSince1970: v) : nil
    }

    static func locTripStartUptime() -> Double? {
        let v = defaults.double(forKey: kLocTripStartUptime)
        return v > 0 ? v : nil
    }

    static func setLocDriving(_ driving: Bool) {
        defaults.set(driving, forKey: kLocDriving)
    }

    static func isLocDriving() -> Bool {
        defaults.bool(forKey: kLocDriving)
    }

    // MARK: - Cross-detector dedup ("both" mode)

    /// True if firing now would duplicate an alert already sent for what is
    /// most likely the same real-world trip end.
    static func alertWasRecentlyFired(now: Date = Date()) -> Bool {
        let v = defaults.double(forKey: kLastAlertFiredAt)
        guard v > 0 else { return false }
        return now.timeIntervalSince1970 - v < dedupWindowSeconds
    }

    static func markAlertFired(at date: Date = Date()) {
        defaults.set(date.timeIntervalSince1970, forKey: kLastAlertFiredAt)
    }

    // MARK: - Trip log (transparency: mirrors Android's shape [{at, alerted}], newest first)

    static func appendTripLog(at wall: Date, alerted: Bool) {
        var log = rawTripLog()
        log.append(["at": Int(wall.timeIntervalSince1970 * 1000), "alerted": alerted])
        if log.count > logMax { log.removeFirst(log.count - logMax) }
        if let data = try? JSONSerialization.data(withJSONObject: log) {
            defaults.set(data, forKey: kTripLog)
        }
    }

    static func tripLog() -> [[String: Any]] {
        Array(rawTripLog().reversed())
    }

    private static func rawTripLog() -> [[String: Any]] {
        guard let data = defaults.data(forKey: kTripLog),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
        return arr
    }
}
