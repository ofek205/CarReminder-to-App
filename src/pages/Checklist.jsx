/**
 * Checklist — full-page runner for ONE phase of a vessel checklist.
 *
 * URL: /Checklist?vehicleId=<uuid>&phase=engine|pre|post
 *
 * On open:
 *   1. Load template.
 *   2. If an open draft exists for this vehicle+phase AND it started today,
 *      resume it. Otherwise create a fresh run snapshot from the template.
 *   3. Auto-save on every change (debounced 1.5s) + on visibility hidden.
 *
 * Item states:
 *   pending (no mark) · done (✓ תקין) · issue (✗ with note) · skip (—)
 *
 * Finishing:
 *   setCompletedAt(now), invalidate cache, navigate back to the hub.
 *
 * NOTE: this commit ships the RUNNER skeleton. Issue-note modal and
 * corkboard/vessel_issues integration land in the next commit so that
 * this one stays reviewable. Tapping "תקלה" for now opens a simple
 * prompt() for the note as placeholder.
 */

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createPageUrl } from '@/utils';
import { db } from '@/lib/supabaseEntities';
import { PHASE_LABELS } from '@/lib/checklistTemplates';
import { ArrowRight, Check, X, Minus, AlertCircle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { Progress } from '@/components/ui/progress';
import { isToday } from 'date-fns';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

const THEME = {
  primary:   '#0C7B93',
  grad:      'linear-gradient(135deg, #065A6E 0%, #0C7B93 100%)',
  done:      '#059669',
  doneTint:  '#D1FAE5',
  issue:     '#DC2626',
  issueTint: '#FEE2E2',
  skip:      '#6B7280',
  skipTint:  '#F3F4F6',
};

const SAVE_DEBOUNCE_MS = 1500;

function uid() { return `i_${Math.random().toString(36).slice(2, 10)}`; }

/** Build a fresh items[] snapshot from a template.items.sections shape. */
function buildSnapshotFromTemplate(template) {
  const snapshot = [];
  for (const section of template?.items?.sections || []) {
    for (const it of section.items || []) {
      snapshot.push({
        id: uid(),
        section: section.name,
        text: it.text || '',
        status: 'pending',
        note: null,
        cork_note_id: null,
        issue_id: null,
      });
    }
  }
  return snapshot;
}

/** Group items by section for rendering. Preserves original order. */
function groupBySection(items) {
  const groups = [];
  const byName = new Map();
  for (const it of items) {
    const key = it.section || 'כללי';
    if (!byName.has(key)) {
      const g = { name: key, items: [] };
      byName.set(key, g);
      groups.push(g);
    }
    byName.get(key).items.push(it);
  }
  return groups;
}

export default function Checklist() {
  const [params] = useSearchParams();
  const vehicleId = params.get('vehicleId');
  const phase = params.get('phase');
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [items, setItems] = useState(null);          // snapshot in memory
  const [runId, setRunId] = useState(null);          // row in vessel_checklist_runs
  const [accountId, setAccountId] = useState(null);
  const [bootError, setBootError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const saveTimerRef = useRef(null);

  // Load template + existing draft on mount
  useEffect(() => {
    if (!vehicleId || !phase) return;
    (async () => {
      try {
        // Resolve account_id from the vehicle row.
        const vrows = await db.vehicles.filter({ id: vehicleId });
        const acc = vrows?.[0]?.account_id;
        if (!acc) throw new Error('אין גישה לכלי');
        setAccountId(acc);

        // Template
        const tplRows = await db.vessel_checklists.filter({ vehicle_id: vehicleId, phase });
        const template = tplRows?.[0] || null;
        const hasTemplate = !!template && (template.items?.sections || []).length > 0;

        // Look for an open draft that started today.
        const drafts = await db.vessel_checklist_runs.filter(
          { vehicle_id: vehicleId, phase },
          { order: { column: 'started_at', ascending: false }, limit: 5 }
        );
        const draft = (drafts || []).find(r =>
          !r.completed_at && !r.archived_at && r.started_at && isToday(new Date(r.started_at))
        );

        if (draft) {
          setRunId(draft.id);
          setItems(draft.items || []);
          return;
        }

        if (!hasTemplate) {
          setBootError('אין עדיין תבנית לשלב זה. פתח את "ערוך תבנית" כדי לבנות אחת.');
          return;
        }

        // Create a fresh run snapshot
        const snapshot = buildSnapshotFromTemplate(template);
        const created = await db.vessel_checklist_runs.create({
          template_id: template.id,
          vehicle_id: vehicleId,
          account_id: acc,
          phase,
          items: snapshot,
          started_at: new Date().toISOString(),
        });
        setRunId(created.id);
        setItems(snapshot);
      } catch (e) {
        console.error('[Checklist boot] failed:', e);
        setBootError('טעינת הבדיקה נכשלה. נסה שוב.');
      }
    })();
  }, [vehicleId, phase]);

  // Debounced auto-save
  const scheduleSave = useCallback((nextItems) => {
    if (!runId) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaving(true);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await db.vessel_checklist_runs.update(runId, { items: nextItems });
      } catch (e) {
        if (import.meta.env.DEV) console.warn('[Checklist save] failed:', e?.message);
      } finally {
        setSaving(false);
      }
    }, SAVE_DEBOUNCE_MS);
  }, [runId]);

  // Save on tab-hide (immediate, not debounced)
  useEffect(() => {
    const flushNow = async () => {
      if (!runId || !items) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      try { await db.vessel_checklist_runs.update(runId, { items }); } catch {}
    };
    const onVis = () => { if (document.visibilityState === 'hidden') flushNow(); };
    window.addEventListener('beforeunload', flushNow);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('beforeunload', flushNow);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [runId, items]);

  const setItemStatus = (itemId, nextStatus, note = null) => {
    setItems(prev => {
      const next = prev.map(it => it.id === itemId
        ? { ...it, status: nextStatus, note: nextStatus === 'issue' ? (note ?? it.note) : (nextStatus === 'done' ? null : it.note) }
        : it
      );
      scheduleSave(next);
      return next;
    });
  };

  const handleIssue = (itemId) => {
    // Placeholder until next commit ships the proper bottom-sheet modal.
    const note = window.prompt('תאר את התקלה:', '');
    if (note === null) return; // cancelled
    setItemStatus(itemId, 'issue', note.trim() || '(ללא פירוט)');
  };

  const handleFinish = async () => {
    if (!runId) return;
    const pendingCount = items.filter(i => i.status === 'pending').length;
    if (pendingCount > 0) {
      const ok = window.confirm(`עוד ${pendingCount} פריטים לא סומנו. לסיים בכל זאת?`);
      if (!ok) return;
    }
    setFinishing(true);
    try {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      await db.vessel_checklist_runs.update(runId, {
        items,
        completed_at: new Date().toISOString(),
      });
      qc.invalidateQueries({ queryKey: ['vessel_checklist_runs', vehicleId] });
      toast.success('הבדיקה נשמרה');
      navigate(`${createPageUrl('ChecklistHub')}?vehicleId=${vehicleId}`);
    } catch (e) {
      toast.error('שמירה נכשלה');
      setFinishing(false);
    }
  };

  const groups = useMemo(() => items ? groupBySection(items) : [], [items]);
  const stats = useMemo(() => {
    if (!items) return { total: 0, done: 0, issue: 0, skip: 0, pending: 0, pct: 0 };
    const s = { total: items.length, done: 0, issue: 0, skip: 0, pending: 0, pct: 0 };
    items.forEach(it => { s[it.status] = (s[it.status] || 0) + 1; });
    s.pct = s.total ? Math.round(((s.done + s.issue + s.skip) / s.total) * 100) : 0;
    return s;
  }, [items]);

  if (!vehicleId || !phase) {
    return <div className="p-6 text-center text-sm text-slate-500">פרמטרים חסרים</div>;
  }
  if (bootError) {
    return (
      <div className="p-6 text-center" dir="rtl">
        <p className="text-sm text-slate-700">{bootError}</p>
        <button
          onClick={() => navigate(`${createPageUrl('ChecklistHub')}?vehicleId=${vehicleId}`)}
          className="mt-3 text-sm font-bold text-teal-700 underline">
          חזרה לרשימה הראשית
        </button>
      </div>
    );
  }
  if (!items) return <LoadingSpinner />;

  return (
    <div dir="rtl" className="pb-28">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 bg-white border-b border-slate-200"
        style={{ paddingTop: 'env(safe-area-inset-top, 0)' }}>
        <div className="px-4 py-3">
          <button
            onClick={() => navigate(`${createPageUrl('ChecklistHub')}?vehicleId=${vehicleId}`)}
            className="flex items-center gap-1 text-sm font-bold text-slate-500 hover:text-slate-700">
            <ArrowRight className="w-4 h-4" />
            חזרה
          </button>
          <div className="mt-2 flex items-center justify-between">
            <h1 className="font-black text-lg text-slate-800">{PHASE_LABELS[phase]}</h1>
            <div className="text-xs font-bold flex items-center gap-1.5" style={{ color: THEME.primary }}>
              {saving && <span className="text-amber-600 text-[10px]">שומר…</span>}
              {!saving && items.length > 0 && <CheckCircle2 className="w-3 h-3" />}
              <span>{stats.done + stats.issue + stats.skip}/{stats.total}</span>
            </div>
          </div>
          <Progress value={stats.pct} className="h-1.5 mt-2" />
        </div>
      </div>

      {/* Sections */}
      <div className="px-4 pt-4 space-y-5">
        {groups.map((g) => (
          <div key={g.name}>
            <h2 className="text-xs font-black uppercase tracking-wide text-slate-500 mb-2">{g.name}</h2>
            <div className="space-y-2">
              {g.items.map(it => (
                <ItemRow key={it.id} item={it}
                  onDone={() => setItemStatus(it.id, it.status === 'done' ? 'pending' : 'done')}
                  onIssue={() => handleIssue(it.id)}
                  onSkip={() => setItemStatus(it.id, it.status === 'skip' ? 'pending' : 'skip')}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Sticky footer */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-slate-200 bg-white px-4 py-3 z-20"
        style={{ paddingBottom: `calc(env(safe-area-inset-bottom, 0) + 12px)` }}>
        <button onClick={handleFinish}
          disabled={finishing || !items.length}
          className="w-full h-12 rounded-2xl font-extrabold text-base text-white active:translate-y-px transition-all disabled:opacity-50"
          style={{ background: THEME.grad, boxShadow: '0 6px 18px rgba(12,123,147,0.3)' }}>
          {finishing ? 'שומר…' : 'סיום ושמירה'}
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ItemRow({ item, onDone, onIssue, onSkip }) {
  const { status } = item;

  const rowBg =
    status === 'done'  ? '#F0FDF4' :
    status === 'issue' ? '#FEF2F2' :
    status === 'skip'  ? '#F9FAFB' :
    '#FFFFFF';
  const rowBorder =
    status === 'done'  ? '#BBF7D0' :
    status === 'issue' ? '#FECACA' :
    status === 'skip'  ? '#E5E7EB' :
    '#E5E7EB';

  return (
    <div className="rounded-xl p-3 border transition-all"
      style={{ background: rowBg, borderColor: rowBorder }} dir="rtl">
      <p className={`text-sm font-semibold ${status === 'done' || status === 'skip' ? 'text-slate-500' : 'text-slate-800'}`}>
        {item.text}
      </p>
      {status === 'issue' && item.note && (
        <div className="mt-2 flex items-start gap-1.5 text-xs text-red-800 bg-red-100/60 rounded-md px-2 py-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="leading-snug">{item.note}</span>
        </div>
      )}
      <div className="flex gap-2 mt-2">
        <ActionChip
          active={status === 'done'}
          activeColor={THEME.done}
          activeBg={THEME.doneTint}
          icon={Check}
          label="תקין"
          onClick={onDone}
        />
        <ActionChip
          active={status === 'issue'}
          activeColor={THEME.issue}
          activeBg={THEME.issueTint}
          icon={X}
          label="תקלה"
          onClick={onIssue}
        />
        <ActionChip
          active={status === 'skip'}
          activeColor={THEME.skip}
          activeBg={THEME.skipTint}
          icon={Minus}
          label="דלג"
          onClick={onSkip}
        />
      </div>
    </div>
  );
}

function ActionChip({ active, activeColor, activeBg, icon: Icon, label, onClick }) {
  return (
    <button onClick={onClick}
      className="flex-1 h-9 rounded-lg flex items-center justify-center gap-1 text-xs font-bold transition-all active:scale-95"
      style={{
        background: active ? activeBg : 'white',
        color: active ? activeColor : '#6B7280',
        border: `1.5px solid ${active ? activeColor : '#E5E7EB'}`,
      }}>
      <Icon className="w-3.5 h-3.5" strokeWidth={2.5} />
      {label}
    </button>
  );
}
