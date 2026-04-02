# Notification Service Implementation Plan for CarReminders

## Overview

This plan designs a comprehensive notification service for the CarReminders Hebrew RTL vehicle management app. The architecture uses @capacitor/local-notifications for device push notifications (no Firebase needed), Supabase tables for persistence, and an extensible channel abstraction for future email/WhatsApp support.

---

## Architecture

The system has four layers:

**React UI Layer** -- Dashboard (mounts scheduler hook), Notifications page (reads log), ReminderSettings page (saves prefs)

**useNotificationScheduler hook** -- On mount: calculates reminders and schedules local notifications. Re-runs when vehicles or settings change.

**notificationService.js** -- Core logic: requestPermission(), scheduleVehicleReminders(), cancelAllReminders(), logNotification() to Supabase, markNotificationRead()

**notificationChannels.js** -- Channel abstraction: localChannel (Capacitor local-notifications), emailChannel (future Supabase Edge Function), whatsappChannel (future WhatsApp Business API)

---

## Phase 1: Supabase Tables

### Table 1: reminder_settings

Columns:
- id: UUID primary key (gen_random_uuid)
- user_id: UUID NOT NULL references auth.users, UNIQUE constraint
- account_id: UUID references accounts (nullable)
- remind_test_days_before: INT DEFAULT 14
- remind_insurance_days_before: INT DEFAULT 14
- remind_document_days_before: INT DEFAULT 14
- remind_maintenance_days_before: INT DEFAULT 7
- remind_safety_days_before: INT DEFAULT 14
- overdue_repeat_every_days: INT DEFAULT 3
- daily_job_hour: INT DEFAULT 8 (0-23)
- push_enabled: BOOLEAN DEFAULT true
- email_test_reminders_enabled: BOOLEAN DEFAULT false
- email_insurance_reminders_enabled: BOOLEAN DEFAULT false
- email_document_reminders_enabled: BOOLEAN DEFAULT false
- created_at, updated_at: TIMESTAMPTZ DEFAULT now()

RLS: Users can SELECT/INSERT/UPDATE their own rows (auth.uid() = user_id).

### Table 2: notification_log

Columns:
- id: UUID primary key
- user_id: UUID NOT NULL references auth.users
- account_id: UUID references accounts (nullable)
- vehicle_id: UUID references vehicles (nullable, ON DELETE CASCADE)
- reminder_type: TEXT NOT NULL (test/insurance/document/safety/maintenance)
- notification_type: TEXT NOT NULL (Hebrew display label)
- title: TEXT NOT NULL
- message: TEXT NOT NULL
- due_date: DATE
- days_left: INT
- is_overdue: BOOLEAN DEFAULT false
- is_read: BOOLEAN DEFAULT false
- read_at: TIMESTAMPTZ
- channel: TEXT DEFAULT 'push' (push/in_app/email/whatsapp)
- created_at: TIMESTAMPTZ DEFAULT now()

RLS: Users can SELECT/INSERT/UPDATE their own rows.
Index: (user_id, is_read, created_at DESC)

### Update supabaseEntities.js (line 52-59)

Add: reminder_settings: makeEntity('reminder_settings') and notification_log: makeEntity('notification_log')

---

## Phase 2: Notification Channels Abstraction

### New file: src/lib/notificationChannels.js

local channel:
- available(): returns isNative from capacitor.js
- requestPermission(): Dynamic import @capacitor/local-notifications, call requestPermissions()
- schedule(notifications): Array of {id: number, title, body, scheduleAt: Date, extra}
- cancelAll(): Get pending then cancel all
- createChannel(): Android channel 'vehicle-reminders' with HIGH importance

email/whatsapp channels: Stubs with available() returning false.

Follows the dynamic import pattern used in src/lib/capacitor.js for Camera/Geolocation.

---

## Phase 3: Core Notification Service

### New file: src/lib/notificationService.js

Functions:

1. requestPermission() -- Returns { granted: boolean }

