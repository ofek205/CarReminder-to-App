/**
 * ChecklistHub. landing page for a vessel's checklists.
 *
 * URL: /ChecklistHub?vehicleId=<uuid>
 *
 * Shows:
 *   • 3 built-in phase cards (engine / pre / post).
 *   • Any user-created CUSTOM checklists as additional cards.
 *   • "צ'ק ליסט חדש" button for creating a new custom template.
 *
 * Each card reflects "what's the user's most relevant state for this
 * template right now":
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
import {
  ArrowRight, Wrench, Anchor, ClipboardCheck, CheckCircle2, Edit3, Plus, ListChecks,
} from 'lucide-react';
import { formatDistanceToNow, isToday } from 'date-fns';
import { he } from 'date-fns/locale';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import FirstTimeTour from '@/components/shared/FirstTimeTour';

// Mini tour shown on the first visit to /ChecklistHub for a vessel.
// Vessel palette to match the rest of the marine UI. Three short steps.
const HUB_TOUR_STEPS = [
  {
    key: 'ch-phase-cards',
    title: 'שלושה שלבים, כלי אחד',
    body: 'בדיקות מנוע לפני הנעה, הכנה לפני יציאה, וסיום לאחר חזרה. כל שלב נשמר בנפרד.',
  },
  {
    key: 'ch-new-button',
    title: 'צ\'ק ליסט מותאם',
    body: 'תן שם משלך ובנה רשימה לכל מטרה. לדוגמה: בדיקה עונתית או סריקה לפני העונה.',
  },
];

const PHASE_ICONS = {
  engine: Wrench,
  pre:    Anchor,
  post:   ClipboardCheck,
  custom: ListChecks,
};

// Marine teal palette. same as the vessel tour, keeps visual continuity.
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

/** Latest non-archived run for this template, if any. */
function latestRunForTemplate(runs, templateId, phase) {
  const candidates = (runs || [])
    .filter(r => !r.archived_at && (
      // Custom templates always match by template_id.
      // System phases historically used phase-only lookup, so fall back
      // to phase match when template_id is missing on older rows.
      r.template_id === templateId || (!r.template_id && r.phase === phase)
    ))
    .sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
  return candidates[0] || null;
}

/* -------------------------------------------------------------------------- */

