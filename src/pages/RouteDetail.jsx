/**
 * Phase 6 / 12 — Route Detail.
 *
 * One page, two modes:
 *   - Manager: read-only timeline with optional map view.
 *   - Assigned driver: action buttons per stop —
 *       • הגעתי     (sets arrived_at + status=in_progress)
 *       • סמן הושלמה (status=completed, completed_at=now)
 *       • דווח על תקלה (status=failed via the wider enum)
 *       • הוסף הערה  (add documentation)
 *       • נווט      (external Waze / Google Maps via NavigateButton)
 *
 * Map view is lazy-loaded only after the user clicks the toggle —
 * Leaflet is heavy and the driver doesn't always need it.
 *
 * RLS makes the page robust by design: a user without read access to
 * the route gets an empty payload from supabase, which we render as
 * "route not found".
 */
import React, { useState, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2, AlertTriangle, MessageSquarePlus,
  Truck, MapPin, Clock, Flag,
} from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '@/lib/userErrorReport';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/supabaseQuery';
import SystemErrorBanner from '@/components/shared/SystemErrorBanner';
import useAccountRole from '@/hooks/useAccountRole';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import { useAuth } from '@/components/shared/GuestContext';
import { Textarea } from '@/components/ui/textarea';
import NavigateButton from '@/components/map/NavigateButton';
import { colorForStop, findNextStopIndex, isStopTerminal } from '@/components/map/stopColors';
// Living Dashboard system - shared with all B2B pages.
import {
  PageShell,
  Card,
  KpiTile,
  AnimatedCount,
} from '@/components/business/system';
import { C } from '@/lib/designTokens';

// Status meta — pill colors AND a Card accent keyed to the Living
// Dashboard palette so each row's stripe matches its pill at a glance.
// Hebrew gender note: route is masculine ("מסלול"), stop is feminine
// ("תחנה") — same status code maps to different forms.
const ROUTE_STATUS_PILL = {
  pending:     { label: 'מתוזמן', accent: 'amber',   chipBg: C.warnBg, chipFg: C.warnDark },
  in_progress: { label: 'בביצוע', accent: 'blue',    chipBg: C.infoBg, chipFg: C.infoDark },
  completed:   { label: 'הושלם',  accent: 'emerald', chipBg: C.successLight, chipFg: C.successDark },
  cancelled:   { label: 'בוטל',   accent: 'red',     chipBg: C.errorLight, chipFg: C.errorDark },
};
const STOP_STATUS_PILL = {
  pending:     { label: 'מתוזמנת',     accent: 'amber',   chipBg: C.warnBg, chipFg: C.warnDark },
  in_progress: { label: 'בביצוע',      accent: 'blue',    chipBg: C.infoBg, chipFg: C.infoDark },
  completed:   { label: 'הושלמה',      accent: 'emerald', chipBg: C.successLight, chipFg: C.successDark },
  failed:      { label: 'נכשלה',       accent: 'red',     chipBg: C.errorLight, chipFg: C.errorDark },
  overdue:     { label: 'באיחור',      accent: 'amber',   chipBg: C.warnBg, chipFg: C.warnDark },
  // Legacy values still rendered for old rows:
  skipped:     { label: 'דולגה',       accent: 'amber',   chipBg: C.warnSubtle, chipFg: C.warnDark },
  issue:       { label: 'תקלה מדווחת', accent: 'red',     chipBg: C.errorLight, chipFg: C.errorDark },
};

const routePill = (status) => ROUTE_STATUS_PILL[status] || ROUTE_STATUS_PILL.pending;
const stopPill  = (status) => STOP_STATUS_PILL[status]  || STOP_STATUS_PILL.pending;

