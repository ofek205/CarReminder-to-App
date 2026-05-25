import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Loader2, Smartphone, Apple, Send, XCircle,
  CheckCircle2, AlertTriangle, RefreshCw, Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';

/**
 * AdminVersionTab — version update management panel.
 *
 * Two cards, one per platform (iOS / Android). Each shows:
 *   • Current latest_version from app_config (editable input)
 *   • Current min_version (read-only reference)
 *   • Last update timestamp
 *   • Device token count (how many native users on this platform)
 *   • "שלח התראת עדכון" button → calls broadcast_app_update RPC
 *   • "הפסק התראה" button → clears the version (stops banner + notifications)
 *
 * The RPC handles both the app_config upsert and the bulk notification
 * insert, so the admin only needs one click per platform.
 */

const PLATFORMS = [
  {
    key: 'android',
    label: 'Android',
    icon: Smartphone,
    configLatest: 'android_latest_version',
    configMin: 'android_min_version',
    color: '#10B981',
    storeName: 'Google Play',
  },
  {
    key: 'ios',
    label: 'iOS',
    icon: Apple,
    configLatest: 'ios_latest_version',
    configMin: 'ios_min_version',
    color: '#3B82F6',
    storeName: 'App Store',
  },
];

export default function AdminVersionTab() {
  const [loading, setLoading] = useState(true);
  const [configData, setConfigData] = useState(null);
  const [versions, setVersions] = useState({ android: '', ios: '' });
  const [sending, setSending] = useState({ android: false, ios: false });
  const [clearing, setClearing] = useState({ android: false, ios: false });

  // ── Fetch current config ──────────────────────────────────────────
  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_app_versions');
      if (error) throw error;
      setConfigData(data);

      // Pre-fill inputs with current values.
      const iosVal = data?.ios_latest_version?.value;
      const androidVal = data?.android_latest_version?.value;
      setVersions({
        ios: typeof iosVal === 'string' ? iosVal : '',
        android: typeof androidVal === 'string' ? androidVal : '',
      });
    } catch (err) {
      console.error('Failed to fetch app versions:', err);
      toast.error('שגיאה בטעינת נתוני גרסאות');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  // ── Send update notification ──────────────────────────────────────
  const handleBroadcast = async (platform) => {
    const version = versions[platform]?.trim();
    if (!version) {
      toast.error('יש להזין מספר גרסה');
      return;
    }
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      toast.error('פורמט גרסה לא תקין. נדרש X.Y.Z (לדוגמה: 5.1.0)');
      return;
    }

    setSending(s => ({ ...s, [platform]: true }));
    try {
      const { data, error } = await supabase.rpc('broadcast_app_update', {
        p_platform: platform,
        p_version: version,
        p_clear: false,
      });
      if (error) throw error;

      const count = data?.notifications_sent ?? 0;
      toast.success(
        count > 0
          ? `גרסה ${version} עודכנה ונשלחו ${count} התראות למשתמשי ${platform === 'ios' ? 'iOS' : 'Android'}`
          : `גרסה ${version} עודכנה. אין עדיין משתמשים רשומים בפלטפורמה זו.`
      );
      await fetchConfig();
    } catch (err) {
      console.error('Broadcast failed:', err);
      toast.error(`שליחה נכשלה: ${err.message}`);
    } finally {
      setSending(s => ({ ...s, [platform]: false }));
    }
  };

  // ── Clear version (stop prompting) ────────────────────────────────
  const handleClear = async (platform) => {
    setClearing(s => ({ ...s, [platform]: true }));
    try {
      const { data, error } = await supabase.rpc('broadcast_app_update', {
        p_platform: platform,
        p_version: '',
        p_clear: true,
      });
      if (error) throw error;
      toast.success(`התראת עדכון ל-${platform === 'ios' ? 'iOS' : 'Android'} הופסקה`);
      setVersions(v => ({ ...v, [platform]: '' }));
      await fetchConfig();
    } catch (err) {
      console.error('Clear failed:', err);
      toast.error(`ניקוי נכשל: ${err.message}`);
    } finally {
      setClearing(s => ({ ...s, [platform]: false }));
    }
  };

  // ── Render ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="py-16 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const deviceCounts = configData?.device_counts || {};

  return (
    <div dir="rtl" className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-gray-800">ניהול גרסאות ועדכונים</h2>
          <p className="text-[11px] text-gray-500 mt-0.5">
            עדכון גרסה ישנה את ה-popup בכניסה לאפליקציה וישלח התראה בתוך האפליקציה
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={fetchConfig} className="gap-1.5 text-gray-500">
          <RefreshCw className="w-3.5 h-3.5" />
          <span className="text-xs">רענן</span>
        </Button>
      </div>

      {/* Platform cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {PLATFORMS.map((p) => {
          const latestData = configData?.[p.configLatest];
          const minData = configData?.[p.configMin];
          const currentVersion = typeof latestData?.value === 'string' ? latestData.value : null;
          const minVersion = typeof minData?.value === 'string' ? minData.value : null;
          const updatedAt = latestData?.updated_at;
          const userCount = deviceCounts?.[p.key] ?? 0;
          const Icon = p.icon;
          const isSending = sending[p.key];
          const isClearing = clearing[p.key];
          const inputVal = versions[p.key];

          return (
            <div
              key={p.key}
              className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden"
            >
              {/* Card header */}
              <div
                className="px-5 py-4 flex items-center justify-between"
                style={{ backgroundColor: p.color + '0A' }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center"
                    style={{ backgroundColor: p.color + '18' }}
                  >
                    <Icon className="w-5 h-5" style={{ color: p.color }} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-gray-800">{p.label}</h3>
                    <p className="text-[10px] text-gray-500">{p.storeName}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 bg-white/80 backdrop-blur rounded-lg px-2.5 py-1.5">
                  <Users className="w-3 h-3 text-gray-400" />
                  <span className="text-[11px] font-bold text-gray-600 tabular-nums" dir="ltr">
                    {userCount}
                  </span>
                  <span className="text-[10px] text-gray-400">משתמשים</span>
                </div>
              </div>

              {/* Card body */}
              <div className="px-5 py-4 space-y-4">

                {/* Current status */}
                <div className="flex items-center gap-2">
                  {currentVersion ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                      <span className="text-xs text-gray-600">
                        גרסה נוכחית בחנות:
                      </span>
                      <span className="text-xs font-bold text-gray-800 tabular-nums" dir="ltr">
                        {currentVersion}
                      </span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <span className="text-xs text-gray-500">לא הוגדרה גרסה — התראת עדכון לא פעילה</span>
                    </>
                  )}
                </div>

                {/* Min version reference */}
                {minVersion && (
                  <div className="flex items-center gap-2 text-[11px] text-gray-400">
                    <span>גרסה מינימלית:</span>
                    <span className="font-mono tabular-nums" dir="ltr">{minVersion}</span>
                  </div>
                )}

                {/* Last updated */}
                {updatedAt && (
                  <div className="text-[10px] text-gray-400">
                    עודכן לאחרונה:{' '}
                    {format(new Date(updatedAt), "dd/MM/yyyy 'בשעה' HH:mm", { locale: he })}
                  </div>
                )}

                {/* Version input */}
                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-gray-600">
                    גרסה חדשה בחנות
                  </label>
                  <Input
                    dir="ltr"
                    placeholder="5.2.0"
                    value={inputVal}
                    onChange={(e) => setVersions(v => ({ ...v, [p.key]: e.target.value }))}
                    className="text-sm font-mono tabular-nums h-10"
                    disabled={isSending || isClearing}
                  />
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-1">
                  <Button
                    onClick={() => handleBroadcast(p.key)}
                    disabled={isSending || isClearing || !inputVal?.trim()}
                    className="flex-1 gap-2 text-xs font-bold h-10"
                    style={{
                      backgroundColor: isSending ? undefined : p.color,
                      color: isSending ? undefined : '#fff',
                    }}
                  >
                    {isSending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                    {isSending ? 'שולח...' : 'עדכן ושלח התראה'}
                  </Button>

                  {currentVersion && (
                    <Button
                      variant="outline"
                      onClick={() => handleClear(p.key)}
                      disabled={isSending || isClearing}
                      className="gap-1.5 text-xs text-red-600 border-red-200 hover:bg-red-50 h-10"
                    >
                      {isClearing ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5" />
                      )}
                      הפסק
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Info box */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
        <p className="text-[11px] text-blue-800 leading-relaxed">
          <strong>איך זה עובד:</strong> כשלוחצים "עדכן ושלח התראה" קורים שני דברים:
          (1) הגרסה מתעדכנת ב-app_config — כל משתמש שנכנס לאפליקציה יראה popup עדכון בכניסה.
          (2) נשלחת התראה in-app לכל המשתמשים עם טוקן רשום בפלטפורמה — ההתראה מופיעה בפעמון ובמסך ההתראות.
        </p>
        <p className="text-[11px] text-blue-700 mt-1.5">
          <strong>חשוב:</strong> יש לרשום את הגרסה רק אחרי שהיא אושרה בחנות ({PLATFORMS.map(p => p.storeName).join(' / ')}), אחרת המשתמשים יקבלו התראה על גרסה שלא קיימת.
        </p>
      </div>
    </div>
  );
}
