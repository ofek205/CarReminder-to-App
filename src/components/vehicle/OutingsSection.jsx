/**
 * OutingsSection — the skipper assistant entry point on the boat detail
 * page. Mounted only when the vehicle is a vessel.
 *
 * Shows:
 *  • The active / upcoming outing (if any) with progress, CTA to resume.
 *  • "הפלגה חדשה" button — opens a light creation dialog.
 *  • Last 3 completed outings, summary cards.
 *
 * Full-page runner lives in /OutingRun?id=<outing_id>.
 */

import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db } from '@/lib/supabaseEntities';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { DateInput } from '@/components/ui/date-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Anchor, Plus, Play, CheckCircle2, Clock, Loader2, ArrowLeft, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { getTheme } from '@/lib/designTokens';

const M = getTheme('כלי שייט');

const TRIP_TYPE_OPTIONS = [
  { value: 'short',   label: 'יציאה קצרה' },
  { value: 'long',    label: 'יציאה ארוכה' },
  { value: 'fishing', label: 'דיג' },
  { value: 'family',  label: 'עם המשפחה' },
  { value: 'night',   label: 'לילה' },
];

const STATUS_VISUAL = {
  planned:     { label: 'מתוכננת',  icon: Clock,         fg: '#1E40AF', bg: '#DBEAFE' },
  in_progress: { label: 'פעילה',    icon: Play,          fg: '#065F46', bg: '#D1FAE5' },
  completed:   { label: 'הושלמה',   icon: CheckCircle2,  fg: '#4B5563', bg: '#F3F4F6' },
  cancelled:   { label: 'בוטלה',    icon: AlertTriangle, fg: '#991B1B', bg: '#FEE2E2' },
};

export default function OutingsSection({ vehicle }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);

  const { data: outings = [], isLoading } = useQuery({
    queryKey: ['outings', vehicle?.id],
    queryFn: () => db.outings.filter({ vehicle_id: vehicle.id }),
    enabled: !!vehicle?.id,
    staleTime: 10_000,
  });

  // Split into "active" (planned or in_progress, sorted by planned_at) and
  // "history" (completed/cancelled, last 3).
  const { activeOuting, history } = useMemo(() => {
    const active = outings
      .filter(o => o.status === 'planned' || o.status === 'in_progress')
      .sort((a, b) => new Date(a.planned_at || a.created_at) - new Date(b.planned_at || b.created_at))[0] || null;
    const hist = outings
      .filter(o => o.status === 'completed' || o.status === 'cancelled')
      .sort((a, b) => new Date(b.ended_at || b.updated_at) - new Date(a.ended_at || a.updated_at))
      .slice(0, 3);
    return { activeOuting: active, history: hist };
  }, [outings]);

  if (isLoading) return null;

  return (
    <div dir="rtl" className="mb-6">
      <SectionHeader vehicle={vehicle} onNew={() => setShowNew(true)} />

      {activeOuting
        ? <ActiveOutingCard outing={activeOuting} onOpen={() => navigate(`/OutingRun?id=${activeOuting.id}`)} />
        : <EmptyActiveState onNew={() => setShowNew(true)} />}

      {history.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-bold text-gray-500 mb-2 px-1">היסטוריה</p>
          <div className="space-y-2">
            {history.map(o => <HistoryOutingCard key={o.id} outing={o} />)}
          </div>
        </div>
      )}

      <NewOutingDialog
        open={showNew}
        onClose={() => setShowNew(false)}
        vehicle={vehicle}
        onCreated={(id) => {
          qc.invalidateQueries({ queryKey: ['outings', vehicle.id] });
          setShowNew(false);
          // Jump the user straight into the runner for the fresh outing.
          navigate(`/OutingRun?id=${id}`);
        }}
      />
    </div>
  );
}

// ── Header strip ────────────────────────────────────────────────────────

function SectionHeader({ vehicle, onNew }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: M.light }}>
        <Anchor className="w-5 h-5" style={{ color: M.primary }} />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-bold text-base" style={{ color: M.text }}>הפלגות</h3>
        <p className="text-xs" style={{ color: M.muted }}>שותף הקברניט — לפני ואחרי יציאה</p>
      </div>
      <Button onClick={onNew} size="sm"
        className="gap-1.5 rounded-xl h-9"
        style={{ background: M.primary, color: 'white' }}>
        <Plus className="w-4 h-4" />
        הפלגה חדשה
      </Button>
    </div>
  );
}

// ── Active outing card ──────────────────────────────────────────────────

