/**
 * Checklist. full-page runner for ONE phase of a vessel checklist.
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
 *   pending (no mark) · done (✓ תקין) · issue (✗ with note) · skip ()
 *
 * Finishing:
 *   setCompletedAt(now), invalidate cache, navigate back to the hub.
 *
 * Flow: "תקלה" → opens the proper IssueNoteDialog (see issueItemId state
 * below) where the user can attach a note + optionally create a cork
 * note / vessel_issues entry. No browser prompt() anywhere.
 */

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { createPageUrl } from '@/utils';
import { db } from '@/lib/supabaseEntities';
import { PHASE_LABELS } from '@/lib/checklistTemplates';
import { ArrowRight, Check, X, Minus, AlertCircle, CheckCircle2, Pin, AlertTriangle, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Progress } from '@/components/ui/progress';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
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

/** Deterministic per-item id — if the template has its own item.id we
 *  keep it, otherwise derive one from the section name + text. Same
 *  inputs always produce the same id, so a user who reloads the page
 *  mid-run lands on the same snapshot they were editing (no mismatch
 *  between saved draft.items[i].id and the freshly-built i). */
function itemIdFor(sectionName, text, fallbackIndex) {
  if (text && sectionName) {
    // Short stable hash of "section|text" — collisions are harmless
    // within a single template (different sections produce different
    // prefixes; different texts within a section are rare).
    let h = 5381;
    const seed = `${sectionName}|${text}`;
    for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) | 0;
    return `i_${Math.abs(h).toString(36)}`;
  }
  return `i_${fallbackIndex}`;
}

