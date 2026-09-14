import Foundation

/// Single choke point both detectors call through to actually fire an alert.
/// Exists only for the "both" mode: Bluetooth and location are independent
/// signals that can each decide the same real parking moment is a trip end
/// (location's throttled delivery in particular can report "stopped" minutes
/// after Bluetooth already fired for the exact same trip). Without this, a
/// user on "both" mode could get two separate alerts for one trip.
enum TripGuardAlertCoordinator {
    static func fire() {
        if TripGuardStore.alertWasRecentlyFired() { return }
        TripGuardStore.markAlertFired()
        TripGuardNotifier.fireCheckCarAlert()
    }
}
