import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Loader2, Play, Clock, CheckCircle2, AlertCircle, Info, Save } from 'lucide-react';
import { useEmailTriggers, useSaveTrigger, useRunDispatcher, useEmailNotifications } from '@/hooks/useEmailAdmin';
import { toast } from 'sonner';

/**
 * TriggersTab — admin-facing controls for the automation layer.
 *
 * Lists each time-based notification (reminder_*) with three knobs:
 *   • enabled toggle      — turns dispatch on/off
 *   • days_before         — how many days before expiry to fire
 *   • cooldown_days       — minimum gap between re-sends of the same kind
 *
 * Plus a "Run now" button (actual + dry-run variants) for immediate testing.
 */
export default function TriggersTab() {
  const { data: triggers = [], isLoading } = useEmailTriggers();
  const { data: notifications = [] } = useEmailNotifications();
  const run = useRunDispatcher();
  const [lastRun, setLastRun] = useState(null);

  // Join with notifications to show readable names.
  const rows = useMemo(() => {
    const byKey = Object.fromEntries(notifications.map(n => [n.key, n]));
    return triggers.map(t => ({ ...t, notification: byKey[t.notification_key] }));
  }, [triggers, notifications]);

  const handleRun = async ({ dryRun = false } = {}) => {
    try {
      const res = await run.mutateAsync({ dryRun });
      setLastRun({ ...res, at: new Date(), dryRun });
      if (res.paused) {
        toast.error('שליחה מושעתת על ידי Kill Switch');
      } else if (!res.totals) {
        // Function ran but had nothing to do (no triggers enabled).
        toast.message(res.message === 'No enabled triggers'
          ? 'אין טריגרים פעילים. הפעל/י לפחות אחד ונסה/י שוב.'
          : 'הפונקציה רצה בהצלחה אבל לא היו תוצאות');
      } else if (dryRun) {
        toast.success(`בדיקה יבשה: ${res.totals.matched} נמענים זוהו`);
      } else {
        toast.success(`הפצה הושלמה: ${res.totals.sent} נשלחו, ${res.totals.skipped} דולגו`);
      }
    } catch (e) {
      toast.error(`הפצה נכשלה: ${e.message}`);
      setLastRun({ ok: false, error: e.message, at: new Date(), dryRun });
    }
  };

  if (isLoading) {
    return <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }

  return (
    <div dir="rtl" className="space-y-4">

      {/* Dispatcher runner */}
      <div className="rounded-2xl p-4 flex items-center gap-3 flex-wrap"
        style={{ background: '#FFFFFF', border: '1.5px solid #E5E7EB' }}>
        <div className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: '#DBEAFE' }}>
          <Play className="w-5 h-5" style={{ color: '#1E40AF' }} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-sm" style={{ color: '#1C2E20' }}>הפעלה ידנית של ה-Dispatcher</h3>
          <p className="text-xs text-gray-500">
            ה-cron רץ אוטומטית כל שעה. כאן אפשר להריץ מיד לבדיקה או לזרז שליחה.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleRun({ dryRun: true })}
            disabled={run.isPending}
            className="gap-2 h-9 rounded-xl">
            {run.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Info className="w-4 h-4" />}
            Dry run
          </Button>
          <Button
            onClick={() => handleRun({ dryRun: false })}
            disabled={run.isPending}
            className="gap-2 h-9 rounded-xl"
            style={{ background: '#2D5233', color: 'white' }}>
            {run.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            הרץ עכשיו
          </Button>
        </div>
      </div>

      {/* Last run summary */}
      {lastRun && (
        <div className="rounded-2xl p-3 text-xs"
          style={{
            background: lastRun.ok !== false ? '#ECFDF5' : '#FEF2F2',
            border: `1.5px solid ${lastRun.ok !== false ? '#A7F3D0' : '#FCA5A5'}`,
          }}>
          <div className="flex items-center gap-2 mb-1 font-bold" style={{ color: lastRun.ok !== false ? '#064E3B' : '#991B1B' }}>
            {lastRun.ok !== false ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            הרצה אחרונה: {new Date(lastRun.at).toLocaleTimeString('he-IL')}
            {lastRun.dryRun && <span className="text-[10px] font-normal">(dry run)</span>}
          </div>
          {lastRun.totals && (
            <div className="grid grid-cols-4 gap-2 text-center">
              <Stat label="זוהו" value={lastRun.totals.matched} />
              <Stat label="נשלחו" value={lastRun.totals.sent} />
              <Stat label="דולגו" value={lastRun.totals.skipped} />
              <Stat label="שגיאות" value={lastRun.totals.errors} warn={lastRun.totals.errors > 0} />
            </div>
          )}
          {lastRun.error && <div className="text-red-800">{lastRun.error}</div>}
        </div>
      )}

      {/* Per-trigger rows */}
      {rows.length === 0 ? (
        <div className="text-sm text-gray-500 py-8 text-center rounded-2xl bg-white border">
          אין טריגרים מוגדרים. הרץ את <code>supabase-email-dispatcher.sql</code> ב-Dashboard.
        </div>
      ) : (
        rows.map(row => <TriggerRow key={row.notification_key} row={row} />)
      )}

    </div>
  );
}