/** Build a fresh items[] snapshot from a template.items.sections shape. */
function buildSnapshotFromTemplate(template) {
  const snapshot = [];
  let idx = 0;
  for (const section of template?.items?.sections || []) {
    for (const it of section.items || []) {
      snapshot.push({
        id: it.id || itemIdFor(section.name, it.text, idx++),
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
  const phaseParam = params.get('phase');
  const templateIdParam = params.get('templateId');
  const navigate = useNavigate();
  const qc = useQueryClient();

  // "phase" is whichever makes sense: the URL param (for built-ins) or
  // 'custom' (for user-created templates looked up by id).
  const [resolvedPhase, setResolvedPhase] = useState(phaseParam);
  const phase = resolvedPhase;

  const [items, setItems] = useState(null);          // snapshot in memory
  const [runId, setRunId] = useState(null);          // row in vessel_checklist_runs
  const [accountId, setAccountId] = useState(null);
  const [bootError, setBootError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const saveTimerRef = useRef(null);
  // True between a scheduleSave() and the row being written. We use it on
  // beforeunload to decide whether to prompt — without this flag we'd
  // either spam users with "leave site?" even after everything saved, or
  // lose data because the debounced fetch aborts mid-unload.
  const hasUnsavedChangesRef = useRef(false);

  // Issue-sheet state. which item is having its issue captured
  const [issueItemId, setIssueItemId] = useState(null);

  // Load template + existing draft on mount.
  //
  // Lookup order:
  //   1. If templateId is in the URL, load that exact template (works for
  //      custom templates and for system phases alike).
  //   2. Otherwise fall back to (vehicle_id, phase) for backwards compat
  //      with existing links.
  useEffect(() => {
    if (!vehicleId || (!phaseParam && !templateIdParam)) return;
    (async () => {
      try {
        const vrows = await db.vehicles.filter({ id: vehicleId });
        const acc = vrows?.[0]?.account_id;
        if (!acc) throw new Error('אין גישה לכלי');
        setAccountId(acc);

        let template = null;
        if (templateIdParam) {
          const rows = await db.vessel_checklists.filter({ id: templateIdParam });
          template = rows?.[0] || null;
        } else {
          const rows = await db.vessel_checklists.filter({ vehicle_id: vehicleId, phase: phaseParam });
          template = rows?.[0] || null;
        }

        const resolvedPhaseLocal = template?.phase || phaseParam || 'custom';
        setResolvedPhase(resolvedPhaseLocal);

        const hasTemplate = !!template && (template.items?.sections || []).length > 0;

        // Look for an open draft from today that matches this template.
        const draftQuery = templateIdParam
          ? { vehicle_id: vehicleId, template_id: templateIdParam }
          : { vehicle_id: vehicleId, phase: resolvedPhaseLocal };
        const drafts = await db.vessel_checklist_runs.filter(
          draftQuery,
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
          setBootError('אין עדיין פריטים בתבנית. פתח את "ערוך תבנית" כדי להוסיף פריטים.');
          return;
        }

        // Create a fresh run snapshot
        const snapshot = buildSnapshotFromTemplate(template);
        const created = await db.vessel_checklist_runs.create({
          template_id: template.id,
          vehicle_id: vehicleId,
          account_id: acc,
          phase: resolvedPhaseLocal,
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
  }, [vehicleId, phaseParam, templateIdParam]);

  // Debounced auto-save
  const scheduleSave = useCallback((nextItems) => {
    if (!runId) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaving(true);
    hasUnsavedChangesRef.current = true;
    saveTimerRef.current = setTimeout(async () => {
      try {
        await db.vessel_checklist_runs.update(runId, { items: nextItems });
        hasUnsavedChangesRef.current = false;
      } catch (e) {
        if (import.meta.env.DEV) console.warn('[Checklist save] failed:', e?.message);
      } finally {
        setSaving(false);
      }
    }, SAVE_DEBOUNCE_MS);
  }, [runId]);

  // Keep latest runId + items in refs so the listener effect + unmount
  // flush don't need to recreate on every keystroke (which would fight
  // the debounce).
  const latestRunIdRef = useRef(null);
  const latestItemsRef = useRef(null);
  useEffect(() => { latestRunIdRef.current = runId; }, [runId]);
  useEffect(() => { latestItemsRef.current = items; }, [items]);

  // Save on tab-hide (immediate, not debounced).
  // Three layers of protection:
  //   1. visibilitychange — fires reliably on mobile tab-switch BEFORE the
  //      tab actually closes, giving the fetch time to complete.
  //   2. beforeunload → flushNow — initiates the save as the user leaves.
  //      Browsers may abort async fetches after beforeunload, but on desktop
  //      the save usually makes it out.
  //   3. beforeunload → confirm prompt — only if there are still unsaved
  //      changes when the user tries to leave. Buys time for (2) to finish
  //      and prevents silent data loss on flaky networks.
  //   4. unmount flush — catches React Router navigations (which don't
  //      fire beforeunload) so switching pages within the debounce window
  //      still saves.
  useEffect(() => {
    const flushNow = async () => {
      const rid = latestRunIdRef.current;
      const it  = latestItemsRef.current;
      if (!rid || !it) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      try {
        await db.vessel_checklist_runs.update(rid, { items: it });
        hasUnsavedChangesRef.current = false;
      } catch {}
    };
    const onBeforeUnload = (e) => {
      flushNow();
      if (hasUnsavedChangesRef.current) {
        // Modern browsers ignore the message text but still show a prompt
        // when preventDefault() is called + returnValue is set.
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const onVis = () => { if (document.visibilityState === 'hidden') flushNow(); };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      flushNow();
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);  // Empty deps — listeners register once, read latest state via refs.

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

  const handleIssueClick = (itemId) => {
    setIssueItemId(itemId);
  };

  /**
   * Persist an issue for the given item. Called by IssueNoteSheet when
   * the user taps Save. Besides updating the checklist item itself, it
   * optionally creates a corkboard note and/or a vessel_issues row.
   *
   * Details that tripped us up in the last build:
   *   • cork_notes.color expects a keyword ('yellow'/'pink'/'blue'/...),
   *     not a hex code. Using a hex silently rendered the note invisible
   *     in CorkBoard's color map.
   *   • After inserting, we MUST invalidate the query keys that the
   *     display components actually use, or the user won't see the new
   *     row until a full page reload. CorkBoard uses ['cork-notes', id],
   *     VesselIssuesSection uses ['vessel_issues', id].
   *   • Errors used to be console.warn only; now we surface them via
   *     toast.error so a silent RLS / missing-column failure is visible.
   */
  const saveIssue = async ({ note, addToCorkboard, addToIssues }) => {
    if (!issueItemId || !accountId) return;
    const itemRef = items.find(i => i.id === issueItemId);
    const itemTitle = itemRef?.text || 'תקלה בצ\'ק ליסט';
    const fullNote = (note || '').trim() || '(ללא פירוט)';

    let corkNoteId = null;
    let issueId = null;
    let corkFailed = false;
    let issueFailed = false;

    // 1) Optional cork note
    if (addToCorkboard) {
      try {
        const created = await db.cork_notes.create({
          vehicle_id: vehicleId,
          title: `תקלה: ${itemTitle}`,
          content: fullNote,
          color: 'yellow',           // keyword (matches CorkBoard COLORS)
          priority: 'high',
          category: null,
          is_done: false,
          rotation: 0,
        });
        corkNoteId = created?.id || null;
        qc.invalidateQueries({ queryKey: ['cork-notes', vehicleId] });
      } catch (e) {
        corkFailed = true;
        console.warn('[checklist] cork note failed:', e);
        toast.error('פתק הלוח לא נוצר: ' + (e?.message || 'שגיאה'));
      }
    }

    // 2) Optional vessel_issues row
    if (addToIssues) {
      try {
        const created = await db.vessel_issues.create({
          vehicle_id: vehicleId,
          account_id: accountId,
          title: itemTitle,
          description: `${fullNote}\n\nזוהה בצ'ק ליסט: ${PHASE_LABELS[phase] || phase}`,
          category: 'other',
          priority: 'medium',
          status: 'open',
          created_date: new Date().toISOString(),
        });
        issueId = created?.id || null;
        qc.invalidateQueries({ queryKey: ['vessel_issues', vehicleId] });
      } catch (e) {
        issueFailed = true;
        console.warn('[checklist] vessel_issue failed:', e);
        toast.error('רשומת התקלה לא נוצרה: ' + (e?.message || 'שגיאה'));
      }
    }

    // 3) Apply to the item in memory + persist the run
    setItems(prev => {
      const next = prev.map(it => it.id === issueItemId
        ? { ...it, status: 'issue', note: fullNote, cork_note_id: corkNoteId, issue_id: issueId }
        : it
      );
      scheduleSave(next);
      return next;
    });
    setIssueItemId(null);

    // 4) Final toast. reflect what actually happened
    if (!corkFailed && !issueFailed) {
      const parts = ['התקלה נשמרה'];
      if (addToCorkboard) parts.push('נוסף פתק ללוח');
      if (addToIssues) parts.push('נוסף לרשימת התקלות');
      toast.success(parts.join(' · '));
    }
  };

  /**
   * Reset all item statuses back to 'pending' so the user can start the
   * run over without creating a new row. Clears notes + linked cork/issue
   * IDs so subsequent re-flagging creates fresh side effects. Auto-saves.
   */
  const handleReset = () => {
    if (!items || items.length === 0) return;
    const marked = items.filter(i => i.status && i.status !== 'pending').length;
    if (marked === 0) return; // nothing to reset, don't even confirm
    const ok = window.confirm(`לאפס את כל הסימונים ולהתחיל מחדש? ${marked} סימונים יימחקו.`);
    if (!ok) return;
    setItems(prev => {
      const next = prev.map(it => ({
        ...it, status: 'pending', note: null, cork_note_id: null, issue_id: null,
      }));
      scheduleSave(next);
      return next;
    });
    toast.success('הסימונים אופסו');
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
    // pb-[160px]: leave room for the sticky finish footer (~68px) + the
    // BottomNav underneath (~64px) so the last checklist item is never
    // hidden behind them.
    <div dir="rtl" className="pb-[160px]">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 bg-white border-b border-slate-200"
        style={{ paddingTop: 'env(safe-area-inset-top, 0)' }}>
        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            <button
              onClick={() => navigate(`${createPageUrl('ChecklistHub')}?vehicleId=${vehicleId}`)}
              className="flex items-center gap-1 text-sm font-bold text-slate-500 hover:text-slate-700">
              <ArrowRight className="w-4 h-4" />
              חזרה
            </button>
            {/* Reset button. Only active once the user has marked something,
                so a fresh run doesn't show an unnecessary action. */}
            {(stats.done + stats.issue + stats.skip) > 0 && (
              <button
                onClick={handleReset}
                className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-red-600 transition-colors px-2 py-1 rounded-md border border-slate-200 hover:border-red-200">
                <RotateCcw className="w-3.5 h-3.5" />
                אפס סימונים
              </button>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <h1 className="font-bold text-lg text-slate-800">{PHASE_LABELS[phase]}</h1>
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
            <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">{g.name}</h2>
            <div className="space-y-2">
              {g.items.map(it => (
                <ItemRow key={it.id} item={it}
                  onDone={() => setItemStatus(it.id, it.status === 'done' ? 'pending' : 'done')}
                  onIssue={() => handleIssueClick(it.id)}
                  onSkip={() => setItemStatus(it.id, it.status === 'skip' ? 'pending' : 'skip')}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Sticky footer.
          Positioned ABOVE the BottomNav (z-40, ~64px tall) so the "סיום"
          button stays visible on small screens without covering the main
          navigation. lg:bottom-0 restores the default on desktop where
          no BottomNav is drawn. */}
      <div className="fixed left-0 right-0 border-t border-slate-200 bg-white px-4 py-3 z-40 bottom-[64px] lg:bottom-0"
        style={{ paddingBottom: '12px' }}>
        <button onClick={handleFinish}
          disabled={finishing || !items.length}
          className="w-full h-12 rounded-2xl font-bold text-base text-white active:translate-y-px transition-all disabled:opacity-50"
          style={{ background: THEME.grad, boxShadow: '0 6px 18px rgba(12,123,147,0.3)' }}>
          {finishing ? 'שומר…' : 'סיום ושמירה'}
        </button>
      </div>

      {/* Issue note bottom sheet */}
      <IssueNoteSheet
        open={!!issueItemId}
        itemText={items.find(i => i.id === issueItemId)?.text || ''}
        initialNote={items.find(i => i.id === issueItemId)?.note || ''}
        onClose={() => setIssueItemId(null)}
        onSave={saveIssue}
      />
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

/* -------------------------------------------------------------------------- */
/* Issue capture sheet                                                        */
/*                                                                            */
/* Slides up from the bottom when the user flags a checklist item as תקלה.    */
/* Captures a free-text note (required by product decision) and two           */
/* opt-in switches:                                                           */
/*   ▢ הוסף ללוח ההודעות של הכלי   (Q3. default OFF)                          */
/*   ▢ הוסף לרשימת התקלות בסירה    (Q2. default OFF)                          */
/* -------------------------------------------------------------------------- */

function IssueNoteSheet({ open, itemText, initialNote, onClose, onSave }) {
  const [note, setNote] = useState('');
  const [addToCorkboard, setAddToCorkboard] = useState(false);
  const [addToIssues, setAddToIssues] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setNote(initialNote || '');
      setAddToCorkboard(false);
      setAddToIssues(false);
      setSaving(false);
    }
  }, [open, initialNote]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        note: note.trim(),
        addToCorkboard,
        addToIssues,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="bottom" dir="rtl"
        className="rounded-t-3xl max-h-[90vh] overflow-y-auto">
        <SheetHeader className="text-right">
          <SheetTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600" />
            תקלה בפריט
          </SheetTitle>
          <SheetDescription className="text-right">
            <span className="font-bold text-slate-700">{itemText}</span>
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-700 mb-1.5 block">
              תיאור התקלה
            </label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="מה מצאת? דוגמה: דליפת שמן מצד ימין, או חיבור רופף במצבר."
              rows={4}
              autoFocus
              className="resize-none"
            />
          </div>

          <div className="space-y-3 pt-1">
            <label className="flex items-start gap-3 cursor-pointer">
              <Checkbox
                checked={addToCorkboard}
                onCheckedChange={(v) => setAddToCorkboard(!!v)}
                className="mt-0.5"
              />
              <div className="flex-1">
                <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                  <Pin className="w-3.5 h-3.5 text-amber-600" />
                  הוסף ללוח ההודעות
                </p>
                <p className="text-[11px] text-slate-500 leading-snug">
                  פתק חדש יופיע בלוח של הכלי, כדי שלא תשכח.
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <Checkbox
                checked={addToIssues}
                onCheckedChange={(v) => setAddToIssues(!!v)}
                className="mt-0.5"
              />
              <div className="flex-1">
                <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                  הוסף לרשימת התקלות בסירה
                </p>
                <p className="text-[11px] text-slate-500 leading-snug">
                  רישום רשמי במאגר התקלות של הכלי, למעקב עד לסיום.
                </p>
              </div>
            </label>
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={onClose} className="flex-1" disabled={saving}>
              ביטול
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !note.trim()}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white">
              {saving ? 'שומר…' : 'שמור תקלה'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