function ActiveOutingCard({ outing, onOpen }) {
  const v = STATUS_VISUAL[outing.status] || STATUS_VISUAL.planned;
  const Icon = v.icon;
  const plannedLabel = outing.planned_at
    ? new Date(outing.planned_at).toLocaleDateString('he-IL', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—';

  return (
    <button
      onClick={onOpen}
      className="w-full text-right rounded-2xl p-4 transition-colors hover:bg-opacity-90"
      style={{ background: M.light, border: `1.5px solid ${M.border}` }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"
          style={{ background: v.bg, color: v.fg }}>
          <Icon className="w-3 h-3" />
          {v.label}
        </span>
        <span className="text-xs" style={{ color: M.muted }}>{plannedLabel}</span>
      </div>
      <h4 className="font-bold text-base mb-1" style={{ color: M.text }}>
        {outing.name || 'הפלגה ללא שם'}
      </h4>
      {outing.route && <p className="text-xs mb-2" style={{ color: M.muted }}>{outing.route}</p>}
      <div className="flex items-center gap-2 mt-3">
        <div className="flex-1 text-xs font-bold" style={{ color: M.primary }}>
          {outing.status === 'planned' ? 'התחל בדיקות לפני יציאה' : 'המשך'}
        </div>
        <ArrowLeft className="w-4 h-4" style={{ color: M.primary }} />
      </div>
    </button>
  );
}

function EmptyActiveState({ onNew }) {
  return (
    <div className="rounded-2xl p-5 text-center"
      style={{ background: '#FFFFFF', border: `1.5px dashed ${M.border}` }}>
      <p className="text-sm font-bold mb-1" style={{ color: M.text }}>אין הפלגה פעילה</p>
      <p className="text-xs mb-3" style={{ color: M.muted }}>
        הקברניט החכם יכין checklist מותאם ברגע שתתכנן יציאה.
      </p>
      <Button onClick={onNew} variant="outline" size="sm"
        className="gap-1.5 rounded-xl"
        style={{ borderColor: M.primary, color: M.primary }}>
        <Plus className="w-4 h-4" />
        הפלגה חדשה
      </Button>
    </div>
  );
}

// ── History card ────────────────────────────────────────────────────────

function HistoryOutingCard({ outing }) {
  const v = STATUS_VISUAL[outing.status] || STATUS_VISUAL.completed;
  const endedLabel = outing.ended_at
    ? new Date(outing.ended_at).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })
    : '—';
  return (
    <div className="rounded-2xl p-3 flex items-center gap-3"
      style={{ background: '#FFFFFF', border: `1px solid ${M.border}` }}>
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: v.bg }}>
        <CheckCircle2 className="w-4 h-4" style={{ color: v.fg }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold truncate" style={{ color: M.text }}>
          {outing.name || 'הפלגה'}
        </p>
        <p className="text-[11px]" style={{ color: M.muted }}>
          {endedLabel}
          {outing.engine_hours_start != null && outing.engine_hours_end != null
            ? ` · ${(outing.engine_hours_end - outing.engine_hours_start).toFixed(1)} שעות מנוע`
            : ''}
        </p>
      </div>
    </div>
  );
}

// ── New outing dialog ───────────────────────────────────────────────────

function NewOutingDialog({ open, onClose, vehicle, onCreated }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    trip_type: 'short',
    planned_at: new Date().toISOString().slice(0, 10),
    route: '',
  });

  React.useEffect(() => {
    if (open) setForm({
      name: '',
      trip_type: 'short',
      planned_at: new Date().toISOString().slice(0, 10),
      route: '',
    });
  }, [open]);

  const handleCreate = async () => {
    if (!vehicle?.id || !vehicle?.account_id) {
      toast.error('חסרים פרטי ספינה');
      return;
    }
    setSaving(true);
    try {
      const row = await db.outings.create({
        account_id: vehicle.account_id,
        vehicle_id: vehicle.id,
        name: form.name.trim() || null,
        trip_type: form.trip_type,
        status: 'planned',
        planned_at: form.planned_at ? new Date(form.planned_at).toISOString() : new Date().toISOString(),
        route: form.route.trim() || null,
        engine_hours_start: vehicle.current_engine_hours ?? null,
        km_start: vehicle.current_km ?? null,
      });
      toast.success('הפלגה נוצרה');
      onCreated?.(row.id);
    } catch (e) {
      toast.error(`יצירת ההפלגה נכשלה: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle>הפלגה חדשה</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <Field label="שם (אופציונלי)">
            <Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
              dir="rtl" placeholder="יציאה לאילת" />
          </Field>

          <Field label="סוג הפלגה">
            <Select value={form.trip_type} onValueChange={(v) => setForm(f => ({ ...f, trip_type: v }))}>
              <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent dir="rtl">
                {TRIP_TYPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>

          <Field label="תאריך מתוכנן">
            <DateInput value={form.planned_at}
              onChange={(e) => setForm(f => ({ ...f, planned_at: e.target.value }))} />
          </Field>

          <Field label="מסלול (אופציונלי)">
            <Input value={form.route} onChange={(e) => setForm(f => ({ ...f, route: e.target.value }))}
              dir="rtl" placeholder="הרצליה ← תל אביב" />
          </Field>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-xl">ביטול</Button>
          <Button onClick={handleCreate} disabled={saving}
            className="rounded-xl gap-2"
            style={{ background: M.primary, color: 'white' }}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Anchor className="w-4 h-4" />}
            צור והמשך
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-xs font-bold text-gray-700 block mb-1">{label}</label>
      {children}
    </div>
  );
}