function Stat({ label, value, warn }) {
  return (
    <div className="rounded-lg p-2" style={{ background: warn ? '#FECACA' : 'rgba(255,255,255,0.6)' }}>
      <div className="text-lg font-bold leading-none">{value}</div>
      <div className="text-[10px] text-gray-600">{label}</div>
    </div>
  );
}

function TriggerRow({ row }) {
  const save = useSaveTrigger();
  const [draft, setDraft] = useState({
    enabled:              row.enabled,
    days_before:          row.days_before,
    cooldown_days:        row.cooldown_days,
    min_days_since_signup: row.conditions?.min_days_since_signup ?? 0,
  });
  const dirty =
    draft.enabled              !== row.enabled ||
    draft.days_before          !== row.days_before ||
    draft.cooldown_days        !== row.cooldown_days ||
    draft.min_days_since_signup !== (row.conditions?.min_days_since_signup ?? 0);

  const handleSave = async () => {
    try {
      await save.mutateAsync({
        notification_key: row.notification_key,
        enabled:          draft.enabled,
        days_before:      draft.days_before,
        cooldown_days:    draft.cooldown_days,
        conditions: {
          ...(row.conditions || {}),
          min_days_since_signup: Math.max(0, Math.min(365, Number(draft.min_days_since_signup) || 0)),
        },
      });
      toast.success('נשמר');
    } catch (e) {
      toast.error(`נכשל: ${e.message}`);
    }
  };

  const lastRun = row.last_run_at ? new Date(row.last_run_at) : null;
  const stats = row.last_run_stats || {};

  return (
    <div dir="rtl" className="rounded-2xl p-4"
      style={{ background: '#FFFFFF', border: '1.5px solid #E5E7EB' }}>
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <div className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: '#FEF3C7' }}>
          <Clock className="w-5 h-5" style={{ color: '#92400E' }} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-sm" style={{ color: '#1C2E20' }}>
            {row.notification?.display_name || row.notification_key}
          </h3>
          <p className="text-[11px] text-gray-500 font-mono" dir="ltr">{row.notification_key}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-gray-600">{draft.enabled ? 'פעיל' : 'כבוי'}</span>
          <Switch checked={draft.enabled} onCheckedChange={(v) => setDraft(d => ({ ...d, enabled: v }))} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3">
        <label className="text-xs">
          <span className="block font-bold text-gray-700 mb-1">ימים לפני פקיעה</span>
          <Input
            type="number" min={0} max={365}
            value={draft.days_before}
            onChange={(e) => setDraft(d => ({ ...d, days_before: Number(e.target.value) }))}
            dir="ltr"
            className="h-9"
          />
          <span className="text-[10px] text-gray-400 mt-0.5 block">מועד שליחה</span>
        </label>
        <label className="text-xs">
          <span className="block font-bold text-gray-700 mb-1">Cooldown (ימים)</span>
          <Input
            type="number" min={0} max={365}
            value={draft.cooldown_days}
            onChange={(e) => setDraft(d => ({ ...d, cooldown_days: Number(e.target.value) }))}
            dir="ltr"
            className="h-9"
          />
          <span className="text-[10px] text-gray-400 mt-0.5 block">מינימום בין שליחות</span>
        </label>
        <label className="text-xs">
          <span className="block font-bold text-gray-700 mb-1">ותק משתמש (ימים)</span>
          <Input
            type="number" min={0} max={365}
            value={draft.min_days_since_signup}
            onChange={(e) => setDraft(d => ({ ...d, min_days_since_signup: Number(e.target.value) }))}
            dir="ltr"
            className="h-9"
          />
          <span className="text-[10px] text-gray-400 mt-0.5 block">רק משתמשים רשומים לפחות X ימים</span>
        </label>
      </div>

      <div className="flex items-center justify-between gap-3 pt-2 border-t">
        <div className="text-[11px] text-gray-500">
          {lastRun ? (
            <>
              הרצה אחרונה: {lastRun.toLocaleString('he-IL')} &middot;{' '}
              נשלחו {stats.sent ?? 0}, דולגו {stats.skipped ?? 0}
              {stats.errors > 0 && <span className="text-red-600"> &middot; שגיאות {stats.errors}</span>}
            </>
          ) : 'טרם הופעל'}
        </div>
        <Button
          size="sm"
          disabled={!dirty || save.isPending}
          onClick={handleSave}
          className="gap-1.5 rounded-xl h-8 text-xs"
          style={{ background: dirty ? '#2D5233' : '#9CA3AF', color: 'white' }}>
          {save.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          שמירה
        </Button>
      </div>
    </div>
  );
}
