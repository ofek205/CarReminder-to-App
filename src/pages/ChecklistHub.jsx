/**
 * ChecklistHub — landing page for a vessel's checklists (engine/pre/post).
 *
 * URL: /ChecklistHub?vehicleId=<uuid>
 *
 * Shows one card per phase. Each card reflects "what's the user's most
 * relevant state for this phase right now":
 *   • Draft open from today      → "המשך" (resume)
 *   • Completed today            → "בוצע היום" + "צפה"
 *   • Completed yesterday or older → "אחרון: לפני X" + "התחל חדשה"
 *   • Never run                  → "התחל בדיקה ראשונה"
 *
 * On mount we also sweep "yesterday-or-older drafts" into archived_at
 * (Q6 A) so the hub surface stays clean.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createPageUrl } from '@/utils';
import { db } from '@/lib/supabaseEntities';
import { PHASE_LABELS, PHASE_ORDER } from '@/lib/checklistTemplates';
import { ArrowRight, Wrench, Anchor, ClipboardCheck, CheckCircle2, Edit3, History } from 'lucide-react';
import { formatDistanceToNow, isToday } from 'date-fns';
import { he } from 'date-fns/locale';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

const PHASE_ICONS = {
  engine: Wrench,
  pre:    Anchor,
  post:   ClipboardCheck,
};

// Marine teal palette — same as the vessel tour, keeps visual continuity.
const THEME = {
  primary:   '#0C7B93',
  primaryFg: '#FFFFFF',
  tint:      '#E0F7FA',
  tintDk:    '#B2EBF2',
  grad:      'linear-gradient(135deg, #065A6E 0%, #0C7B93 100%)',
  done:      '#059669',
  doneTint:  '#D1FAE5',
  warn:      '#D97706',
  warnTint:  '#FEF3C7',
};

function fmtAgo(ts) {
  if (!ts) return null;
  try { return formatDistanceToNow(new Date(ts), { addSuffix: false, locale: he }); }
  catch { return null; }
}

/** Latest non-archived run for this (vehicle, phase), if any. */
function latestRun(runs, phase) {
  const candidates = (runs || [])
    .filter(r => r.phase === phase && !r.archived_at)
    .sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
  return candidates[0] || null;
}

