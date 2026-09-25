// ⚠️ EXCLUDED FROM THE BUILD SINCE 2026-09-25 (Ofek's decision: no child-safety
// reminder on iPhone for now, Android keeps it). TRIPGUARD_IOS is never
// defined, so nothing below is compiled. Kept, not deleted, so it can come
// back: define TRIPGUARD_IOS (Build Settings, Active Compilation Conditions),
// and lift the iOS gates in Settings.jsx and SafetyReminder.jsx together.
#if TRIPGUARD_IOS
import Foundation

/// Single choke point both detectors call through to actually fire an alert.
/// Exists only for the "both" mode: Bluetooth and location are independent
/// signals that can each decide the same real parking moment is a trip end
/// (location's throttled delivery in particular can report "stopped" minutes
/// after Bluetooth already fired for the exact same trip). Without this, a
/// user on "both" mode could get two separate alerts for one trip.
enum TripGuardAlertCoordinator {
    /// - Returns: whether an alert was actually raised. Callers log THIS, not
    ///   their own `willAlert` decision: in "both" mode the second detector
    ///   still decides an alert is warranted, and logging that as "נשלחה
    ///   תזכורת" would show two sends for one trip. The trip log is the
    ///   feature's transparency surface, so it has to say what happened, not
    ///   what was intended.
    @discardableResult
    static func fire() -> Bool {
        if TripGuardStore.alertWasRecentlyFired() { return false }
        TripGuardStore.markAlertFired()
        TripGuardNotifier.fireCheckCarAlert()
        return true
    }
}

#endif
