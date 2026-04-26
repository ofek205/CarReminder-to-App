/**
 * NotificationBell — authenticated-only bell icon + dropdown.
 *
 * Lives in its own module (previously a 568-line inner function in
 * Layout.jsx) so Vite can emit a separate chunk and Layout's initial
 * bundle gets meaningfully smaller. Guest users never render this, and
 * even authenticated users don't need the code parsed until the header
 * paints.
 *
 * No behavior change from the inline version — same queries, same
 * localStorage keys ('read_notif_ids', 'read_notif_timed',
 * 'dismissed_notif_ids', 'carreminder_mileage_dates',
 * 'winter_dismissed_{year}', 'sailing_dismissed_{year}'), same UI.
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/shared/GuestContext';
import { Bell, User, FileText, MessageSquare, AlertTriangle, Wrench, Gauge, X } from 'lucide-react';
import { differenceInYears, subMonths } from 'date-fns';
import { configForType as appConfigForType } from '@/lib/appNotificationConfig';

export default function NotificationBell() {
  const [notifications, setNotifications] = useState([]);
  const [readIds, setReadIds] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('read_notif_ids') || '[]');
      // Check timed reads. remove expired ones (older than 7 days)
      const timedReads = JSON.parse(localStorage.getItem('read_notif_timed') || '{}');
      const now = Date.now();
      const validTimedIds = Object.entries(timedReads)
        .filter(([_, ts]) => now - ts < 7 * 24 * 60 * 60 * 1000)
        .map(([id]) => id);
      return new Set([...stored, ...validTimedIds]);
    } catch { return new Set(); }
  });
  const [popupOpen, setPopupOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    // Debounced refetch trigger. Three different events feed this
    // pipeline (profile saves, custom dispatches, realtime
    // notifications) and they often fire back-to-back — a profile
    // save dispatches both userProfileUpdated AND profileSaved, and a
    // realtime burst can deliver several share-changed events in one
    // tick. Without this, the bell's full 4-table fetch cascade
    // (~30-50KB) ran 3-5× in a single second. 300ms collapses the
    // burst into one refetch while still feeling instant.
    let timer = null;
    const handler = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setRefreshKey(k => k + 1), 300);
    };
    window.addEventListener('userProfileUpdated', handler);
    window.addEventListener('profileSaved', handler);
    // Fired by useSharedVehicleRealtime when a new app_notifications
    // row arrives via Supabase realtime — bumps the bell so the new
    // share/vehicle-change/etc lights up without a manual refresh.
    window.addEventListener('cr:notifications-changed', handler);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('userProfileUpdated', handler);
      window.removeEventListener('profileSaved', handler);
      window.removeEventListener('cr:notifications-changed', handler);
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const { db } = await import('@/lib/supabaseEntities');
        const [profilesResult, membersResult, settingsResult] = await Promise.all([
          db.user_profiles.filter({ user_id: user.id }).catch(() => []),
          db.account_members.filter({ user_id: user.id, status: 'פעיל' }).catch(() => []),
          db.reminder_settings.filter({ user_id: user.id }).catch(() => []),
        ]);

        const profileNotifs = [];
        const profile = profilesResult.length > 0 ? profilesResult[0] : null;
        if (!profile || !profile.phone) {
          profileNotifs.push({
            id: 'profile-incomplete', vehicleId: null, type: 'profile',
            label: 'השלם פרטים אישיים',
            name: 'הוסף טלפון ותאריך לידה באזור האישי',
            days: -999, isExpired: false,
          });
        }
        if (profile?.license_expiration_date) {
          const licDays = Math.ceil((new Date(profile.license_expiration_date) - new Date()) / 86400000);
          if (licDays <= 30) {
            profileNotifs.push({
              id: 'license-expiry', vehicleId: null, type: 'license',
              label: licDays < 0 ? 'רישיון נהיגה פג תוקף!' : `רישיון נהיגה בעוד ${licDays} ימים`,
              name: 'עדכן באזור האישי',
              days: licDays, isExpired: licDays < 0,
            });
          }
        }
        setNotifications(prev => {
          const withoutProfile = prev.filter(n => n.id !== 'profile-incomplete' && n.id !== 'license-expiry');
          return [...profileNotifs, ...withoutProfile];
        });

        if (membersResult.length === 0) return;
        // Bell only reads dates and labels off each vehicle — never
        // photos, notes, or any base64 column. Restricting to the
        // exact 11 columns used below shaves the per-vehicle payload
        // from ~50-200 KB (because of vehicle_photo) to a few hundred
        // bytes. Multiplied across an account's vehicles + every
        // refresh, this is the bell's biggest single egress win.
        const BELL_COLS = [
          'id', 'nickname', 'manufacturer', 'year', 'vehicle_type',
          'is_vintage',
          // expiry dates the bell renders
          'test_due_date', 'insurance_due_date',
          'pyrotechnics_expiry_date', 'fire_extinguisher_expiry_date',
          'life_raft_expiry_date',
          // mileage-driven reminders (tires, service, "no update" warning)
          'current_km', 'current_engine_hours',
          'last_tire_change_date', 'km_since_tire_change',
          'km_baseline', 'last_shipyard_date',
          'km_update_date', 'engine_hours_update_date',
        ].join(',');
        const vehicles = await db.vehicles.filter(
          { account_id: membersResult[0].account_id },
          { select: BELL_COLS },
        );
        const threshold = (settingsResult.length > 0 && settingsResult[0].remind_test_days_before) || 14;

        let mileageDates = {};
        try {
          const parsed = JSON.parse(localStorage.getItem('carreminder_mileage_dates') || '{}');
          mileageDates = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
        } catch (err) {
          if (import.meta.env?.DEV) console.warn('[NotificationBell] mileage_dates corrupt:', err?.message);
        }

        const items = [];
        const now = new Date();
        const isVesselVeh = (v) => ['כלי שייט','מפרשית','סירה מנועית','אופנוע ים','סירת גומי'].includes(v.vehicle_type);
        const addNotif = (id, vehicleId, type, label, name, days, navTarget) => {
          items.push({ id, vehicleId, type, label, name, days, isExpired: days < 0, navTarget });
        };
        const daysTo = (dateStr) => dateStr ? Math.ceil((new Date(dateStr) - now) / 86400000) : null;

        vehicles.forEach(v => {
          const name = v.nickname || v.manufacturer || 'רכב';
          const isVessel = isVesselVeh(v);
          const testWord = isVessel ? 'כושר שייט' : 'טסט';
          const vehicleAge = v.year ? now.getFullYear() - Number(v.year) : 0;
          const isVintage = !isVessel && (v.is_vintage || vehicleAge >= 30 || v.vehicle_type === 'רכב אספנות');

          if (v.test_due_date) {
            let nextTestDate = new Date(v.test_due_date);
            if (isVintage && nextTestDate > now) {
              // subMonths handles month-length edge cases (Mar 31 - 6mo =
              // Sep 30, not Oct 1 as naive setMonth can produce). Matches
              // the fix in ReminderEngine.js.
              const halfTest = subMonths(nextTestDate, 6);
              if (halfTest > now) nextTestDate = halfTest;
            }
            const testDays = Math.ceil((nextTestDate - now) / 86400000);
            const vintageLabel = isVintage ? ' (אספנות)' : '';
            if (testDays <= threshold) {
              addNotif(`test-${v.id}`, v.id, 'test',
                testDays < 0 ? `${testWord} פג תוקף!${vintageLabel}` : `${testWord} בעוד ${testDays} ימים${vintageLabel}`,
                name, testDays, 'VehicleDetail');
            }
          }

          const insDays = daysTo(v.insurance_due_date);
          if (insDays !== null && insDays <= threshold) {
            addNotif(`ins-${v.id}`, v.id, 'insurance',
              insDays < 0 ? 'ביטוח פג תוקף!' : `ביטוח בעוד ${insDays} ימים`,
              name, insDays, 'VehicleDetail');
          }

          if (isVessel) {
            const pyroDays = daysTo(v.pyrotechnics_expiry_date);
            if (pyroDays !== null && pyroDays <= threshold) {
              addNotif(`pyro-${v.id}`, v.id, 'safety',
                pyroDays < 0 ? 'פירוטכניקה פג תוקף!' : `פירוטכניקה בעוד ${pyroDays} ימים`,
                name, pyroDays, 'VehicleDetail');
            }
            const extDays = daysTo(v.fire_extinguisher_expiry_date);
            if (extDays !== null && extDays <= threshold) {
              addNotif(`ext-${v.id}`, v.id, 'safety',
                extDays < 0 ? 'מטף כיבוי פג תוקף!' : `מטף כיבוי בעוד ${extDays} ימים`,
                name, extDays, 'VehicleDetail');
            }
            const raftDays = daysTo(v.life_raft_expiry_date);
            if (raftDays !== null && raftDays <= threshold) {
              addNotif(`raft-${v.id}`, v.id, 'safety',
                raftDays < 0 ? 'אסדת הצלה פג תוקף!' : `אסדת הצלה בעוד ${raftDays} ימים`,
                name, raftDays, 'VehicleDetail');
            }
          }

          if (!isVessel && v.current_km && v.last_tire_change_date) {
            // km_since_tire_change = odometer at change; driven-since = current - stored.
            // Matches ReminderEngine: validate the stored value is in
            // [0, current_km] so corrupted data doesn't flap thresholds.
            const rawStored = Number(v.km_since_tire_change);
            const validStored = Number.isFinite(rawStored) && rawStored >= 0 && rawStored <= v.current_km;
            const kmSinceTire = validStored ? (v.current_km - rawStored) : 0;
            const tireYears = differenceInYears(now, new Date(v.last_tire_change_date));
            if (kmSinceTire >= 90000 || tireYears >= 2.75) {
              const urgent = kmSinceTire >= 100000 || tireYears >= 3;
              addNotif(`tires-${v.id}`, v.id, 'maintenance',
                urgent ? 'הגיע זמן להחליף צמיגים!' : 'החלפת צמיגים מתקרבת',
                name, urgent ? 0 : 30, 'VehicleDetail');
            }
          }

          if (!isVessel && v.current_km) {
            const lastServiceKm = v.km_baseline || 0;
            const kmSinceService = v.current_km - lastServiceKm;
            if (kmSinceService >= 13500) {
              const urgent = kmSinceService >= 15000;
              addNotif(`service-${v.id}`, v.id, 'maintenance',
                urgent ? `טיפול תקופתי נדרש (${Math.round(kmSinceService / 1000)}K ק"מ)` : `טיפול מתקרב (${Math.round(kmSinceService / 1000)}K ק"מ)`,
                name, urgent ? 0 : 30, 'VehicleDetail');
            }
          }

          if (isVessel && v.last_shipyard_date) {
            const shipyardYears = differenceInYears(now, new Date(v.last_shipyard_date));
            if (shipyardYears >= 2.75) {
              const urgent = shipyardYears >= 3;
              addNotif(`shipyard-${v.id}`, v.id, 'maintenance',
                urgent ? 'הגיע זמן לביקור מספנה!' : 'ביקור מספנה מתקרב',
                name, urgent ? 0 : 30, 'VehicleDetail');
            }
          }

          if (!isVessel && vehicleAge >= 15 && v.test_due_date) {
            const testDaysLeft = daysTo(v.test_due_date);
            if (testDaysLeft !== null && testDaysLeft <= 60 && testDaysLeft > 0) {
              addNotif(`brakes-${v.id}`, v.id, 'safety',
                `רכב ותיק (${vehicleAge} שנים): נדרש אישור בלמים לטסט`,
                name, testDaysLeft, 'VehicleDetail');
            }
          }

          const localMileageDate = mileageDates[v.id] || null;
          const mileageDate = localMileageDate || v.km_update_date || v.engine_hours_update_date;
          if (mileageDate) {
            const mileageDays = Math.floor((now - new Date(mileageDate)) / 86400000);
            if (mileageDays > 180) {
              const isKmVehicle = !isVessel;
              addNotif(`mileage-${v.id}`, v.id, 'mileage',
                isKmVehicle ? `עדכן קילומטראז' (${mileageDays} ימים)` : `עדכן שעות מנוע (${mileageDays} ימים)`,
                name, 999, 'VehicleDetail');
            }
          } else if (v.current_km || v.current_engine_hours) {
            addNotif(`mileage-${v.id}`, v.id, 'mileage',
              !isVessel ? 'עדכן קילומטראז\'' : 'עדכן שעות מנוע',
              name, 999, 'VehicleDetail');
          }
        });

        const month = now.getMonth();
        const hasNonVesselVehicles = vehicles.some(v => !isVesselVeh(v));
        const hasVesselVehicles = vehicles.some(v => isVesselVeh(v));

        if (month === 10 && hasNonVesselVehicles) {
          const winterKey = `winter_dismissed_${now.getFullYear()}`;
          if (!localStorage.getItem(winterKey)) {
            items.push({
              id: 'winter-prep', vehicleId: null, type: 'seasonal',
              label: '❄️ הכן את הרכב לחורף',
              name: 'בדוק: סוללה, מגבים, צמיגים, מים למגבים, אורות',
              days: 500, isExpired: false,
            });
          }
        }

        if (month === 3 && hasVesselVehicles) {
          const sailKey = `sailing_dismissed_${now.getFullYear()}`;
          if (!localStorage.getItem(sailKey)) {
            items.push({
              id: 'sailing-season', vehicleId: null, type: 'seasonal',
              label: '⛵ עונת ההפלגה מתחילה!',
              name: 'בדוק: ציוד בטיחות, מנוע, תחתית, מפרשים',
              days: 500, isExpired: false,
            });
          }
        }

        items.sort((a, b) => {
          if (a.isExpired && !b.isExpired) return -1;
          if (!a.isExpired && b.isExpired) return 1;
          return a.days - b.days;
        });

        try {
          const { data: communityNotifs, error: cnError } = await supabase
            .from('community_notifications')
            .select('*')
            .eq('user_id', user.id)
            .eq('is_read', false)
            .order('created_at', { ascending: false })
            .limit(10);
          if (!cnError && communityNotifs) communityNotifs.forEach(cn => {
            items.push({
              id: `community-${cn.id}`, vehicleId: null, type: 'community',
              label: `${cn.commenter_name} הגיב/ה על השאלה שלך`,
              name: 'לחץ לצפייה',
              days: 500, isExpired: false,
              navTarget: 'Community',
              _communityNotifId: cn.id,
            });
          });
        } catch {}

        // Generic app_notifications (share_offered / share_accepted / …).
        // Displayed alongside reminders. Marking read clears the row so the
        // bell count deflates; we never delete — users can still see history
        // on the full Notifications page.
        try {
          const { data: appNotifs, error: anError } = await supabase
            .from('app_notifications')
            .select('*')
            .eq('user_id', user.id)
            .eq('is_read', false)
            .order('created_at', { ascending: false })
            .limit(10);
          if (!anError && appNotifs) {
            appNotifs.forEach(an => {
              // Resolve href via the shared config so a new type gets
              // the right target/icon by adding one row to the map —
              // no edits in the bell or page click handlers.
              const cfg = appConfigForType(an.type);
              const href = cfg.buildHref(an.data || {});
              items.push({
                id: `app-${an.id}`, vehicleId: null, type: 'app',
                appType: an.type,
                label: an.title,
                name: an.body || '',
                days: 500, isExpired: false,
                navHref: href,                            // resolved string or null
                _appNotifId: an.id,
              });
            });

            // Fire a device-level local notification for any app_notification
            // we haven't pinged yet. Key pattern: `app_push_fired_<id>` in
            // localStorage so a single event only fires once per install,
            // even if the bell reloads multiple times. No-op on web.
            try {
              const { isNative: native } = await import('@/lib/capacitor');
              if (native) {
                const { scheduleLocalNotification, requestNotificationPermission, checkNotificationPermission, createNotificationChannel } = await import('@/lib/notificationChannels');
                let granted = await checkNotificationPermission();
                if (!granted) granted = await requestNotificationPermission();
                if (granted) {
                  await createNotificationChannel();
                  for (const an of appNotifs) {
                    const key = `app_push_fired_${an.id}`;
                    if (localStorage.getItem(key)) continue;
                    // Fire ~2s from now so the scheduler doesn't drop a past-time
                    // notification. Good enough for "ping on app open".
                    await scheduleLocalNotification({
                      id: `app-${an.id}`,
                      title: an.title,
                      body: an.body || '',
                      scheduleAt: new Date(Date.now() + 2000),
                      extra: { type: 'app', appType: an.type, appNotifId: an.id },
                    });
                    localStorage.setItem(key, '1');
                  }
                }
              }
            } catch {}
          }
        } catch {}

        let dismissedIds = [];
        try { dismissedIds = JSON.parse(localStorage.getItem('dismissed_notif_ids') || '[]'); } catch {}
        const dismissedSet = new Set(dismissedIds);

        setNotifications(prev => {
          const profileNotifs = prev.filter(n => n.id === 'profile-incomplete' || n.id === 'license-expiry');
          const filtered = [...profileNotifs, ...items].filter(n => !dismissedSet.has(n.id));
          return filtered;
        });
      } catch (err) {
        // Surface in dev so we notice regressions in the notification pipeline;
        // still don't block rendering — an empty bell is fine for the user.
        if (import.meta.env?.DEV) console.warn('[NotificationBell] fetch failed:', err?.message);
      }
    })();
  }, [user, refreshKey]);

  const unreadCount = notifications.filter(n => !readIds.has(n.id)).length;

  const markRead = (id) => {
    setReadIds(prev => {
      const next = new Set(prev);
      next.add(id);
      if (id === 'profile-incomplete') {
        try {
          const timed = JSON.parse(localStorage.getItem('read_notif_timed') || '{}');
          timed[id] = Date.now();
          localStorage.setItem('read_notif_timed', JSON.stringify(timed));
        } catch {}
      } else {
        const permanentIds = [...next].filter(i => i !== 'profile-incomplete');
        localStorage.setItem('read_notif_ids', JSON.stringify(permanentIds));
      }
      return next;
    });
  };

  const markUnread = (id) => {
    setReadIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      if (id === 'profile-incomplete') {
        try {
          const timed = JSON.parse(localStorage.getItem('read_notif_timed') || '{}');
          delete timed[id];
          localStorage.setItem('read_notif_timed', JSON.stringify(timed));
        } catch {}
      } else {
        localStorage.setItem('read_notif_ids', JSON.stringify([...next].filter(i => i !== 'profile-incomplete')));
      }
      return next;
    });
  };

  const dismissNotification = (id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    try {
      const dismissed = JSON.parse(localStorage.getItem('dismissed_notif_ids') || '[]');
      if (!dismissed.includes(id)) {
        dismissed.push(id);
        localStorage.setItem('dismissed_notif_ids', JSON.stringify(dismissed));
      }
    } catch {}
  };

  const markAllRead = () => {
    const allIds = new Set(notifications.map(n => n.id));
    setReadIds(allIds);
    localStorage.setItem('read_notif_ids', JSON.stringify([...allIds].filter(i => i !== 'profile-incomplete')));
    if (allIds.has('profile-incomplete')) {
      try {
        const timed = JSON.parse(localStorage.getItem('read_notif_timed') || '{}');
        timed['profile-incomplete'] = Date.now();
        localStorage.setItem('read_notif_timed', JSON.stringify(timed));
      } catch {}
    }
  };

  useEffect(() => {
    const onClosePopups = () => setPopupOpen(false);
    window.addEventListener('cr:close-popups', onClosePopups);
    return () => window.removeEventListener('cr:close-popups', onClosePopups);
  }, []);

  // Browser-back / Android-back closes the popover instead of navigating
  // away from the current page. Two listeners:
  //   * popstate — covers web browser back + the historic native back
  //     button when initBackButton calls history.back().
  //   * cr:android-back — fast-path for the new native handler in
  //     capacitor.js that emits this event before invoking history.
  //     We preventDefault to tell the handler "we consumed the press"
  //     so it doesn't continue and pop the route.
  useEffect(() => {
    if (!popupOpen) return;
    const onPop = () => setPopupOpen(false);
    const onAndroidBack = (ev) => {
      ev.preventDefault();
      setPopupOpen(false);
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('cr:android-back', onAndroidBack);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('cr:android-back', onAndroidBack);
    };
  }, [popupOpen]);

  const toggleBell = () => {
    const next = !popupOpen;
    if (next) {
      window.dispatchEvent(new CustomEvent('cr:close-popups'));
      try { window.history.pushState({ crBellOpen: true }, ''); } catch {}
    } else if (window.history.state?.crBellOpen) {
      // User tapped the bell again to close — pop our sentinel so we
      // don't leak history entries.
      try { window.history.back(); return; } catch {}
    }
    setPopupOpen(next);
  };

  return (
    <div className="relative" data-tour="notif-bell">
      <button
        onClick={toggleBell}
        className="relative w-10 h-10 rounded-xl flex items-center justify-center transition-all active:scale-[0.95]"
        style={{ background: unreadCount > 0 ? '#FEF2F2' : '#F3F4F6' }}
        aria-label={unreadCount > 0 ? `התראות (${unreadCount} חדשות)` : 'התראות'}
        aria-expanded={popupOpen}
        aria-haspopup="menu"
      >
        <Bell className="w-5 h-5" style={{ color: unreadCount > 0 ? '#DC2626' : '#6B7280' }} aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -left-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black text-white"
            style={{ background: '#DC2626', boxShadow: '0 2px 6px rgba(220,38,38,0.4)' }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {popupOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPopupOpen(false)} />
          <div className="absolute left-0 top-12 z-50 w-80 rounded-2xl bg-white shadow-2xl border overflow-hidden"
            style={{ borderColor: '#E5E7EB' }} dir="rtl">
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: '#F3F4F6' }}>
              <span className="text-sm font-black" style={{ color: '#1C2E20' }}>התראות</span>
              {unreadCount > 0 && (
                <button onClick={markAllRead} className="text-[11px] font-bold" style={{ color: '#3A7D44' }}>
                  סמן הכל כנקרא
                </button>
              )}
            </div>

            <div className="max-h-72 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="py-8 text-center">
                  <Bell className="w-8 h-8 mx-auto mb-2" style={{ color: '#D1D5DB' }} />
                  <p className="text-sm font-medium" style={{ color: '#9CA3AF' }}>אין התראות</p>
                </div>
              ) : (
                notifications.slice(0, 10).map(n => {
                  const isRead = readIds.has(n.id);
                  return (
                    <div key={n.id}
                      className="flex items-center gap-3 px-4 py-3 transition-all"
                      style={{ background: isRead ? '#fff' : '#FEFCE8', borderBottom: '1px solid #F5F5F5' }}>
                      <button
                        onClick={() => {
                          markRead(n.id);
                          setPopupOpen(false);
                          if (n.type === 'profile' || n.type === 'license') navigate(createPageUrl('UserProfile'));
                          else if (n.type === 'seasonal') {
                            const key = n.id === 'winter-prep' ? `winter_dismissed_${new Date().getFullYear()}` : `sailing_dismissed_${new Date().getFullYear()}`;
                            localStorage.setItem(key, '1');
                            navigate(createPageUrl('Vehicles'));
                          }
                          else if (n.type === 'community') {
                            if (n._communityNotifId) {
                              supabase.from('community_notifications').update({ is_read: true }).eq('id', n._communityNotifId).then(() => {});
                            }
                            navigate(createPageUrl('Community'));
                          }
                          else if (n.type === 'app') {
                            if (n._appNotifId) {
                              supabase.from('app_notifications').update({ is_read: true }).eq('id', n._appNotifId).then(() => {});
                            }
                            // navHref is pre-resolved to an absolute path
                            // by appNotificationConfig.buildHref(). Some
                            // types (e.g. share_deleted) deliberately
                            // produce null — for those we just mark-read
                            // and stay where the user is.
                            if (n.navHref) navigate(n.navHref);
                          }
                          else if (n.vehicleId) {
                            const NOTIF_FIELD_MAP = {
                              test: 'test_due_date', insurance: 'insurance_due_date', mileage: 'current_km',
                            };
                            const SAFETY_FIELD_MAP = {
                              pyro: 'pyrotechnics_expiry_date', ext: 'fire_extinguisher_expiry_date', raft: 'life_raft_expiry_date',
                            };
                            let field = NOTIF_FIELD_MAP[n.type];
                            if (n.type === 'safety') {
                              const prefix = (n.id || '').split('-')[0];
                              field = SAFETY_FIELD_MAP[prefix];
                            }
                            if (field) {
                              navigate(`${createPageUrl('EditVehicle')}?id=${n.vehicleId}&field=${field}`);
                            } else {
                              navigate(`${createPageUrl('VehicleDetail')}?id=${n.vehicleId}`);
                            }
                          }
                          else navigate(createPageUrl('Dashboard'));
                        }}
                        className="flex items-center gap-3 flex-1 min-w-0 text-right">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                          style={{
                            background: n.type === 'profile' ? '#EEF2FF'
                              : n.type === 'license' ? (n.isExpired ? '#FEF2F2' : '#FFF8E1')
                              : n.type === 'community' ? '#F5F3FF'
                              // Per-app-type bg color from the shared
                              // config so each share/vehicle_change
                              // type gets its own visual signature.
                              : n.type === 'app' ? appConfigForType(n.appType).bg
                              : n.type === 'seasonal' ? '#F0F9FF'
                              : n.isExpired ? '#FEF2F2'
                              : n.type === 'safety' ? '#FFF7ED'
                              : n.type === 'maintenance' ? '#FFF8E1'
                              : n.type === 'mileage' ? '#F0FDF4'
                              : '#FFF8E1',
                            boxShadow: !isRead ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
                          }}>
                          {n.type === 'profile'
                            ? <User className="w-4 h-4" style={{ color: '#4338CA' }} />
                            : n.type === 'license'
                              ? <FileText className="w-4 h-4" style={{ color: n.isExpired ? '#DC2626' : '#D97706' }} />
                            : n.type === 'community'
                              ? <MessageSquare className="w-4 h-4" style={{ color: '#7C3AED' }} />
                            : n.type === 'app'
                              ? (() => {
                                  // Per-app-type icon + color via config map.
                                  const cfg = appConfigForType(n.appType);
                                  const Icon = cfg.icon;
                                  return <Icon className="w-4 h-4" style={{ color: cfg.iconColor }} />;
                                })()
                            : n.type === 'seasonal'
                              ? <span className="text-sm">{n.id === 'winter-prep' ? '❄️' : '⛵'}</span>
                            : n.isExpired
                              ? <AlertTriangle className="w-4 h-4" style={{ color: '#DC2626' }} />
                              : n.type === 'safety'
                                ? <AlertTriangle className="w-4 h-4" style={{ color: '#EA580C' }} />
                                : n.type === 'maintenance'
                                  ? <Wrench className="w-4 h-4" style={{ color: '#D97706' }} />
                                  : n.type === 'mileage'
                                    ? <Gauge className="w-4 h-4" style={{ color: '#16A34A' }} />
                                    : <Bell className="w-4 h-4" style={{ color: '#D97706' }} />
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs truncate ${isRead ? 'font-medium' : 'font-bold'}`}
                            style={{ color: n.isExpired ? '#DC2626' : isRead ? '#6B7280' : '#1C2E20' }}>
                            {n.label}
                          </p>
                          <p className="text-[10px] truncate" style={{ color: '#9CA3AF' }}>{n.name}</p>
                        </div>
                      </button>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); isRead ? markUnread(n.id) : markRead(n.id); }}
                          className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-gray-100 transition-all"
                          title={isRead ? 'סמן כלא נקרא' : 'סמן כנקרא'}>
                          <div className="w-2.5 h-2.5 rounded-full border-2 transition-all"
                            style={{
                              background: isRead ? 'transparent' : '#DC2626',
                              borderColor: isRead ? '#D1D5DB' : '#DC2626',
                            }} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); dismissNotification(n.id); }}
                          className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-red-50 transition-all"
                          title="הסר התראה">
                          <X className="w-3 h-3" style={{ color: '#D1D5DB' }} />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {notifications.length > 0 && (
              <button onClick={() => { setPopupOpen(false); navigate(createPageUrl('Notifications')); }}
                className="w-full py-2.5 text-center text-xs font-bold border-t transition-all hover:bg-gray-50"
                style={{ color: '#3A7D44', borderColor: '#F3F4F6' }}>
                כל ההתראות →
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