export default function ChecklistHub() {
  const [params] = useSearchParams();
  const vehicleId = params.get('vehicleId');
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Vehicle header info
  const { data: vehicle } = useQuery({
    queryKey: ['vehicle', vehicleId],
    queryFn: async () => {
      const rows = await db.vehicles.filter({ id: vehicleId });
      return rows?.[0] || null;
    },
    enabled: !!vehicleId,
  });

  // Templates (1 per phase)
  const { data: templates = [] } = useQuery({
    queryKey: ['vessel_checklists', vehicleId],
    queryFn: () => db.vessel_checklists.filter({ vehicle_id: vehicleId }),
    enabled: !!vehicleId,
  });

  // Runs (last 30 days worth is plenty for hub state)
  const { data: runs = [], isLoading: runsLoading } = useQuery({
    queryKey: ['vessel_checklist_runs', vehicleId],
    queryFn: () => db.vessel_checklist_runs.filter(
      { vehicle_id: vehicleId },
      { order: { column: 'started_at', ascending: false }, limit: 60 }
    ),
    enabled: !!vehicleId,
  });

  // Q6 — archive yesterday-or-older open drafts on mount.
  useEffect(() => {
    if (!runs.length) return;
    const stale = runs.filter(r =>
      !r.completed_at && !r.archived_at &&
      r.started_at && !isToday(new Date(r.started_at))
    );
    if (!stale.length) return;
    (async () => {
      const now = new Date().toISOString();
      for (const r of stale) {
        try { await db.vessel_checklist_runs.update(r.id, { archived_at: now }); } catch {}
      }
      qc.invalidateQueries({ queryKey: ['vessel_checklist_runs', vehicleId] });
    })();
    // Only on first mount / when runs first arrive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs.length]);

  const phaseCards = useMemo(() => PHASE_ORDER.map(phase => {
    const template = templates.find(t => t.phase === phase);
    const run = latestRun(runs, phase);
    const hasTemplate = !!template && Array.isArray(template.items?.sections) && template.items.sections.length > 0;

    // Status classification for the card
    let status = 'empty';
    if (run) {
      if (!run.completed_at) status = 'draft';
      else if (isToday(new Date(run.completed_at))) status = 'done_today';
      else status = 'done_past';
    } else if (hasTemplate) {
      status = 'ready';
    }
    return { phase, template, run, status };
  }), [templates, runs]);

  if (!vehicleId) {
    return <div className="p-6 text-center text-sm text-slate-500">לא סופק מזהה כלי</div>;
  }
  if (runsLoading) return <LoadingSpinner />;

  const vesselName = vehicle?.nickname || `${vehicle?.manufacturer || ''} ${vehicle?.model || ''}`.trim() || 'כלי השייט';

  return (
    <div dir="rtl" className="pb-24">
      {/* Header */}
      <div className="px-4 pt-4">
        <button
          onClick={() => navigate(`${createPageUrl('VehicleDetail')}?id=${vehicleId}`)}
          className="flex items-center gap-1 text-sm font-bold text-slate-500 hover:text-slate-700">
          <ArrowRight className="w-4 h-4" />
          חזרה ל{vesselName}
        </button>

        <div className="mt-4 rounded-2xl p-5 text-white"
          style={{ background: THEME.grad, boxShadow: '0 8px 24px rgba(12,123,147,0.25)' }}>
          <div className="flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5" />
            <h1 className="text-xl font-black">צ'ק ליסטים</h1>
          </div>
          <p className="text-xs mt-1 opacity-80">
            בחר שלב להתחלת בדיקה. הרשימה שמורה אצלך וניתנת לעריכה.
          </p>
        </div>
      </div>

      {/* Phase cards */}
      <div className="px-4 mt-4 space-y-3">
        {phaseCards.map(({ phase, template, run, status }) => (
          <PhaseCard
            key={phase}
            phase={phase}
            template={template}
            run={run}
            status={status}
            onOpen={() => navigate(`${createPageUrl('Checklist')}?vehicleId=${vehicleId}&phase=${phase}`)}
            onEdit={() => navigate(`${createPageUrl('ChecklistEditor')}?vehicleId=${vehicleId}&phase=${phase}`)}
          />
        ))}
      </div>

      {/* Footer actions */}
      <div className="px-4 mt-6 flex gap-2">
        <button
          onClick={() => navigate(`${createPageUrl('ChecklistHistory')}?vehicleId=${vehicleId}`)}
          className="flex-1 h-10 rounded-xl text-sm font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-all">
          היסטוריה
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function PhaseCard({ phase, template, run, status, onOpen, onEdit }) {
  const Icon = PHASE_ICONS[phase] || ClipboardCheck;
  const label = PHASE_LABELS[phase];

  let statusLine = null;
  let cta = null;
  let ctaSecondary = null;

  if (status === 'empty') {
    statusLine = <span className="text-slate-500">אין עדיין תבנית</span>;
    cta = { label: 'בנה צ\'ק ליסט ראשון', onClick: onEdit };
  } else if (status === 'ready') {
    const count = (template.items.sections || []).reduce((n, s) => n + (s.items?.length || 0), 0);
    statusLine = <span className="text-slate-500">{count} פריטים מוכנים</span>;
    cta = { label: 'התחל בדיקה', onClick: onOpen };
  } else if (status === 'draft') {
    const totalItems = (run.items || []).length;
    const done = (run.items || []).filter(i => i.status && i.status !== 'pending').length;
    statusLine = (
      <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md text-[11px] font-bold">
        טיוטה: {done}/{totalItems}
      </span>
    );
    cta = { label: 'המשך', onClick: onOpen };
  } else if (status === 'done_today') {
    statusLine = (
      <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md text-[11px] font-bold">
        <CheckCircle2 className="w-3 h-3" /> בוצע היום
      </span>
    );
    cta = { label: 'בדיקה נוספת', onClick: onOpen, secondary: true };
    ctaSecondary = { label: 'צפה', onClick: onOpen };
  } else if (status === 'done_past') {
    statusLine = <span className="text-slate-500">בוצע לפני {fmtAgo(run.completed_at)}</span>;
    cta = { label: 'התחל בדיקה חדשה', onClick: onOpen };
  }

  return (
    <div className="bg-white rounded-2xl p-4 border border-slate-200" dir="rtl">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: THEME.tint }}>
          <Icon className="w-5 h-5" style={{ color: THEME.primary }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-slate-800">{label}</p>
          <p className="text-xs mt-0.5">{statusLine}</p>
        </div>
        <button
          onClick={onEdit}
          className="text-slate-400 hover:text-slate-700 p-1"
          aria-label="ערוך תבנית">
          <Edit3 className="w-4 h-4" />
        </button>
      </div>

      <div className="mt-3 flex gap-2">
        {cta && (
          <button onClick={cta.onClick}
            className={`flex-1 h-10 rounded-xl font-bold text-sm transition-all active:translate-y-px
              ${cta.secondary ? 'border-2' : 'text-white'}`}
            style={cta.secondary
              ? { borderColor: THEME.primary, color: THEME.primary, background: 'white' }
              : { background: THEME.grad, boxShadow: '0 4px 12px rgba(12,123,147,0.25)' }
            }>
            {cta.label}
          </button>
        )}
        {ctaSecondary && (
          <button onClick={ctaSecondary.onClick}
            className="h-10 px-4 rounded-xl font-bold text-sm bg-slate-100 text-slate-700 hover:bg-slate-200">
            {ctaSecondary.label}
          </button>
        )}
      </div>
    </div>
  );
}
