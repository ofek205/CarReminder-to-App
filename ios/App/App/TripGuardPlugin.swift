import Foundation
import Capacitor
import UserNotifications
import CoreLocation

/// TripGuard iOS bridge for the child-in-car safety reminder.
///
/// Mirrors the JS-facing method surface of the Android plugin
/// (android/.../tripguard/TripGuardPlugin.java) so src/lib/tripGuard/index.js
/// can call the same names on either platform. Where the platforms
/// genuinely differ (no device list on iOS, an extra `iosDetectionMode`
/// config field, a `location` permission that has no Android counterpart,
/// no battery-optimisation concept), this returns honest, harmless defaults
/// rather than pretending to match Android's shape exactly. See
/// TripGuardBluetoothMonitor.swift and TripGuardLocationMonitor.swift for the
/// actual detection mechanisms and their real platform limits: this file is
/// only the config/status/permissions bridge.
@objc(TripGuardPlugin)
public class TripGuardPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TripGuardPlugin"
    public let jsName = "TripGuard"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getConfig", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveConfig", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "snoozeOnce", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listPairedDevices", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getTripLog", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openBatterySettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelEscalation", returnType: CAPPluginReturnPromise),
    ]

    /// Runs on EVERY process launch, including a background relaunch that
    /// iOS triggers purely to deliver a significant-location-change update
    /// after the user force-quit the app: this project's Main.storyboard
    /// builds the window/root view controller (and with it, the Capacitor
    /// bridge and every plugin's load()) synchronously during
    /// didFinishLaunchingWithOptions, regardless of why the process was
    /// launched. That is what makes the "survives force-quit" guarantee on
    /// TripGuardLocationMonitor actually hold: a fresh CLLocationManager
    /// still has to ask to keep monitoring on each new process, exactly like
    /// a normal cold start would, and this is where that happens.
    override public func load() {
        TripGuardNotifier.registerCategory()
        applyRunningState()
    }

    @objc func getConfig(_ call: CAPPluginCall) {
        call.resolve(TripGuardStore.getConfig())
    }

    @objc func saveConfig(_ call: CAPPluginCall) {
        TripGuardStore.saveConfig(call.options as? [String: Any] ?? [:])
        applyRunningState()
        call.resolve()
    }

    @objc func enable(_ call: CAPPluginCall) {
        TripGuardStore.setEnabled(true)
        applyRunningState()
        call.resolve()
    }

    @objc func disable(_ call: CAPPluginCall) {
        TripGuardStore.setEnabled(false)
        applyRunningState()
        call.resolve()
    }

    @objc func snoozeOnce(_ call: CAPPluginCall) {
        TripGuardStore.setSnoozeNextTrip(true)
        call.resolve(["snoozed": true])
    }

    /// No device-list concept on iOS: AVAudioSession's route only exposes
    /// the CURRENTLY connected output, never a bonded/paired-devices list
    /// the way Android's BluetoothAdapter does, and there is nothing to list
    /// for location mode either. Kept as a real method (not just removed
    /// from the plugin) so the shared JS layer's listCarDevices() never has
    /// to special-case the platform: it already treats an empty array as
    /// "nothing to show".
    @objc func listPairedDevices(_ call: CAPPluginCall) {
        call.resolve(["devices": []])
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        let config = TripGuardStore.getConfig()
        let enabled = (config["enabled"] as? Bool) == true
        let wantsLoc = TripGuardStore.wantsLocation()

        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let notifGranted = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional

            var reasons: [String] = []
            if !enabled { reasons.append("DISABLED") }
            if !notifGranted { reasons.append("NOTIF_PERM") }

            let locStatus = TripGuardLocationMonitor.shared.authorizationSummary()
            if wantsLoc && locStatus != "granted" { reasons.append("LOCATION_PERM") }

            // BT_OFF / BT_PERM / NO_DEVICE never apply on iOS: there is no
            // adapter-state or per-device-permission API to check, and no
            // device list to be empty. Reporting a reason iOS can't actually
            // detect would be worse than reporting none: a red indicator
            // with no real fix available just teaches the user to distrust
            // "תקן עכשיו".
            let ret: [String: Any] = [
                "ready": reasons.isEmpty,
                "reasons": reasons,
                "btAdapterOn": true,
                "btPermission": "granted",
                "notifPermission": notifGranted ? "granted" : "denied",
                "locationPermission": locStatus,
                "batteryOptimized": false, // no equivalent concept on iOS
            ]
            call.resolve(ret)
        }
    }

    @objc func getTripLog(_ call: CAPPluginCall) {
        call.resolve(["entries": TripGuardStore.tripLog()])
    }

    @objc func openBatterySettings(_ call: CAPPluginCall) {
        // No equivalent on iOS: resolve as a harmless no-op, matching the
        // web mock's behaviour, so the JS caller never has to branch on it.
        call.resolve()
    }

    @objc func checkPermissions(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let notif = Self.notificationStatusString(settings.authorizationStatus)
            call.resolve([
                "notifications": notif,
                "location": TripGuardLocationMonitor.shared.authorizationSummary(),
            ])
        }
    }

    @objc func requestPermissions(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in
            let wantsLocation = TripGuardStore.wantsLocation()
            guard wantsLocation else {
                DispatchQueue.main.async { self.checkPermissions(call) }
                return
            }
            TripGuardLocationMonitor.shared.requestAlwaysAuthorization { _ in
                DispatchQueue.main.async { self.checkPermissions(call) }
            }
        }
    }

    /// Called from JS when the user taps "ACK" / "no kids" on the alert (see
    /// tripGuard/index.js's localNotificationActionPerformed listener): this
    /// app's LocalNotifications plugin already owns notification-tap
    /// routing, so that is how the tap reaches JS at all; this method is
    /// just the other half, clearing the pending escalation.
    @objc func cancelEscalation(_ call: CAPPluginCall) {
        TripGuardNotifier.cancelAlert()
        call.resolve()
    }

    // MARK: - helpers

    /// Starts/stops both monitors to match the current config. Safe to call
    /// repeatedly: both monitors' start() are idempotent.
    private func applyRunningState() {
        let config = TripGuardStore.getConfig()
        let enabled = (config["enabled"] as? Bool) == true

        if enabled && TripGuardStore.wantsBluetooth() {
            TripGuardBluetoothMonitor.shared.start()
        } else {
            TripGuardBluetoothMonitor.shared.stop()
        }

        if enabled && TripGuardStore.wantsLocation() {
            TripGuardLocationMonitor.shared.start()
        } else {
            TripGuardLocationMonitor.shared.stop()
        }
    }

    private static func notificationStatusString(_ status: UNAuthorizationStatus) -> String {
        switch status {
        case .authorized, .provisional, .ephemeral: return "granted"
        case .denied: return "denied"
        case .notDetermined: return "prompt"
        @unknown default: return "prompt"
        }
    }
}