2. scheduleVehicleReminders(vehicles, documents, settings, userId, accountId):
   - Calls calcReminders() from ReminderEngine.js
   - For future reminders: schedules at daily_job_hour on the appropriate day
   - For overdue items: schedules repeating every overdue_repeat_every_days
   - Generates stable numeric ID via djb2 hash (Capacitor requires numeric IDs)
   - cancelAll() first, then schedule all, then log to notification_log

3. cancelAllReminders()
4. markNotificationRead(id) -- Updates is_read=true, read_at=now
5. getNotificationHistory(userId) -- Reads notification_log DESC
6. initNotificationListeners() -- Tap handler navigates to relevant page

Stable ID generation: djb2 hash producing 31-bit positive integer from string.
Scheduling window: 30 days ahead max.

---

## Phase 4: Notification Scheduler Hook

### New file: src/hooks/useNotificationScheduler.js

useEffect with deps [vehicles, documents, settings, isGuest, user, accountId]:
- Gates: isNative AND !isGuest AND vehicles.length AND user
- Requests permission once (useRef guard)
- Calls scheduleVehicleReminders with current data
- No cleanup needed (OS manages notifications)

Integration: Called from Dashboard.jsx after vehicles query (~line 446).

---

## Phase 5: Fix AuthNotifications in Notifications.jsx

Current bug: Line 210 queryFn returns empty array.

Solution -- rewrite AuthNotifications to:
1. Resolve accountId via account_members (same pattern as Dashboard lines 390-407)
2. useQuery for vehicles: db.vehicles.filter({ account_id })
3. useQuery for reminder_settings: db.reminder_settings.filter({ user_id })
4. Call calcReminders({ vehicles, documents: [], settings })
5. Transform reminders to NotifCard format (same Hebrew message patterns as GuestNotifications lines 136-153)
6. Query notification_log for read state, merge with computed reminders
7. markAsRead: update or insert notification_log entry

---

## Phase 6: Fix AuthReminderSettings in ReminderSettingsPage.jsx

Current bug: TODOs at lines 163-169 (load) and 188-191 (save).

Load: db.reminder_settings.filter({ user_id }), create defaults if empty.
Save: db.reminder_settings.update(settingsId, payload) with try/catch.
New: Push notification toggle Switch calling requestPermission() on enable.

---

## Phase 7: Capacitor Configuration

Install: npm install @capacitor/local-notifications && npx cap sync android

capacitor.config.ts -- add to plugins:
- LocalNotifications: { smallIcon: 'ic_stat_icon_config_sample', iconColor: '#2D5233', sound: 'default' }

Notification icon: Monochrome white drawables (mdpi through xxhdpi). Generate via existing build:icons script.

---

## Phase 8: Integration Points

Dashboard.jsx: Add useNotificationScheduler hook + reminder_settings query.
main.jsx: Add initNotificationListeners() call alongside existing init calls (lines 13-15).
Layout.jsx: Optional unread badge on Bell nav item.

---

## Implementation Sequence

1. Database tables + supabaseEntities.js update
2. Fix AuthReminderSettings (lowest risk)
3. Fix AuthNotifications (in-app center)
4. Install plugin + notificationChannels.js
5. Create notificationService.js
6. Create useNotificationScheduler hook + Dashboard wiring
7. Capacitor config + Android icon assets
8. Polish: badge, edge cases, RTL device testing

---

## Constraints and Edge Cases

- Guest: in-app only. Device notifications auth-only.
- Hebrew RTL: Android handles correctly with Hebrew locale.
- ID collisions: Negligible at ~100 reminders scale.
- Re-scheduling: Idempotent (cancelAll before schedule).
- 30-day window: Further items caught on next app open.
- Documents: Not in supabaseEntities yet; service handles [].
- Offline: Local notifications fire via Android AlarmManager.

---

## Future Extensions (Not in Scope)

- Email: Supabase Edge Function + Resend/SendGrid
- WhatsApp: WhatsApp Business API
- Multi-user: Notify all account_members
- Web push: Service worker + Web Push API
