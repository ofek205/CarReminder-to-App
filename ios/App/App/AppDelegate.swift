import UIKit
import Capacitor
import WebKit

// ─────────────────────────────────────────────────────────────────────
// CarReminder native boot watchdog
//
// Why this exists:
//   The web side has watchdogs (7s auth + 8s splash safety in main.jsx),
//   but they only fire if the JS bundle loads. On iOS 26.x WKWebView has
//   shipped two regressions where the WebContent process either fails
//   to start or fails to load `capacitor://localhost/index.html`. In
//   those cases the user is stuck on LaunchScreen.storyboard with no
//   web-side recovery possible — and on TestFlight without USB / web
//   inspector we have no way to even diagnose it.
//
//   This native watchdog:
//     1. Records each AppDelegate lifecycle event to UserDefaults so a
//        next-launch reader (or a support engineer reading the device
//        backup) can reconstruct what happened.
//     2. Polls the WebView via evaluateJavaScript at 8s and 16s after
//        launch. If JS is not responding (the web bundle hung or never
//        loaded) it presents a native UIAlertController with the boot
//        log and a relaunch button — never letting the user stare at
//        a frozen splash forever.
//     3. Copies the diagnostic snapshot to UIPasteboard when the user
//        taps "Copy diagnostics" so they can paste it into
//        WhatsApp / email / Telegram and send to support.
//
// Design constraints:
//   - Never block didFinishLaunchingWithOptions. All work is async.
//   - Never crash on a Capacitor API change. Defensive casts only.
//   - All UI strings have Hebrew + English fallback.
//   - Zero third-party deps. UIKit + WebKit + Foundation only.
// ─────────────────────────────────────────────────────────────────────

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    // Watchdog deadlines (seconds since launch).
    private let firstCheckSeconds: TimeInterval = 8
    private let finalCheckSeconds: TimeInterval = 16

    // UserDefaults key for the rolling native boot log.
    private let nativeLogKey = "cr_native_boot_log"
    private let nativeLogMaxEntries = 30

    // Avoid showing the alert twice if the second poll also fires.
    private var hangAlertShown = false

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        recordNativeStage("did_finish_launching")
        scheduleWatchdog()
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        recordNativeStage("will_resign_active")
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        recordNativeStage("did_enter_background")
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        recordNativeStage("will_enter_foreground")
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        recordNativeStage("did_become_active")
    }

    func applicationWillTerminate(_ application: UIApplication) {
        recordNativeStage("will_terminate")
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    // ─────────────────────────────────────────────────────────────────
    // APNs registration callbacks — wired to @capacitor/push-notifications.
    //
    // The plugin observes these NotificationCenter posts (it does NOT
    // call the AppDelegate methods directly), so all we have to do is
    // re-broadcast the OS callbacks under the keys the plugin listens
    // for. Without this, PushNotifications.register() in JS hangs
    // forever waiting for a `registration` event that never fires.
    // ─────────────────────────────────────────────────────────────────

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    // ─────────────────────────────────────────────────────────────────
    // Native boot log — append-only, capped, written to UserDefaults.
    // ─────────────────────────────────────────────────────────────────

    private func recordNativeStage(_ stage: String, extra: [String: Any]? = nil) {
        var entry: [String: Any] = [
            "stage": stage,
            "ts": Date().timeIntervalSince1970,
        ]
        if let extra = extra { entry["extra"] = extra }

        var log = (UserDefaults.standard.array(forKey: nativeLogKey) as? [[String: Any]]) ?? []
        log.append(entry)
        if log.count > nativeLogMaxEntries {
            log = Array(log.suffix(nativeLogMaxEntries))
        }
        UserDefaults.standard.set(log, forKey: nativeLogKey)
    }

    // ─────────────────────────────────────────────────────────────────
    // Watchdog — checks if the WebView's JS is alive at 8s + 16s.
    // ─────────────────────────────────────────────────────────────────

    private func scheduleWatchdog() {
        DispatchQueue.main.asyncAfter(deadline: .now() + firstCheckSeconds) { [weak self] in
            self?.runHeartbeatCheck(label: "first")
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + finalCheckSeconds) { [weak self] in
            self?.runHeartbeatCheck(label: "final")
        }
    }

    private func runHeartbeatCheck(label: String) {
        guard !hangAlertShown else { return }
        guard let webView = findWebView() else {
            recordNativeStage("watchdog_no_webview", extra: ["label": label])
            if label == "final" { showHangAlert(reason: "WebView not found") }
            return
        }
        // Probe: does JS respond? `__crGetBootSnapshotSync` is registered
        // by main.jsx as one of the very first things — if it's null
        // here, JS isn't running at all.
        let probe = "(() => { try { return window.__crGetBootSnapshotSync ? 'alive' : 'no-snapshot-fn'; } catch(e) { return 'throw:' + (e && e.message); } })()"
        webView.evaluateJavaScript(probe) { [weak self] result, error in
            guard let self = self else { return }
            let resultStr = (result as? String) ?? "<nil>"
            let errStr = error?.localizedDescription ?? "<no error>"
            self.recordNativeStage("watchdog_probe", extra: [
                "label": label,
                "result": resultStr,
                "error": errStr,
            ])
            if resultStr != "alive" && label == "final" {
                self.showHangAlert(reason: "JS heartbeat: \(resultStr) / err: \(errStr)")
            }
        }
    }

    private func findWebView(in view: UIView? = nil) -> WKWebView? {
        let root: UIView? = view ?? window?.rootViewController?.view
        guard let root = root else { return nil }
        if let wv = root as? WKWebView { return wv }
        for sub in root.subviews {
            if let wv = sub as? WKWebView { return wv }
            if let nested = findWebView(in: sub) { return nested }
        }
        return nil
    }

    // ─────────────────────────────────────────────────────────────────
    // Native fallback alert — only path the user has when WebView dies.
    // ─────────────────────────────────────────────────────────────────

    private func showHangAlert(reason: String) {
        guard !hangAlertShown else { return }
        hangAlertShown = true
        recordNativeStage("hang_alert_shown", extra: ["reason": reason])

        let title = "האפליקציה לא נטענה / App didn't load"
        let body = """
        משהו השתבש בטעינה. אנא נסה להפעיל מחדש או שלח אבחון לתמיכה.

        Something prevented the app from loading. Please relaunch or send diagnostics.

        Reason: \(reason)
        """
        let alert = UIAlertController(title: title, message: body, preferredStyle: .alert)

        alert.addAction(UIAlertAction(title: "העתק אבחון לתמיכה / Copy diagnostics", style: .default, handler: { [weak self] _ in
            self?.copyDiagnosticsToPasteboard()
            // Re-show the alert after copy so the user can choose another action.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
                self?.hangAlertShown = false
                self?.showCopiedConfirmation()
            }
        }))

        alert.addAction(UIAlertAction(title: "הפעל מחדש / Relaunch", style: .destructive, handler: { _ in
            // exit(0) is the only reliable way to restart a stuck WebView
            // process from inside the app. iOS will surface the launch
            // image again; if the underlying issue (network/cache) was
            // transient, the second launch usually succeeds.
            exit(0)
        }))

        alert.addAction(UIAlertAction(title: "סגור / Close", style: .cancel, handler: { [weak self] _ in
            self?.hangAlertShown = false
        }))

        presentTopmost(alert)
    }

    private func showCopiedConfirmation() {
        let alert = UIAlertController(
            title: "האבחון הועתק",
            message: "הדבק בוואטסאפ / מייל ושלח לתמיכה.\nDiagnostics copied — paste into WhatsApp / email.",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "אישור / OK", style: .default))
        presentTopmost(alert)
    }

    private func copyDiagnosticsToPasteboard() {
        var payload: [String: Any] = [
            "app": "CarReminder",
            "bundleId": Bundle.main.bundleIdentifier ?? "",
            "version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "",
            "build": Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "",
            "iosVersion": UIDevice.current.systemVersion,
            "device": deviceModelIdentifier(),
            "timestamp": ISO8601DateFormatter().string(from: Date()),
            "nativeLog": UserDefaults.standard.array(forKey: nativeLogKey) ?? [],
        ]
        // Best-effort: include the JS-side boot snapshot if alive.
        if let webView = findWebView() {
            // synchronous paste — don't await JS roundtrip; if we got here
            // JS is most likely dead anyway. Add an async tail-flush.
            UIPasteboard.general.string = jsonString(from: payload)
            webView.evaluateJavaScript("(() => { try { return JSON.stringify(window.__crGetBootSnapshotSync ? window.__crGetBootSnapshotSync() : null); } catch(e) { return null; } })()") { result, _ in
                if let snapStr = result as? String, snapStr != "null" {
                    payload["jsSnapshot"] = snapStr
                    UIPasteboard.general.string = self.jsonString(from: payload)
                }
            }
        } else {
            UIPasteboard.general.string = jsonString(from: payload)
        }
    }

    private func jsonString(from obj: [String: Any]) -> String {
        guard JSONSerialization.isValidJSONObject(obj),
              let data = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted]),
              let str = String(data: data, encoding: .utf8) else {
            return "<failed-to-serialize>"
        }
        return str
    }

    private func deviceModelIdentifier() -> String {
        var sysinfo = utsname()
        uname(&sysinfo)
        let machine = withUnsafePointer(to: &sysinfo.machine) {
            $0.withMemoryRebound(to: CChar.self, capacity: 1) { String(validatingUTF8: $0) ?? "" }
        }
        return machine
    }

    private func presentTopmost(_ vc: UIViewController) {
        guard let root = window?.rootViewController else { return }
        var top = root
        while let presented = top.presentedViewController { top = presented }
        top.present(vc, animated: true, completion: nil)
    }
}
