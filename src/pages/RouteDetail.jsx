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
  Calendar, Truck, MapPin, Clock,
  Flag,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import useAccountRole from '@/hooks/useAccountRole';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import { useAuth } from '@/components/shared/GuestContext';
import MobileBackButton from '@/components/shared/MobileBackButton';
import { Textarea } from '@/components/ui/textarea';
import NavigateButton from '@/components/map/NavigateButton';
import { colorForStop, findNextStopIndex, isStopTerminal } from '@/components/map/stopColors';

// Status pill labels per gender. The route is masculine in Hebrew
// ("מסלול"), the stop is feminine ("תחנה") — that's why the same
// status code maps to different forms.
const ROUTE_STATUS_PILL = {
  pending:     { label: 'מתוזמן', cls: 'bg-gray-100  text-gray-700' },
  in_progress: { label: 'בביצוע', cls: 'bg-blue-100  text-blue-700' },
  completed:   { label: 'הושלם',  cls: 'bg-green-100 text-green-700' },
  cancelled:   { label: 'בוטל',   cls: 'bg-red-100   text-red-700' },
};
const STOP_STATUS_PILL = {
  pending:     { label: 'מתוזמנת',     cls: 'bg-gray-100   text-gray-700' },
  in_progress: { label: 'בביצוע',      cls: 'bg-blue-100   text-blue-700' },
  completed:   { label: 'הושלמה',      cls: 'bg-green-100  text-green-700' },
  failed:      { label: 'נכשלה',       cls: 'bg-red-100    text-red-700' },
  overdue:     { label: 'באיחור',      cls: 'bg-amber-100  text-amber-700' },
  // Legacy values still rendered for old rows:
  skipped:     { label: 'דולגה',       cls: 'bg-yellow-100 text-yellow-700' },
  issue:       { label: 'תקלה מדווחת', cls: 'bg-red-100    text-red-700' },
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

  const { data: route, isLoading: routeLoading } = useQuery({
    queryKey: ['route', routeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('routes')
        .select('*')
        .eq('id', routeId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!routeId,
  });

  const { data: stops = [], isLoading: stopsLoading } = useQuery({
    queryKey: ['route-stops', routeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('route_stops')
        .select('*')
        .eq('route_id', routeId)
        .order('sequence', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!routeId,
  });

  const { data: team = [] } = useQuery({
    queryKey: ['route-team-directory', route?.account_id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('workspace_team_directory', {
        p_account_id: route.account_id,
      });
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

  return (
    <div dir="rtl" className="max-w-2xl mx-auto py-2">
      <MobileBackButton />
      <div className="bg-white border border-gray-100 rounded-2xl p-4 mb-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <h1 className="text-lg font-bold text-gray-900 flex-1">{route.title}</h1>
          <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${status.cls}`}>
            {status.label}
          </span>
        </div>
        {route.scheduled_for && (
          <p className="text-[11px] text-gray-500 flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {new Date(route.scheduled_for).toLocaleDateString('he-IL')}
          </p>
        )}
        {route.notes && <p className="text-xs text-gray-700 mt-2 leading-relaxed">{route.notes}</p>}

        {totalCount > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <div className="flex items-center justify-between text-[11px] mb-1.5">
              <span className="font-bold text-gray-700">התקדמות המשימה</span>
              <span className="text-gray-500">{completedCount} מתוך {totalCount} תחנות</span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-[#2D5233] transition-all duration-300" style={{ width: progressPct + '%' }} />
            </div>
          </div>
        )}

        <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-3 text-[11px] text-gray-500">
          <span className="flex items-center gap-1"><Truck className="h-3 w-3" /> רכב משויך</span>
          {route.assigned_driver_user_id && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" /> נהג: {assignedDriverName}
            </span>
          )}
        </div>
      </div>

      <h2 className="text-sm font-bold text-gray-700 mb-2">תחנות במשימה</h2>

      <div className="space-y-2">
        {stops.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-6">לא הוגדרו תחנות למשימה זו.</p>
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
    </div>
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
      if (msg.includes('forbidden')) toast.error('אין לך הרשאה לעדכן את התחנה הזו');
      else if (msg.includes('invalid_status')) toast.error('סטטוס לא תקף');
      else                            toast.error('עדכון התחנה נכשל. נסה שוב.');
      // eslint-disable-next-line no-console
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
      if (msg.includes('forbidden')) toast.error('אין לך הרשאה להוסיף הערה');
      else                            toast.error('שמירת ההערה נכשלה. נסה שוב.');
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
      if (msg.includes('forbidden')) toast.error('אין לך הרשאה לדווח על תקלה');
      else                            toast.error('דיווח התקלה נכשל. נסה שוב.');
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
    <div className={`bg-white border rounded-xl p-3 ${
      isNext && !terminal ? 'border-[#2D5233]/40 ring-1 ring-[#2D5233]/20' : 'border-gray-100'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center text-white"
              style={{ background: colorForStop(stop.status) }}
            >
              {stop.sequence}
            </span>
            <p className="text-sm font-bold text-gray-900 truncate">{stop.title}</p>
            {isNext && !terminal && (
              <span className="text-[10px] font-bold text-[#2D5233] bg-[#E8F2EA] px-1.5 py-0.5 rounded-md flex items-center gap-1">
                <Flag className="h-2.5 w-2.5" />
                תחנה הבאה
              </span>
            )}
          </div>
          {stop.address_text && (
            <p className="text-[11px] text-gray-500 flex items-center gap-1 mb-1.5">
              <MapPin className="h-3 w-3 shrink-0" /> {stop.address_text}
              {!Number.isFinite(stop.latitude) && (
                <span className="text-[10px] text-amber-700 mr-1 flex items-center gap-1">
                  <AlertTriangle className="h-2.5 w-2.5" />
                  כתובת לא אומתה במפה
                </span>
              )}
            </p>
          )}
          {stop.notes && <p className="text-[11px] text-gray-600">{stop.notes}</p>}
          {stop.planned_time && (
            <p className="text-[11px] text-gray-500 flex items-center gap-1 mt-0.5">
              <Clock className="h-3 w-3" />
              {new Date(stop.planned_time).toLocaleString('he-IL')}
            </p>
          )}
          {stop.completion_note && (
            <p className="text-[11px] text-gray-700 bg-gray-50 rounded-md px-2 py-1 mt-1.5">
              📝 {stop.completion_note}
            </p>
          )}
        </div>
        <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${status.cls}`}>
          {status.label}
        </span>
      </div>

      {(showCompleteIssue || destination) && (
        <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-2">
          {destination && (
            <NavigateButton destination={destination} variant="compact" label="נווט" />
          )}
          {canArrive && (
            <button
              type="button" disabled={busy}
              onClick={() => callStopRpc('in_progress', null, 'סומן: הגעתי לתחנה')}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-xs font-bold active:scale-[0.98] disabled:opacity-60">
              <Flag className="h-3.5 w-3.5" /> הגעתי
            </button>
          )}
          {showCompleteIssue && (
            <>
              <button
                type="button" disabled={busy}
                onClick={() => callStopRpc('completed', null, 'התחנה סומנה כהושלמה')}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-green-50 text-green-700 text-xs font-bold active:scale-[0.98] disabled:opacity-60">
                <CheckCircle2 className="h-3.5 w-3.5" /> סמן הושלמה
              </button>
              <button
                type="button" disabled={busy}
                onClick={() => setIssueOpen(o => !o)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-50 text-red-700 text-xs font-bold active:scale-[0.98] disabled:opacity-60">
                <AlertTriangle className="h-3.5 w-3.5" /> דווח על תקלה
              </button>
              <button
                type="button" disabled={busy}
                onClick={() => setNoteOpen(o => !o)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-700 text-xs font-bold active:scale-[0.98] disabled:opacity-60">
                <MessageSquarePlus className="h-3.5 w-3.5" /> כתוב הערה
              </button>
            </>
          )}
        </div>
      )}

      {noteOpen && (
        <div className="mt-2 space-y-2">
          <Textarea
            value={noteText} onChange={(e) => setNoteText(e.target.value)}
            placeholder="הערה לתחנה. מה קרה, מה צריך לדעת" rows={3}
            className="rounded-xl text-xs"
          />
          <div className="flex gap-2">
            <button type="button" onClick={submitNote} disabled={busy || !noteText.trim()}
              className="px-3 py-1.5 rounded-lg bg-[#2D5233] text-white text-xs font-bold disabled:opacity-50">
              שמור הערה
            </button>
            <button type="button" onClick={() => { setNoteOpen(false); setNoteText(''); }}
              className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 text-xs">
              ביטול
            </button>
          </div>
        </div>
      )}

      {issueOpen && (
        <div className="mt-2 space-y-2">
          <Textarea
            value={issueText} onChange={(e) => setIssueText(e.target.value)}
            placeholder="תאר את התקלה. שער נעול, אין מענה, רכב פגום" rows={3}
            className="rounded-xl text-xs"
          />
          <div className="flex gap-2">
            <button type="button" onClick={submitIssue} disabled={busy || !issueText.trim()}
              className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold disabled:opacity-50">
              דווח על תקלה
            </button>
            <button type="button" onClick={() => { setIssueOpen(false); setIssueText(''); }}
              className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 text-xs">
              ביטול
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Empty({ text }) {
  return (
    <div dir="rtl" className="max-w-md mx-auto py-16 text-center">
      <p className="text-xs text-gray-500">{text}</p>
    </div>
  );
}

