/**
 * Phase 6 — Route Detail.
 *
 * One page, two modes:
 *   - Manager: read-only timeline; can see status, stops, documentation.
 *   - Assigned driver: action buttons per stop —
 *       • סמן הושלם (mark completed)
 *       • דווח תקלה (report issue + note)
 *       • הוסף הערה (add note documentation)
 *
 * RLS makes the page robust by design: a user without read access to
 * the route gets an empty payload from supabase, which we render as
 * "route not found".
 */
import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2, AlertTriangle, MessageSquarePlus,
  Calendar, Truck, MapPin, Clock, Navigation,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import useAccountRole from '@/hooks/useAccountRole';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import { useAuth } from '@/components/shared/GuestContext';

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
  pending:   { label: 'מתוזמנת',     cls: 'bg-gray-100   text-gray-700' },
  completed: { label: 'הושלמה',      cls: 'bg-green-100  text-green-700' },
  skipped:   { label: 'דולגה',       cls: 'bg-yellow-100 text-yellow-700' },
  issue:     { label: 'תקלה מדווחת', cls: 'bg-red-100    text-red-700' },
};

const routePill = (status) => ROUTE_STATUS_PILL[status] || ROUTE_STATUS_PILL.pending;
const stopPill  = (status) => STOP_STATUS_PILL[status]  || STOP_STATUS_PILL.pending;

export default function RouteDetail() {
  const { user } = useAuth();
  const { accountId } = useAccountRole();
  const { canManageRoutes, canDriveRoutes } = useWorkspaceRole();
  const location = useLocation();
  const queryClient = useQueryClient();

  const routeId = new URLSearchParams(location.search).get('id');

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

  if (!routeId) {
    return <Empty text="הקישור חסר מזהה משימה. חזור לרשימת המשימות ונסה שוב." />;
  }
  if (routeLoading || stopsLoading) {
    return <div dir="rtl" className="text-center py-16 text-xs text-gray-400">טוען משימה...</div>;
  }
  if (!route) {
    return <Empty text="המשימה לא נמצאה, או שאין לך הרשאה לצפות בה." />;
  }

  // Driver actions only allowed if the user is the assigned driver of
  // THIS route (not just any 'driver' in the workspace) and active
  // workspace matches the route's account.
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
  };

  const status = routePill(route.status);
  const completedCount = stops.filter(s => s.status === 'completed').length;
  const totalCount     = stops.length;
  const progressPct    = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <div dir="rtl" className="max-w-2xl mx-auto py-2">
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
              <Clock className="h-3 w-3" /> נהג: {route.assigned_driver_user_id.slice(0, 8)}
            </span>
          )}
        </div>
      </div>

      <h2 className="text-sm font-bold text-gray-700 mb-2">תחנות במשימה</h2>
      <div className="space-y-2">
        {stops.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-6">לא הוגדרו תחנות למשימה זו.</p>
        ) : (
          stops.map(stop => (
            <StopCard
              key={stop.id}
              stop={stop}
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

function StopCard({ stop, canActAsDriver, canActAsManager, onChange }) {
  const status = stopPill(stop.status);
  const canAct = canActAsDriver || canActAsManager;
  const [busy, setBusy] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueText, setIssueText] = useState('');

  const callStopRpc = async (newStatus, completionNote) => {
    setBusy(true);
    try {
      const { error } = await supabase.rpc('update_stop_status', {
        p_stop_id: stop.id,
        p_status:  newStatus,
        p_note:    completionNote || null,
      });
      if (error) throw error;
      toast.success(newStatus === 'completed' ? 'התחנה סומנה כהושלמה' : 'סטטוס התחנה עודכן');
      onChange?.();
    } catch (err) {
      const msg = err?.message || '';
      if (msg.includes('forbidden')) toast.error('אין לך הרשאה לעדכן את התחנה הזו');
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
      // Two writes: status flip + documentation entry. Status flip
      // first; if documentation fails the manager still sees the issue.
      const { error: statusErr } = await supabase.rpc('update_stop_status', {
        p_stop_id: stop.id,
        p_status:  'issue',
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

  const isDone = stop.status !== 'pending';

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-5 h-5 rounded-full bg-gray-100 text-[10px] font-bold flex items-center justify-center text-gray-600">
              {stop.sequence}
            </span>
            <p className="text-sm font-bold text-gray-900 truncate">{stop.title}</p>
          </div>
          {stop.address_text && (
            <div className="mb-1.5">
              <p className="text-[11px] text-gray-500 flex items-center gap-1 mb-1">
                <MapPin className="h-3 w-3" /> {stop.address_text}
              </p>
              {/* Waze + Google Maps deep-links. The Waze "ul" universal
                  link opens the native app on iOS/Android and falls
                  back to the web client on desktop. Google Maps is
                  the safety net for users who don't have Waze
                  installed. Both are external links — open in a new
                  context so the driver can flip back to the task
                  card without losing their place. */}
              <div className="flex flex-wrap gap-1.5">
                <a
                  href={`https://waze.com/ul?q=${encodeURIComponent(stop.address_text)}&navigate=yes`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#33CCFF]/10 text-[#0A8FB3] text-[10px] font-bold border border-[#33CCFF]/30 active:scale-[0.97]"
                >
                  <Navigation className="h-3 w-3" />
                  פתח בוויז
                </a>
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(stop.address_text)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-gray-100 text-gray-700 text-[10px] font-bold border border-gray-200 active:scale-[0.97]"
                >
                  <MapPin className="h-3 w-3" />
                  Google Maps
                </a>
              </div>
            </div>
          )}
          {stop.notes && <p className="text-[11px] text-gray-600">{stop.notes}</p>}
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

      {canAct && !isDone && (
        <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-2">
          <button
            type="button" disabled={busy}
            onClick={() => callStopRpc('completed', null)}
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
        </div>
      )}

      {noteOpen && (
        <div className="mt-2 space-y-2">
          <textarea
            value={noteText} onChange={(e) => setNoteText(e.target.value)}
            placeholder="הערה לתחנה. מה קרה, מה צריך לדעת" rows={3}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-xs"
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
          <textarea
            value={issueText} onChange={(e) => setIssueText(e.target.value)}
            placeholder="תאר את התקלה. שער נעול, אין מענה, רכב פגום" rows={3}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-xs"
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