export default function RouteDetail() {
  const { user } = useAuth();
  const { accountId } = useAccountRole();
  const { canManageRoutes, canDriveRoutes } = useWorkspaceRole();
  const location = useLocation();
  const queryClient = useQueryClient();

  const params = new URLSearchParams(location.search);
  const routeId = params.get('id');

  const { data: route, isLoading: routeLoading, isError: routeError, refetch: refetchRoute } = useQuery({
    queryKey: ['route', routeId],
    queryFn: async () => {
      const { data, error } = await withTimeout(supabase
        .from('routes')
        .select('*')
        .eq('id', routeId)
        .maybeSingle(), 'route_detail');
      if (error) throw error;
      return data;
    },
    enabled: !!routeId,
  });

  const { data: stops = [], isLoading: stopsLoading, isError: stopsError, refetch: refetchStops } = useQuery({
    queryKey: ['route-stops', routeId],
    queryFn: async () => {
      const { data, error } = await withTimeout(supabase
        .from('route_stops')
        .select('*')
        .eq('route_id', routeId)
        .order('sequence', { ascending: true }), 'route_detail_stops');
      if (error) throw error;
      return data || [];
    },
    enabled: !!routeId,
  });

  const { data: team = [] } = useQuery({
    queryKey: ['route-team-directory', route?.account_id],
    queryFn: async () => {
      const { data, error } = await withTimeout(supabase.rpc('workspace_team_directory', {
        p_account_id: route.account_id,
      }), 'route_detail_team');
      if (error) throw error;
      return data || [];
    },
    enabled: !!route?.account_id,
    staleTime: 5 * 60 * 1000,
  });

  // Index of the next un-terminal stop — used to highlight on the map
  // and to drive the per-stop "הגעתי" button visibility.
  const nextStopIndex = useMemo(() => findNextStopIndex(stops), [stops]);

  if (!routeId) {
    return <Empty text="הקישור חסר מזהה משימה. חזור לרשימת המשימות ונסה שוב." />;
  }
  if (routeLoading || stopsLoading) {
    return <div dir="rtl" className="text-center py-16 text-xs text-gray-400">טוען משימה...</div>;
  }
  // A load error must not be mistaken for "route not found" — offer retry.
  if (routeError || stopsError) {
    return (
      <div dir="rtl" className="max-w-md mx-auto py-10 px-4">
        <SystemErrorBanner
          message="טעינת המשימה נכשלה. בדוק את החיבור ונסה שוב."
          onRetry={() => { refetchRoute(); refetchStops(); }}
        />
      </div>
    );
  }
  if (!route) {
    return <Empty text="המשימה לא נמצאה, או שאין לך הרשאה לצפות בה." />;
  }

  const isThisRoutesDriver =
    canDriveRoutes
    && user?.id
    && route.assigned_driver_user_id === user.id
    && route.account_id === accountId;
  const isThisRoutesManager = canManageRoutes && route.account_id === accountId;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['route', routeId] });
    queryClient.invalidateQueries({ queryKey: ['route-stops', routeId] });
    queryClient.invalidateQueries({ queryKey: ['routes'] });
    queryClient.invalidateQueries({ queryKey: ['routes-paged'] });
    queryClient.invalidateQueries({ queryKey: ['routes-driver'] });
    queryClient.invalidateQueries({ queryKey: ['routes-stops'] });
  };

  const status = routePill(route.status);
  const completedCount = stops.filter(s => s.status === 'completed').length;
  const totalCount     = stops.length;
  const progressPct    = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const assignedDriver = team.find(m => m.user_id === route.assigned_driver_user_id);
  const assignedDriverName = assignedDriver?.display_name || assignedDriver?.email || 'נהג משויך';

  // The unified Fleet Map (manager) is the single source of truth for
  // map views. RouteDetail intentionally renders a list-only timeline —
  // map markers/polylines for this one task live on /FleetMap, where
  // every workspace task is plotted together with per-task coloring.

  const remainingCount = totalCount - completedCount;
  const inProgressCount = stops.filter(s => s.status === 'in_progress').length;

  return (
    <PageShell
      backTo="Routes"
      title={route.title}
      subtitle={route.scheduled_for
        ? `מתוזמן ל-${new Date(route.scheduled_for).toLocaleDateString('he-IL')}`
        : 'משימה ללא תאריך'}
      actions={(
        <span
          className="px-3 py-1.5 rounded-full text-[11px] font-bold"
          style={{ background: status.chipBg, color: status.chipFg }}
        >
          {status.label}
        </span>
      )}
    >
      {/* Hero card — meta of the route + progress bar */}
      <Card accent={status.accent} className="mb-4">
        <div className="flex items-center gap-3 flex-wrap text-[11px]" style={{ color: C.textAlt }}>
          <span className="inline-flex items-center gap-1">
            <Truck className="h-3.5 w-3.5" style={{ color: C.successBright }} />
            רכב משויך
          </span>
          {route.assigned_driver_user_id && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" style={{ color: C.successBright }} />
              נהג: <span className="font-bold" style={{ color: C.primaryDark }}>{assignedDriverName}</span>
            </span>
          )}
        </div>
        {route.notes && (
          <p className="text-xs mt-2 leading-relaxed" style={{ color: C.primaryDark }}>{route.notes}</p>
        )}
        {totalCount > 0 && (
          <div className="mt-4 pt-3" style={{ borderTop: `1px solid ${C.bgSubtle}` }}>
            <div className="flex items-center justify-between text-[11px] mb-1.5">
              <span className="font-bold" style={{ color: C.primaryDark }}>התקדמות המשימה</span>
              <span className="tabular-nums" style={{ color: C.textAlt }} dir="ltr">
                {completedCount} / {totalCount} · {progressPct}%
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: C.bgSubtle }}>
              <div
                className="h-full transition-all duration-500"
                style={{
                  width: progressPct + '%',
                  background: `linear-gradient(90deg, ${C.successDark} 0%, ${C.successBright} 80%, ${C.successMid} 100%)`,
                }}
              />
            </div>
          </div>
        )}
      </Card>

      {/* KPI Strip — the route at a glance */}
      {totalCount > 0 && (
        <section className="grid grid-cols-3 gap-3 mb-4">
          <KpiTile
            label="סה״כ תחנות"
            value={<AnimatedCount value={totalCount} />}
            sub="במשימה"
            tone="emerald"
          />
          <KpiTile
            label="הושלמו"
            value={<AnimatedCount value={completedCount} />}
            sub={completedCount === totalCount && totalCount > 0 ? 'משימה הושלמה' : `${progressPct}% מהמשימה`}
            tone="purple"
          />
          <KpiTile
            label={inProgressCount > 0 ? 'בביצוע' : 'נותרו'}
            value={<AnimatedCount value={inProgressCount > 0 ? inProgressCount : remainingCount} />}
            sub={inProgressCount > 0 ? 'תחנה פעילה' : remainingCount === 0 ? 'אין מה להמשיך' : 'לטיפול'}
            tone={inProgressCount > 0 ? 'blue' : 'amber'}
          />
        </section>
      )}

      <h2 className="text-sm font-bold mb-2.5 flex items-center gap-2" style={{ color: C.primaryDark }}>
        <span
          className="inline-block w-1 h-4 rounded-full"
          style={{ background: `linear-gradient(180deg, ${C.successDark} 0%, ${C.successMid} 100%)` }}
        />
        תחנות במשימה
      </h2>

      <div className="space-y-2">
        {stops.length === 0 ? (
          <Card className="text-center py-8">
            <p className="text-xs" style={{ color: C.borderAlt }}>לא הוגדרו תחנות למשימה זו.</p>
          </Card>
        ) : (
          stops.map((stop, idx) => (
            <StopCard
              key={stop.id}
              stop={stop}
              isNext={idx === nextStopIndex}
              canActAsDriver={isThisRoutesDriver}
              canActAsManager={isThisRoutesManager}
              onChange={refresh}
            />
          ))
        )}
      </div>
    </PageShell>
  );
}

