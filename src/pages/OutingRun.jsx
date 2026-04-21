/**
 * OutingRun — full-page checklist runner for a specific outing.
 *
 * Route: /OutingRun?id=<outing_id>
 *
 * Flow:
 *   1. Load outing + vehicle.
 *   2. Load existing checklist_run for (outing, phase='pre').
 *      If none exists yet, build a draft from the system template,
 *      persist it, and start there.
 *   3. Tap a row to pick state: ✓ passed · ✗ failed · — skipped.
 *      Failed items open a small sheet with severity + create-issue
 *      option.
 *   4. Sticky footer: progress + "סיים בדיקה".
 *   5. On finish: mark checklist_run.completed_at, move outing.status
 *      to in_progress (pre) or completed (post), navigate back.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db } from '@/lib/supabaseEntities';
import { buildRunDraft, computeStats, createIssueFromFailedItem } from '@/lib/skipperEngine';
import { SEVERITY } from '@/lib/checklistTemplates';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import {
  ArrowRight, Check, X, MinusCircle, AlertTriangle, Info, Loader2, Anchor,
  CheckCircle2, ChevronLeft,
} from 'lucide-react';
import { toast } from 'sonner';
import { getTheme } from '@/lib/designTokens';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

const M = getTheme('כלי שייט');

export default function OutingRun() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const outingId = params.get('id');

  const { data: outing, isLoading: outingLoading } = useQuery({
    queryKey: ['outing', outingId],
    queryFn: async () => {
      const rows = await db.outings.filter({ id: outingId });
      return rows[0] || null;
    },
    enabled: !!outingId,
  });

  const { data: vehicle } = useQuery({
    queryKey: ['outing-vehicle', outing?.vehicle_id],
    queryFn: async () => {
      const rows = await db.vehicles.filter({ id: outing.vehicle_id });
      return rows[0] || null;
    },
    enabled: !!outing?.vehicle_id,
  });

  // Fetch the pre-run for this outing. If absent we'll create one below.
  const { data: existingRun, isLoading: runLoading } = useQuery({
    queryKey: ['checklist-run', outingId, 'pre'],
    queryFn: async () => {
      const rows = await db.checklist_runs.filter({ outing_id: outingId, phase: 'pre' });
      return rows[0] || null;
    },
    enabled: !!outingId,
  });

  const [run, setRun] = useState(null);
  const [saving, setSaving] = useState(false);
  const [failSheet, setFailSheet] = useState(null);  // { index, item }

  // Materialise a run if missing, once vehicle data loads.
  useEffect(() => {
    if (!outing || !vehicle || runLoading) return;
    if (existingRun) {
      setRun(existingRun);
      return;
    }
    // No run yet — build draft + persist.
    (async () => {
      try {
        const draft = buildRunDraft({ outing, vehicle, phase: 'pre' });
        const created = await db.checklist_runs.create(draft);
        setRun(created);
        qc.invalidateQueries({ queryKey: ['checklist-run', outingId, 'pre'] });
      } catch (e) {
        toast.error(`טעינת הבדיקה נכשלה: ${e.message}`);
      }
    })();
  }, [outing, vehicle, existingRun, runLoading, outingId, qc]);

  const items = run?.items || [];

  const grouped = useMemo(() => {
    const map = new Map();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const key = it.section;
      if (!map.has(key)) map.set(key, { id: key, name: it.section_name || key, items: [] });
      map.get(key).items.push({ ...it, _index: i });
    }
    return Array.from(map.values());
  }, [items]);

  const stats = useMemo(() => computeStats(items), [items]);
  const progress = stats.total === 0 ? 0 : Math.round(((stats.passed + stats.failed + stats.skipped) / stats.total) * 100);

  const updateItem = async (index, patch) => {
    if (!run) return;
    const next = items.map((it, i) => i === index ? { ...it, ...patch, decided_at: new Date().toISOString() } : it);
    const nextStats = computeStats(next);
    setRun(r => ({ ...r, items: next, stats: nextStats }));
    // Persist async — don't block UI.
    try {
      await db.checklist_runs.update(run.id, { items: next, stats: nextStats });
    } catch (e) {
      if (import.meta.env.DEV) console.warn('[OutingRun] update failed:', e?.message);
    }
  };

  const handlePass = (index) => updateItem(index, { state: 'passed' });
  const handleSkip = (index) => updateItem(index, { state: 'skipped' });
  const handleFail = (index) => {
    setFailSheet({ index, item: items[index] });
  };

  const handleFailConfirm = async ({ createIssue, notes }) => {
    if (failSheet == null) return;
    const { index, item } = failSheet;
    await updateItem(index, { state: 'failed', notes: notes || null });
    if (createIssue && vehicle) {
      const created = await createIssueFromFailedItem({ vehicle, outing, runItem: { ...item, notes } });
      if (created) toast.success('נפתחה תקלה ברשימת התקלות');
    }
    setFailSheet(null);
  };

  const handleFinish = async () => {
    if (!run || !outing) return;
    setSaving(true);
    try {
      await db.checklist_runs.update(run.id, { completed_at: new Date().toISOString() });
      // Move the outing forward — user has finished pre-checks, now they can go.
      if (outing.status === 'planned') {
        await db.outings.update(outing.id, { status: 'in_progress', started_at: new Date().toISOString() });
      }
      qc.invalidateQueries({ queryKey: ['outings', outing.vehicle_id] });
      qc.invalidateQueries({ queryKey: ['outing', outing.id] });
      toast.success('בדיקת לפני יציאה הושלמה');
      navigate(-1);
    } catch (e) {
      toast.error(`שמירה נכשלה: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (outingLoading || !outing || !vehicle || !run) return <LoadingSpinner />;

  return (
    <div dir="rtl" className="min-h-screen pb-32" style={{ background: '#FAFBFA' }}>

      {/* ── Sticky top bar ───────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 px-4 py-3"
        style={{ background: M.grad, color: 'white' }}>
        <div className="flex items-center gap-3 mb-2">
          <button onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-xl flex items-center justify-center bg-white/15 hover:bg-white/25 transition">
            <ChevronLeft className="w-4 h-4 rotate-180" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] opacity-80">לפני יציאה</p>
            <h1 className="text-sm font-bold truncate">
              {outing.name || `הפלגה · ${vehicle.nickname || vehicle.manufacturer || 'ספינה'}`}
            </h1>
          </div>
        </div>
        <ProgressBar progress={progress} stats={stats} />
      </div>

      {/* ── Sections + items ─────────────────────────────────────────── */}
      <div className="px-4 py-5 space-y-5">
        {grouped.map(section => (
          <section key={section.id}>
            <h2 className="text-[11px] font-bold uppercase tracking-wider mb-2 px-1" style={{ color: M.muted }}>
              {section.name}
            </h2>
            <div className="rounded-2xl overflow-hidden"
              style={{ background: 'white', border: `1px solid ${M.border}` }}>
              {section.items.map((it, idx) => (
                <ItemRow
                  key={it.key}
                  item={it}
                  isLast={idx === section.items.length - 1}
                  onPass={() => handlePass(it._index)}
                  onFail={() => handleFail(it._index)}
                  onSkip={() => handleSkip(it._index)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* ── Sticky footer ────────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 z-20 px-4 py-3 bg-white border-t" style={{ borderColor: M.border }}>
        <Button
          onClick={handleFinish}
          disabled={saving}
          className="w-full h-12 rounded-xl gap-2 font-bold text-base"
          style={{ background: stats.blockers_failed > 0 ? '#DC2626' : M.primary, color: 'white' }}>
          {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
          {stats.blockers_failed > 0
            ? `סיים בדיקה (${stats.blockers_failed} חוסמים פתוחים)`
            : 'סיים בדיקה'}
        </Button>
      </div>

      <FailSheet
        state={failSheet}
        onCancel={() => setFailSheet(null)}
        onConfirm={handleFailConfirm}
      />
    </div>
  );
}

// ── Progress bar (coloured by blocker failures) ─────────────────────────

function ProgressBar({ progress, stats }) {
  const barColor = stats.blockers_failed > 0 ? '#FCA5A5' : '#FFFFFF';
  return (
    <div>
      <div className="h-1.5 rounded-full bg-white/20 overflow-hidden">
        <div className="h-full rounded-full transition-all"
          style={{ width: `${progress}%`, background: barColor }} />
      </div>
      <div className="flex items-center justify-between mt-2 text-[11px] opacity-85">
        <span>{stats.passed + stats.failed + stats.skipped} מתוך {stats.total}</span>
        <span>
          {stats.passed > 0 && <span>✓ {stats.passed}</span>}
          {stats.failed > 0 && <span className="mx-2">✗ {stats.failed}</span>}
          {stats.skipped > 0 && <span>— {stats.skipped}</span>}
        </span>
      </div>
    </div>
  );
}

// ── Individual item row ─────────────────────────────────────────────────

function ItemRow({ item, isLast, onPass, onFail, onSkip }) {
  const sev = SEVERITY[item.severity_on_fail] || SEVERITY.log;
  const isPassed = item.state === 'passed';
  const isFailed = item.state === 'failed';
  const isSkipped = item.state === 'skipped';

  return (
    <div
      dir="rtl"
      className={`px-4 py-3 ${isLast ? '' : 'border-b'}`}
      style={{ borderColor: M.border, opacity: isSkipped ? 0.55 : 1 }}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-bold" style={{ color: M.text }}>{item.name}</span>
            {item.severity_on_fail === 'blocker' && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background: sev.bg, color: sev.color }}>חוסם</span>
            )}
          </div>
          {item.help && (
            <p className="text-[11px] flex items-start gap-1" style={{ color: M.muted }}>
              <Info className="w-3 h-3 shrink-0 mt-0.5" />
              {item.help}
            </p>
          )}
          {item.notes && (
            <p className="text-[11px] italic mt-1" style={{ color: '#991B1B' }}>
              ״{item.notes}״
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 mt-3">
        <ActionChip
          active={isPassed}
          onClick={onPass}
          label="תקין"
          icon={Check}
          activeColor="#047857"
          activeBg="#D1FAE5"
        />
        <ActionChip
          active={isFailed}
          onClick={onFail}
          label="תקלה"
          icon={X}
          activeColor="#DC2626"
          activeBg="#FEE2E2"
        />
        <ActionChip
          active={isSkipped}
          onClick={onSkip}
          label="דלג"
          icon={MinusCircle}
          activeColor="#6B7280"
          activeBg="#F3F4F6"
        />
      </div>
    </div>
  );
}

function ActionChip({ active, onClick, label, icon: Icon, activeColor, activeBg }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
      style={{
        background: active ? activeBg : '#F9FAFB',
        color: active ? activeColor : '#6B7280',
        border: `1px solid ${active ? activeColor : '#E5E7EB'}`,
      }}>
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

// ── Bottom sheet for failed item — severity hint + issue creation ───────

function FailSheet({ state, onCancel, onConfirm }) {
  const [notes, setNotes] = useState('');
  const [createIssue, setCreateIssue] = useState(true);

  React.useEffect(() => {
    if (state) { setNotes(''); setCreateIssue(state.item.severity_on_fail !== 'log'); }
  }, [state]);

  if (!state) return null;
  const sev = SEVERITY[state.item.severity_on_fail] || SEVERITY.log;

  return (
    <Sheet open={!!state} onOpenChange={(o) => !o && onCancel()}>
      <SheetContent side="bottom" dir="rtl" className="rounded-t-3xl">
        <SheetHeader className="text-right">
          <SheetTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" style={{ color: sev.color }} />
            {state.item.name}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-3 py-3">
          <div className="rounded-xl p-3 text-xs"
            style={{ background: sev.bg, color: sev.color }}>
            <strong>{sev.label}.</strong>{' '}
            {state.item.severity_on_fail === 'blocker' && 'מומלץ לפתור לפני היציאה.'}
            {state.item.severity_on_fail === 'advisory' && 'אפשר לצאת, אבל לטפל בהקדם.'}
            {state.item.severity_on_fail === 'log' && 'רק נרשם — ללא פעולה נדרשת.'}
          </div>

          <div>
            <label className="text-xs font-bold block mb-1">מה לא תקין? (אופציונלי)</label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="למשל: זרימת מים חלשה, רק קצת טפטוף"
              rows={3} dir="rtl" className="rounded-xl text-sm" />
          </div>

          <label className="flex items-start gap-2 rounded-xl p-3"
            style={{ background: '#FFFFFF', border: `1px solid ${M.border}` }}>
            <input type="checkbox" checked={createIssue}
              onChange={(e) => setCreateIssue(e.target.checked)}
              className="mt-0.5" />
            <span className="text-xs">
              <strong>פתח תקלה בספינה</strong> (מופיע ברשימת התקלות, עוקב עד שתטפל)
            </span>
          </label>
        </div>

        <SheetFooter className="flex-row gap-2">
          <Button variant="outline" onClick={onCancel} className="rounded-xl">ביטול</Button>
          <Button onClick={() => onConfirm({ createIssue, notes })}
            className="rounded-xl flex-1 gap-2"
            style={{ background: sev.color, color: 'white' }}>
            <Check className="w-4 h-4" />
            סמן כתקלה
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
