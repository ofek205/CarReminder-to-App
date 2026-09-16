import Foundation
import AVFoundation

/// TripGuard's Bluetooth-based trip detector for iOS.
///
/// iOS never exposes Bluetooth Classic (the profile car head units use for
/// audio/hands-free) to third-party apps at all: Core Bluetooth is BLE-only.
/// The closest real signal an app can get is AVAudioSession telling it the
/// system AUDIO ROUTE changed to/from a Bluetooth device, which is what this
/// class listens for.
///
/// HARD LIMITATION, load-bearing for the whole feature's honesty: this
/// notification is delivered via NotificationCenter to a running process
/// only. There is no background-mode or entitlement that lets AVAudioSession
/// route-change notifications relaunch a force-quit app (unlike Android's
/// manifest BroadcastReceiver, which the OS itself re-instantiates the
/// process for). A `UIBackgroundModes: audio` declaration paired with a
/// genuinely-looping (even silent) player COULD keep the process alive
/// longer in the background, but deliberately isn't done here: Apple's App
/// Review Guideline 2.5.4 explicitly targets exactly that "declare audio,
/// play nothing real" pattern, and risking an app-wide rejection for one
/// safety feature's convenience is not a trade this file makes unilaterally.
/// The practical consequence: this mechanism is realistically foreground-only
/// today. `SafetyReminder.jsx` must say so plainly, not just in a code
/// comment nobody using the app will ever read.
final class TripGuardBluetoothMonitor {
    static let shared = TripGuardBluetoothMonitor()
    private init() {}

    private var observer: NSObjectProtocol?
    private var isCarConnected = false

    private static let bluetoothPortTypes: Set<AVAudioSession.Port> = [.bluetoothA2DP, .bluetoothHFP, .bluetoothLE]
    // Same loose heuristic as looksLikeEarbuds() in SafetyReminder.jsx, kept
    // in sync deliberately: iOS has no device picker to catch this instead.
    private static let earbudsPattern = try? NSRegularExpression(pattern: "airpod|buds|headphone|אוזני", options: .caseInsensitive)

    func start() {
        guard observer == nil else { return }
        // Configuring (not necessarily *activating*) a session category is
        // enough to receive route-change notifications; it does not require
        // playing audio or declaring a background mode.
        try? AVAudioSession.sharedInstance().setCategory(.ambient, options: [.mixWithOthers])
        isCarConnected = Self.currentRouteHasBluetoothCar()
        observer = NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            self?.handleRouteChange(note)
        }
    }

    func stop() {
        if let observer = observer { NotificationCenter.default.removeObserver(observer) }
        observer = nil
    }

    private func handleRouteChange(_ note: Notification) {
        let carConnectedNow = Self.currentRouteHasBluetoothCar()
        guard carConnectedNow != isCarConnected else { return } // e.g. earbuds swap while car stays connected
        let wasConnected = isCarConnected
        isCarConnected = carConnectedNow

        let nowWall = Date()
        let nowUptime = ProcessInfo.processInfo.systemUptime

        if !wasConnected && carConnectedNow {
            // Connected: start of trip. No debounce needed here the way
            // Android's receiver needs one: AVAudioSession route flapping
            // within the same drive doesn't reset anything mid-trip because
            // we only act on Bluetooth-car presence transitions, and a brief
            // drop-then-reconnect simply never crosses back to "disconnected"
            // in between if it's fast enough for AVAudioSession to coalesce.
            // A genuine flap that DOES report disconnect+reconnect is handled
            // like Android: the trip-start value below is only overwritten on
            // an actual reconnect, not cleared on disconnect (see below).
            TripGuardStore.setBtTripStart(wall: nowWall, uptime: nowUptime)
            return
        }

        if wasConnected && !carConnectedNow {
            // Disconnected: possible end of trip.
            let config = TripGuardStore.getConfig()
            let startWall = TripGuardStore.btTripStartWall()
            let startUptime = TripGuardStore.btTripStartUptime()
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

    /// True if the CURRENT audio route includes a Bluetooth output that
    /// doesn't look like earbuds/headphones.
    private static func currentRouteHasBluetoothCar() -> Bool {
        let outputs = AVAudioSession.sharedInstance().currentRoute.outputs
        return outputs.contains { port in
            guard bluetoothPortTypes.contains(port.portType) else { return false }
            return !looksLikeEarbuds(port.portName)
        }
    }

    private static func looksLikeEarbuds(_ name: String) -> Bool {
        guard let regex = earbudsPattern else { return false }
        return regex.firstMatch(in: name, range: NSRange(name.startIndex..., in: name)) != nil
    }
}