export default function ChecklistHub() {
  const [params] = useSearchParams();
  const vehicleId = params.get('vehicleId');
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  // Vehicle header info
  const { data: vehicle } = useQuery({
    queryKey: ['vehicle', vehicleId],
    queryFn: async () => {
      const rows = await db.vehicles.filter({ id: vehicleId });
      return rows?.[0] || null;
    },
    enabled: !!vehicleId,
  });

  // All templates for this vessel (system phases + any custom).
  const { data: templates = [] } = useQuery({
    queryKey: ['vessel_checklists', vehicleId],
    queryFn: () => db.vessel_checklists.filter({ vehicle_id: vehicleId }),
    enabled: !!vehicleId,
  });

  // Runs (last 60 rows is plenty for hub state)
  const { data: runs = [], isLoading: runsLoading } = useQuery({
    queryKey: ['vessel_checklist_runs', vehicleId],
    queryFn: () => db.vessel_checklist_runs.filter(
      { vehicle_id: vehicleId },
      { order: { column: 'started_at', ascending: false }, limit: 60 }
    ),
    enabled: !!vehicleId,
  });

  // Q6. archive yesterday-or-older open drafts on mount.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs.length]);

  /**
   * Build the card list: 3 system phase cards (may not have a template
   * row yet) + one card per custom template.
   */
  const cards = useMemo(() => {
    const systemCards = PHASE_ORDER.map(phase => {
      const template = templates.find(t => t.phase === phase);
      return {
        key: `system-${phase}`,
        phase,
        template,
        templateId: template?.id || null,
        name: PHASE_LABELS[phase],
        isCustom: false,
      };
    });

    const customCards = templates
      .filter(t => t.phase === 'custom')
      .map(t => ({
        key: `custom-${t.id}`,
        phase: 'custom',
        template: t,
        templateId: t.id,
        name: t.name || 'צ\'ק ליסט',
        isCustom: true,
      }));

    return [...systemCards, ...customCards].map(card => {
      const hasTemplate = !!card.template &&
        Array.isArray(card.template.items?.sections) &&
        card.template.items.sections.length > 0;
      const run = latestRunForTemplate(runs, card.templateId, card.phase);

      let status = 'empty';
      if (run) {
        if (!run.completed_at) status = 'draft';
        else if (isToday(new Date(run.completed_at))) status = 'done_today';
        else status = 'done_past';
      } else if (hasTemplate) {
        status = 'ready';
      }

      return { ...card, run, status, hasTemplate };
    });
  }, [templates, runs]);

  const handleCreateCustom = async () => {
    const name = newName.trim();
    if (!name || !vehicle) return;
    setCreating(true);
    try {
      const created = await db.vessel_checklists.create({
        vehicle_id: vehicle.id,
        account_id: vehicle.account_id,
        phase: 'custom',
        name,
        items: { sections: [] },
      });
      qc.invalidateQueries({ queryKey: ['vessel_checklists', vehicleId] });
      setCreateOpen(false);
      setNewName('');
      navigate(`${createPageUrl('ChecklistEditor')}?vehicleId=${vehicleId}&templateId=${created.id}`);
    } catch (e) {
      if (import.meta.env.DEV) console.warn('[create custom]', e?.message);
      toast.error('יצירת הצ\'ק ליסט נכשלה');
    } finally {
      setCreating(false);
    }
  };

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

      {/* Tool-tip tour disabled — reserved for first-time users with no
          vehicles. Reaching this page means a vessel already exists. */}

      {/* Phase + custom cards */}
      <div className="px-4 mt-4 space-y-3" data-tour="ch-phase-cards">
        {cards.map((card) => (
          <PhaseCard
            key={card.key}
            card={card}
            onOpen={() => {
              // For custom templates we navigate with templateId so the
              // runner can load the right one. For system phases we keep
              // the phase param for backwards compat.
              const q = card.isCustom
                ? `vehicleId=${vehicleId}&templateId=${card.templateId}`
                : `vehicleId=${vehicleId}&phase=${card.phase}`;
              navigate(`${createPageUrl('Checklist')}?${q}`);
            }}
            onEdit={() => {
              const q = card.templateId
                ? `vehicleId=${vehicleId}&templateId=${card.templateId}`
                : `vehicleId=${vehicleId}&phase=${card.phase}`;
              navigate(`${createPageUrl('ChecklistEditor')}?${q}`);
            }}
          />
        ))}
      </div>

      {/* Footer actions */}
      <div className="px-4 mt-6 flex flex-col gap-2">
        <Button
          data-tour="ch-new-button"
          onClick={() => setCreateOpen(true)}
          className="w-full h-11 gap-2 text-white font-bold"
          style={{ background: THEME.grad, boxShadow: '0 4px 12px rgba(12,123,147,0.2)' }}>
          <Plus className="w-4 h-4" />
          צ'ק ליסט חדש
        </Button>
        <button
          onClick={() => navigate(`${createPageUrl('ChecklistHistory')}?vehicleId=${vehicleId}`)}
          className="w-full h-10 rounded-xl text-sm font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-all">
          היסטוריה
        </button>
      </div>

      {/* New custom checklist dialog */}
      <Dialog open={createOpen} onOpenChange={(v) => { if (!v) { setCreateOpen(false); setNewName(''); } }}>
        <DialogContent dir="rtl" className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>צ'ק ליסט חדש</DialogTitle>
            <DialogDescription>
              תן לו שם ברור. תוכל להוסיף קטגוריות ופריטים מיד אחר כך.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) handleCreateCustom(); }}
            placeholder="דוגמה: בדיקה עונתית, סריקה שבועית"
            autoFocus
            maxLength={60}
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setCreateOpen(false); setNewName(''); }}
              disabled={creating}>
              ביטול
            </Button>
            <Button onClick={handleCreateCustom}
              disabled={!newName.trim() || creating}
              style={{ background: THEME.primary, color: '#fff' }}>
              {creating ? 'יוצר…' : 'צור'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function PhaseCard({ card, onOpen, onEdit }) {
  const { phase, template, name, status, run, isCustom } = card;
  const Icon = PHASE_ICONS[phase] || ClipboardCheck;

  let statusLine = null;
  let cta = null;
  let ctaSecondary = null;

  if (status === 'empty') {
    statusLine = <span className="text-slate-500">{isCustom ? 'ריק, הוסף פריטים' : 'אין עדיין תבנית'}</span>;
    cta = { label: isCustom ? 'בנה' : 'בנה צ\'ק ליסט ראשון', onClick: onEdit };
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
          <p className="font-bold text-slate-800 truncate">{name}</p>
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
