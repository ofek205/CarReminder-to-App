/**
 * ChecklistHistory. read-only archive of completed checklist runs.
 *
 * URL: /ChecklistHistory?vehicleId=<uuid>[&phase=engine|pre|post]
 *
 * List of past completed runs, newest first, with chips showing the
 * balance of תקין / תקלה / דלג for each run. Tapping a row expands it
 * inline to show the items themselves (read-only. no mutations here).
 *
 * A phase filter in the header lets the user narrow to one phase.
 * Respects the 90-day DB retention cap, so nothing older than that
 * appears even if the query happened to return it.
 */

import React, { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { createPageUrl } from '@/utils';
import { db } from '@/lib/supabaseEntities';
import { PHASE_LABELS, PHASE_ORDER } from '@/lib/checklistTemplates';
import { ArrowRight, History as HistoryIcon, ChevronDown, ChevronLeft, Check, X, Minus, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

const THEME = {
  primary: '#0C7B93',
  grad:    'linear-gradient(135deg, #065A6E 0%, #0C7B93 100%)',
  tint:    '#E0F7FA',
};

function fmtDateHe(ts) {
  if (!ts) return '';
  try { return format(new Date(ts), 'd בMMMM, HH:mm', { locale: he }); }
  catch { return ''; }
}

function statsOf(items = []) {
  const s = { total: items.length, done: 0, issue: 0, skip: 0, pending: 0 };
  for (const it of items) {
    const k = it.status || 'pending';
    s[k] = (s[k] || 0) + 1;
  }
  return s;
}

export default function ChecklistHistory() {
  const [params] = useSearchParams();
  const vehicleId = params.get('vehicleId');
  const phaseFromUrl = params.get('phase');
  const navigate = useNavigate();
  const [phaseFilter, setPhaseFilter] = useState(phaseFromUrl || 'all');

  const { data: runs = [], isLoading } = useQuery({
    queryKey: ['vessel_checklist_runs_all', vehicleId],
    queryFn: () => db.vessel_checklist_runs.filter(
      { vehicle_id: vehicleId },
      { order: { column: 'started_at', ascending: false }, limit: 200 }
    ),
    enabled: !!vehicleId,
  });

  // Fetch templates so custom runs can display their user-given name
  // (runs store phase but not the template name at time of run).
  const { data: templates = [] } = useQuery({
    queryKey: ['vessel_checklists', vehicleId],
    queryFn: () => db.vessel_checklists.filter({ vehicle_id: vehicleId }),
    enabled: !!vehicleId,
  });
  const templateNameById = useMemo(() => {
    const m = {};
    for (const t of templates) m[t.id] = t.name || null;
    return m;
  }, [templates]);

  const completedRuns = useMemo(() =>
    runs.filter(r => !!r.completed_at && (phaseFilter === 'all' || r.phase === phaseFilter)),
    [runs, phaseFilter]
  );

  if (!vehicleId) return <div className="p-6 text-center text-sm text-slate-500">אין מזהה כלי</div>;
  if (isLoading) return <LoadingSpinner />;

  return (
    <div dir="rtl" className="pb-24">
      <div className="px-4 pt-4">
        <button onClick={() => navigate(`${createPageUrl('ChecklistHub')}?vehicleId=${vehicleId}`)}
          className="flex items-center gap-1 text-sm font-bold text-slate-500 hover:text-slate-700">
          <ArrowRight className="w-4 h-4" />
          חזרה
        </button>

        <div className="mt-4 rounded-2xl p-5 text-white"
          style={{ background: THEME.grad, boxShadow: '0 8px 24px rgba(12,123,147,0.25)' }}>
          <div className="flex items-center gap-2">
            <HistoryIcon className="w-5 h-5" />
            <h1 className="text-xl font-black">היסטוריית בדיקות</h1>
          </div>
          <p className="text-xs mt-1 opacity-80">
            עד 90 הימים האחרונים. רשומות ישנות יותר נמחקות אוטומטית.
          </p>
        </div>

        {/* Phase filter */}
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1" dir="rtl">
          <FilterChip label="הכול" active={phaseFilter === 'all'} onClick={() => setPhaseFilter('all')} />
          {PHASE_ORDER.map(p => (
            <FilterChip key={p} label={PHASE_LABELS[p]}
              active={phaseFilter === p} onClick={() => setPhaseFilter(p)} />
          ))}
        </div>
      </div>

      <div className="px-4 mt-4 space-y-2">
        {completedRuns.length === 0 && (
          <div className="text-center py-12 text-sm text-slate-500">
            אין עדיין בדיקות שהושלמו.
          </div>
        )}
        {completedRuns.map(run => (
          <RunRow key={run.id} run={run} templateName={templateNameById[run.template_id]} />
        ))}
      </div>
    </div>
  );
}

function FilterChip({ label, active, onClick }) {
  return (
    <button onClick={onClick}
      className="h-8 px-3 rounded-full text-xs font-bold whitespace-nowrap transition-all active:scale-95"
      style={{
        background: active ? THEME.primary : '#F1F5F9',
        color: active ? '#fff' : '#475569',
      }}>
      {label}
    </button>
  );
}

function RunRow({ run, templateName }) {
  const [open, setOpen] = useState(false);
  const s = statsOf(run.items);
  // Prefer the template's user-given name (if any) for custom runs;
  // fall back to the system phase label for built-ins.
  const phaseLabel = run.phase === 'custom'
    ? (templateName || 'צ\'ק ליסט')
    : (PHASE_LABELS[run.phase] || run.phase);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <button onClick={() => setOpen(v => !v)}
        className="w-full px-4 py-3 flex items-center gap-3 text-right" dir="rtl">
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm text-slate-800">{phaseLabel}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">{fmtDateHe(run.completed_at)}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <StatPill count={s.done} bg="#D1FAE5" fg="#047857" Icon={Check} />
          {s.issue > 0 && <StatPill count={s.issue} bg="#FEE2E2" fg="#B91C1C" Icon={X} />}
          {s.skip > 0  && <StatPill count={s.skip}  bg="#F3F4F6" fg="#4B5563" Icon={Minus} />}
        </div>
        {open
          ? <ChevronDown className="w-4 h-4 text-slate-400" />
          : <ChevronLeft className="w-4 h-4 text-slate-400" />}
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-slate-100" dir="rtl">
          {(run.items || []).map(it => <HistoryItem key={it.id} item={it} />)}
          {run.summary_note && (
            <div className="mt-3 text-xs bg-slate-50 rounded-md p-2 text-slate-600">
              {run.summary_note}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatPill({ count, bg, fg, Icon }) {
  return (
    <span className="inline-flex items-center gap-0.5 h-5 px-1.5 rounded-full text-[11px] font-bold"
      style={{ background: bg, color: fg }}>
      <Icon className="w-2.5 h-2.5" />
      {count}
    </span>
  );
}

function HistoryItem({ item }) {
  const st = item.status || 'pending';
  const icon = st === 'done' ? Check : st === 'issue' ? X : st === 'skip' ? Minus : null;
  const Icon = icon;
  const bg = st === 'done' ? '#D1FAE5' : st === 'issue' ? '#FEE2E2' : st === 'skip' ? '#F3F4F6' : '#FFFFFF';
  const fg = st === 'done' ? '#047857' : st === 'issue' ? '#B91C1C' : st === 'skip' ? '#4B5563' : '#94A3B8';

  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-slate-50 last:border-0">
      {Icon ? (
        <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5"
          style={{ background: bg, color: fg }}>
          <Icon className="w-3 h-3" strokeWidth={3} />
        </span>
      ) : (
        <span className="shrink-0 w-5 h-5 rounded-full bg-slate-100 mt-0.5" />
      )}
      <div className="flex-1 min-w-0">
        {item.section && <p className="text-[10px] text-slate-400 font-bold">{item.section}</p>}
        <p className="text-sm text-slate-800">{item.text}</p>
        {st === 'issue' && item.note && (
          <div className="mt-1 flex items-start gap-1 text-xs text-red-700 bg-red-50 rounded px-2 py-1">
            <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
            <span>{item.note}</span>
          </div>
        )}
      </div>
    </div>
  );
}