function StopCard({ stop, isNext, canActAsDriver, canActAsManager, onChange }) {
  const status = stopPill(stop.status);
  const canAct = canActAsDriver || canActAsManager;
  const [busy, setBusy] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueText, setIssueText] = useState('');

  const callStopRpc = async (newStatus, completionNote, successMsg) => {
    setBusy(true);
    try {
      const { error } = await supabase.rpc('update_stop_status', {
        p_stop_id: stop.id,
        p_status:  newStatus,
        p_note:    completionNote || null,
      });
      if (error) throw error;
      toast.success(successMsg || 'סטטוס התחנה עודכן');
      onChange?.();
    } catch (err) {
      const msg = err?.message || '';
      if (msg.includes('forbidden')) toastError('אין לך הרשאה לעדכן את התחנה הזו', { action: 'route_stop_forbidden', err });
      else if (msg.includes('invalid_status')) toastError('סטטוס לא תקף', { action: 'route_stop_invalid_status', err });
      else                            toastError('עדכון התחנה נכשל. נסה שוב.', { action: 'route_stop_update', err });
       
      console.error('update_stop_status failed:', err);
    } finally {
      setBusy(false);
    }
  };

  const submitNote = async () => {
    if (!noteText.trim()) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('add_stop_documentation', {
        p_stop_id: stop.id,
        p_kind:    'note',
        p_payload: { text: noteText.trim() },
      });
      if (error) throw error;
      toast.success('ההערה נשמרה');
      setNoteText('');
      setNoteOpen(false);
      onChange?.();
    } catch (err) {
      const msg = err?.message || '';
      if (msg.includes('forbidden')) toastError('אין לך הרשאה להוסיף הערה', { action: 'route_note_forbidden', err });
      else                            toastError('שמירת ההערה נכשלה. נסה שוב.', { action: 'route_note_save', err });
    } finally {
      setBusy(false);
    }
  };

  const submitIssue = async () => {
    if (!issueText.trim()) return;
    setBusy(true);
    try {
      const { error: statusErr } = await supabase.rpc('update_stop_status', {
        p_stop_id: stop.id,
        p_status:  'failed',
        p_note:    issueText.trim(),
      });
      if (statusErr) throw statusErr;
      await supabase.rpc('add_stop_documentation', {
        p_stop_id: stop.id,
        p_kind:    'issue',
        p_payload: { text: issueText.trim() },
      });
      toast.success('התקלה תועדה. המנהל יראה את הדיווח ביומן הפעילות.');
      setIssueText('');
      setIssueOpen(false);
      onChange?.();
    } catch (err) {
      const msg = err?.message || '';
      if (msg.includes('forbidden')) toastError('אין לך הרשאה לדווח על תקלה', { action: 'route_issue_forbidden', err });
      else                            toastError('דיווח התקלה נכשל. נסה שוב.', { action: 'route_issue_save', err });
    } finally {
      setBusy(false);
    }
  };

  const terminal = isStopTerminal(stop.status);
  const canArrive = canActAsDriver && !terminal && stop.status !== 'in_progress';
  const showCompleteIssue = canAct && !terminal;

  // Destination for the nav button. Coords win when present; otherwise
  // the address text gets handed off to Waze / Google for fuzzy match.
  const destination = (stop.address_text || (stop.latitude && stop.longitude))
    ? {
        lat: stop.latitude,
        lng: stop.longitude,
        address: stop.address_text || '',
      }
    : null;

  return (
    <Card
      accent={status.accent}
      padding="p-3.5"
      // Next-stop emphasis: emerald glow ring + slight base lift, so
      // the row reads as the active focal point in the timeline.
      style={isNext && !terminal ? {
        boxShadow: `0 0 0 2px ${C.successBright}, 0 8px 20px rgba(16,185,129,0.18)`,
        background: 'linear-gradient(180deg, #F0FDF6 0%, #FFFFFF 60%)',
      } : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span
              className="w-6 h-6 rounded-full text-[11px] font-black flex items-center justify-center text-white tabular-nums"
              style={{
                background: colorForStop(stop.status),
                boxShadow: '0 2px 8px rgba(15,40,28,0.18)',
              }}
              dir="ltr"
            >
              {stop.sequence}
            </span>
            <p className="text-sm font-bold truncate" style={{ color: C.primaryDark }}>{stop.title}</p>
            {isNext && !terminal && (
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-md flex items-center gap-1"
                style={{ background: C.successLight, color: C.successDark }}
              >
                <Flag className="h-2.5 w-2.5" />
                תחנה הבאה
              </span>
            )}
          </div>
          {stop.address_text && (
            <p className="text-[11px] flex items-center gap-1 mb-1.5 flex-wrap" style={{ color: C.mutedAlt }}>
              <MapPin className="h-3 w-3 shrink-0" style={{ color: C.successBright }} /> {stop.address_text}
              {!Number.isFinite(stop.latitude) && (
                <span
                  className="text-[10px] mr-1 flex items-center gap-1 px-1.5 py-0.5 rounded-md"
                  style={{ background: C.warnSubtle, color: C.warnDark }}
                >
                  <AlertTriangle className="h-2.5 w-2.5" />
                  כתובת לא אומתה במפה
                </span>
              )}
            </p>
          )}
          {stop.notes && <p className="text-[11px]" style={{ color: C.textAlt }}>{stop.notes}</p>}
          {stop.planned_time && (
            <p className="text-[11px] flex items-center gap-1 mt-0.5 tabular-nums" style={{ color: C.mutedAlt }} dir="ltr">
              <Clock className="h-3 w-3" />
              {new Date(stop.planned_time).toLocaleString('he-IL')}
            </p>
          )}
          {stop.completion_note && (
            <p
              className="text-[11px] rounded-md px-2 py-1 mt-1.5 leading-relaxed"
              style={{ background: C.bgSubtle, color: C.primaryDark }}
            >
              📝 {stop.completion_note}
            </p>
          )}
        </div>
        <span
          className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold"
          style={{ background: status.chipBg, color: status.chipFg }}
        >
          {status.label}
        </span>
      </div>

      {(showCompleteIssue || destination) && (
        <div className="mt-3 pt-3 flex flex-wrap gap-2" style={{ borderTop: `1px solid ${C.bgSubtle}` }}>
          {destination && (
            <NavigateButton destination={destination} variant="compact" label="נווט" />
          )}
          {canArrive && (
            <button
              type="button" disabled={busy}
              onClick={() => callStopRpc('in_progress', null, 'סומן: הגעתי לתחנה')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60"
              style={{ background: C.infoBg, color: C.infoDark }}
            >
              <Flag className="h-3.5 w-3.5" /> הגעתי
            </button>
          )}
          {showCompleteIssue && (
            <>
              <button
                type="button" disabled={busy}
                onClick={() => callStopRpc('completed', null, 'התחנה סומנה כהושלמה')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60"
                style={{
                  background: `linear-gradient(135deg, ${C.successDark} 0%, ${C.successBright} 80%, ${C.successMid} 100%)`,
                  color: '#FFFFFF',
                  boxShadow: '0 4px 12px rgba(16,185,129,0.25)',
                }}
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> סמן הושלמה
              </button>
              <button
                type="button" disabled={busy}
                onClick={() => setIssueOpen(o => !o)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60"
                style={{ background: C.errorLight, color: C.errorDark }}
              >
                <AlertTriangle className="h-3.5 w-3.5" /> דווח על תקלה
              </button>
              <button
                type="button" disabled={busy}
                onClick={() => setNoteOpen(o => !o)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60"
                style={{ background: '#FFFFFF', color: C.successBright, border: `1.5px solid ${C.successLight}` }}
              >
                <MessageSquarePlus className="h-3.5 w-3.5" /> כתוב הערה
              </button>
            </>
          )}
        </div>
      )}

      {noteOpen && (
        <div className="mt-2.5 space-y-2">
          <Textarea
            value={noteText} onChange={(e) => setNoteText(e.target.value)}
            placeholder="הערה לתחנה. מה קרה, מה צריך לדעת" rows={3}
            className="rounded-xl text-xs"
          />
          <div className="flex gap-2">
            <button type="button" onClick={submitNote} disabled={busy || !noteText.trim()}
              className="px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-50 transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{
                background: `linear-gradient(135deg, ${C.successDark} 0%, ${C.successBright} 80%, ${C.successMid} 100%)`,
                color: '#FFFFFF',
                boxShadow: '0 4px 12px rgba(16,185,129,0.25)',
              }}>
              שמור הערה
            </button>
            <button type="button" onClick={() => { setNoteOpen(false); setNoteText(''); }}
              className="px-3 py-2 rounded-xl text-xs"
              style={{ background: C.bgSubtle, color: C.textAlt }}>
              ביטול
            </button>
          </div>
        </div>
      )}

      {issueOpen && (
        <div className="mt-2.5 space-y-2">
          <Textarea
            value={issueText} onChange={(e) => setIssueText(e.target.value)}
            placeholder="תאר את התקלה. שער נעול, אין מענה, רכב פגום" rows={3}
            className="rounded-xl text-xs"
          />
          <div className="flex gap-2">
            <button type="button" onClick={submitIssue} disabled={busy || !issueText.trim()}
              className="px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-50 transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{ background: C.error, color: '#FFFFFF', boxShadow: '0 4px 12px rgba(220,38,38,0.25)' }}>
              דווח על תקלה
            </button>
            <button type="button" onClick={() => { setIssueOpen(false); setIssueText(''); }}
              className="px-3 py-2 rounded-xl text-xs"
              style={{ background: C.bgSubtle, color: C.textAlt }}>
              ביטול
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Empty({ text }) {
  return (
    <div dir="rtl" className="max-w-md mx-auto py-16 text-center">
      <p className="text-xs text-gray-500">{text}</p>
    </div>
  );
}

