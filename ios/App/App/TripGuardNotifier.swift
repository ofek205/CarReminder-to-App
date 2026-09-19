import Foundation
import UserNotifications

/// Fires the "check the car" safety alert on iOS. Swift twin of
/// android/.../tripguard/TripGuardNotifier.java, adapted to how Capacitor's
/// iOS bridge actually routes notification taps (see the long comment on
/// `registerCategory()` below: this is the one part of the design with no
/// Android equivalent at all).
///
/// Scheduling a `UNNotificationRequest` does NOT require being the
/// `UNUserNotificationCenterDelegate`, only reacting to a tap does. This app
/// already has @capacitor/local-notifications installed, and its plugin
/// claims that delegate slot for itself (`bridge.notificationRouter
/// .localNotificationHandler`, see LocalNotificationsPlugin.swift's load()).
/// Writing a second, competing delegate here would silently break whichever
/// one loads last (Capacitor's own reminder notifications, or this feature).
/// So this deliberately schedules notifications directly via
/// UNUserNotificationCenter, and leaves ALL tap-handling to the existing
/// LocalNotifications plugin's own routing, which already relays every
/// action tap to JS as a `localNotificationActionPerformed` event. See
/// SafetyReminder.jsx / tripGuard/index.js for the JS-side listener that
/// reacts to OUR category's action IDs and calls back into
/// TripGuardPlugin.cancelEscalation().
enum TripGuardNotifier {
    static let categoryId = "TRIPGUARD_ALERT"
    static let alertId = "tripguard-alert"
    static let escalateId = "tripguard-escalate"
    static let actionAck = "tripguard_ack"
    static let actionNoKids = "tripguard_no_kids"

    /// Call once at process launch (AppDelegate). Registering the category
    /// again on every launch is idempotent and cheap; UNUserNotificationCenter
    /// replaces the prior definition.
    static func registerCategory() {
        let ack = UNNotificationAction(identifier: actionAck, title: "בדקתי, הכל בסדר", options: [])
        let noKids = UNNotificationAction(identifier: actionNoKids, title: "אין ילדים ברכב", options: [])
        let category = UNNotificationCategory(
            identifier: categoryId,
            actions: [ack, noKids],
            intentIdentifiers: [],
            options: []
        )
        let center = UNUserNotificationCenter.current()
        center.getNotificationCategories { existing in
            // Explicit Set type: Swift has both a Sequence.filter (returns an
            // Array) and a Set.filter (returns a Set) in scope here, and the
            // Array one would make the insert() below fail to compile. Also
            // note this preserves every OTHER app category rather than
            // replacing the whole list, so @capacitor/local-notifications'
            // own action types survive.
            var all: Set<UNNotificationCategory> = existing.filter { $0.identifier != categoryId }
            all.insert(category)
            center.setNotificationCategories(all)
        }
    }

    /// First alert + a single escalation scheduled up front. iOS has no
    /// AlarmManager-style "wake my code at T+30s" primitive that's simpler
    /// than a second notification request: the OS delivers the escalation
    /// on schedule even if this process never runs again, which is actually
    /// a stronger guarantee than Android's approach needs. Cancelled instead
    /// if the user acts first (see cancelEscalation()).
    static func fireCheckCarAlert() {
        show(escalated: false, identifier: alertId, delaySeconds: nil)
        scheduleEscalation()
    }

    private static func scheduleEscalation() {
        show(escalated: true, identifier: escalateId, delaySeconds: 30)
    }

    /// User acted (ACK / no kids): clear the alert and the pending escalation.
    static func cancelAlert() {
        let center = UNUserNotificationCenter.current()
        center.removeDeliveredNotifications(withIdentifiers: [alertId])
        center.removePendingNotificationRequests(withIdentifiers: [escalateId])
    }

    private static func show(escalated: Bool, identifier: String, delaySeconds: TimeInterval?) {
        let content = UNMutableNotificationContent()
        content.title = escalated ? "עדיין לא בדקת את הרכב" : "סיימת נסיעה"
        content.body = "ודא שכל הילדים ירדו מהרכב"
        content.sound = .default
        content.categoryIdentifier = categoryId
        // Picked up by LocalNotificationsHandler.makeNotificationRequestJSObject
        // as `notification.extra`, letting the JS listener tell a TripGuard
        // action apart from every other reminder using the same delegate.
        content.userInfo = ["type": "tripguard"]

        let trigger: UNNotificationTrigger?
        if let delay = delaySeconds {
            trigger = UNTimeIntervalNotificationTrigger(timeInterval: delay, repeats: false)
        } else {
            trigger = nil // nil trigger = deliver as soon as possible
        }

        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: trigger)
        UNUserNotificationCenter.current().add(request) { error in
            if let error = error {
                // Never let a scheduling failure crash the detector; the
                // in-app status/trip-log already give the user a way to
                // notice detection isn't working.
                NSLog("[TripGuard] failed to schedule notification: \(error.localizedDescription)")
            }
        }
    }
}
