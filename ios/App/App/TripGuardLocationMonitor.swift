import Foundation
import CoreLocation

/// TripGuard's location-based trip detector for iOS.
///
/// This is the ONLY one of the two iOS mechanisms that can relaunch a fully
/// force-quit app: CLLocationManager's significant-change service is one of
/// the small, closed set of things Apple lets wake a terminated process
/// (region monitoring is the other; neither has a Bluetooth-Classic or
/// audio-route equivalent). That is the entire reason this exists alongside
/// TripGuardBluetoothMonitor rather than instead of it.
///
/// It is a PROXY for "you parked", not a direct signal like Bluetooth
/// connect/disconnect, with two real costs the UI must state honestly:
///   1. Requires "Always" location authorization, a much bigger, more
///      Apple-scrutinised ask than anything the Bluetooth path or Android
///      need.
///   2. Significant-change updates are throttled by iOS (roughly every
///      several hundred metres or on a cell-tower handoff), so detecting
///      "you just stopped" can legitimately lag real life by minutes, not
///      seconds.
///
/// Algorithm: track a simple driving/stopped state from each update's
/// reported `speed` (m/s; iOS reports -1 when a fix has no valid speed,
/// which is deliberately ignored rather than treated as "stopped": treating
/// a bad fix as a stop is exactly how a safety feature goes silently wrong).
final class TripGuardLocationMonitor: NSObject, CLLocationManagerDelegate {
    static let shared = TripGuardLocationMonitor()
    private override init() { super.init() }

    // Held statically (via the singleton) so the delegate isn't deallocated
    // between calls, including across a background relaunch.
    private lazy var manager: CLLocationManager = {
        let m = CLLocationManager()
        m.delegate = self
        return m
    }()

    // m/s. ~7.2 km/h / ~3.6 km/h: wide gap between the two thresholds so
    // ordinary GPS jitter while stationary can't flip the state back and
    // forth and fire spurious alerts.
    private let drivingSpeedThreshold = 2.0
    private let stoppedSpeedThreshold = 1.0

    /// Callback used only by requestAlwaysAuthorization(); nil the rest of
    /// the time. CLLocationManager has no async/await API on this SDK floor.
    private var pendingAlwaysUpgrade: ((CLAuthorizationStatus) -> Void)?

    /// CLLocationManager calls that touch OS state or can present UI must run
    /// on the main thread; every entry point below hops there rather than
    /// trusting each caller to remember (callers include Capacitor plugin
    /// methods, which run off-main by default).
    func start() {
        DispatchQueue.main.async {
            guard self.manager.authorizationStatus == .authorizedAlways else { return }
            self.manager.startMonitoringSignificantLocationChanges()
        }
    }

    func stop() {
        DispatchQueue.main.async {
            self.manager.stopMonitoringSignificantLocationChanges()
        }
    }

    // MARK: - Permission

    func authorizationSummary() -> String {
        switch manager.authorizationStatus {
        case .authorizedAlways: return "granted"
        case .authorizedWhenInUse: return "whenInUseOnly"
        case .denied, .restricted: return "denied"
        case .notDetermined: return "prompt"
        @unknown default: return "prompt"
        }
    }

    /// Runs the two-step iOS dance: request "when in use" first if never
    /// asked, then request the "always" upgrade. Apple only shows the
    /// upgrade prompt once when-in-use is already granted; calling
    /// requestAlwaysAuthorization() before that is a silent no-op, which is
    /// exactly the trap this function exists to avoid.
    func requestAlwaysAuthorization(completion: @escaping (CLAuthorizationStatus) -> Void) {
        DispatchQueue.main.async {
            switch self.manager.authorizationStatus {
            case .authorizedAlways, .denied, .restricted:
                completion(self.manager.authorizationStatus)
            case .notDetermined:
                self.pendingAlwaysUpgrade = completion
                self.manager.requestWhenInUseAuthorization()
            case .authorizedWhenInUse:
                self.pendingAlwaysUpgrade = completion
                self.manager.requestAlwaysAuthorization()
            @unknown default:
                completion(self.manager.authorizationStatus)
            }
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        if status == .authorizedWhenInUse, pendingAlwaysUpgrade != nil {
            // First half of the dance just completed: ask for the upgrade.
            manager.requestAlwaysAuthorization()
            return
        }
        if let cb = pendingAlwaysUpgrade {
            pendingAlwaysUpgrade = nil
            cb(status)
        }
        if status == .authorizedAlways, TripGuardStore.getConfig()["enabled"] as? Bool == true, TripGuardStore.wantsLocation() {
            start()
        }
    }

    // MARK: - Detection

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last, location.speed >= 0 else { return } // negative speed = invalid fix, ignore
        let nowWall = Date()
        let nowUptime = ProcessInfo.processInfo.systemUptime
        let wasDriving = TripGuardStore.isLocDriving()

        if !wasDriving && location.speed >= drivingSpeedThreshold {
            TripGuardStore.setLocDriving(true)
            TripGuardStore.setLocTripStart(wall: nowWall, uptime: nowUptime)
            return
        }

        if wasDriving && location.speed <= stoppedSpeedThreshold {
            TripGuardStore.setLocDriving(false)
            let config = TripGuardStore.getConfig()
            let startWall = TripGuardStore.locTripStartWall()
            let startUptime = TripGuardStore.locTripStartUptime()
            let snoozed = TripGuardStore.isSnoozeNextTrip()
            TripGuardStore.setSnoozeNextTrip(false)

            let willAlert = !snoozed && TripGuardWindow.shouldAlert(
                config: config, tripStartWall: startWall, now: nowWall,
                tripStartUptime: startUptime, nowUptime: nowUptime
            )
            let didAlert = willAlert && TripGuardAlertCoordinator.fire()
            TripGuardStore.appendTripLog(at: nowWall, alerted: didAlert)
        }
    }
}
