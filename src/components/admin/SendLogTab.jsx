import React, { useState } from 'react';
import { Loader2, CheckCircle2, XCircle, Clock, MinusCircle } from 'lucide-react';
import { useSendLog, useEmailNotifications } from '@/hooks/useEmailAdmin';

const STATUS_VISUAL = {
  sent:    { icon: CheckCircle2, label: 'נשלח',  bg: '#D1FAE5', fg: '#047857' },
  queued:  { icon: Clock,        label: 'בתור',  bg: '#FEF3C7', fg: '#92400E' },
  failed:  { icon: XCircle,      label: 'נכשל',  bg: '#FEE2E2', fg: '#991B1B' },
  skipped: { icon: MinusCircle,  label: 'דולג', bg: '#F3F4F6', fg: '#6B7280' },
};

/**
 * SendLogTab — recent dispatch history.
 *
 * Read-only table of the last 100 send attempts, grouped by status, with
 * basic filtering. Admins can click a row to see the metadata (template
 * variables, error message, Resend message id).
 */
export default function SendLogTab() {
  const [filter, setFilter] = useState('');
  const { data: log = [], isLoading } = useSendLog({ limit: 100, notificationKey: filter || undefined });
  const { data: notifications = [] } = useEmailNotifications();
  const [expanded, setExpanded] = useState(null);

  const nameFor = (key) => notifications.find(n => n.key === key)?.display_name || key;

  if (isLoading) {
    return <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }

  return (
    <div dir="rtl" className="space-y-4">

      {/* Filter */}
      <div className="flex items-center gap-3 rounded-2xl p-3 bg-white border">
        <label className="text-xs font-bold text-gray-700">סוג:</label>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="text-xs rounded-lg border border-gray-300 px-2 py-1.5 bg-white">
          <option value="">הכל</option>
          {notifications.map(n => (
            <option key={n.key} value={n.key}>{n.display_name}</option>
          ))}
        </select>
        <span className="text-xs text-gray-500 mr-auto">{log.length} רשומות</span>
      </div>

      {/* Log list */}
      {log.length === 0 ? (
        <div className="text-sm text-gray-500 py-12 text-center rounded-2xl bg-white border">
          אין רשומות לוג עדיין. המערכת תתחיל לתעד ברגע שה-dispatcher ירוץ.
        </div>
      ) : (
        log.map(row => {
          const v = STATUS_VISUAL[row.status] || STATUS_VISUAL.sent;
          const Icon = v.icon;
          const isOpen = expanded === row.id;
          return (
            <div key={row.id} className="rounded-2xl bg-white border overflow-hidden">
              <button
                onClick={() => setExpanded(isOpen ? null : row.id)}
                className="w-full p-3 flex items-center gap-3 hover:bg-gray-50 transition text-right">
                <div className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: v.bg }}>
                  <Icon className="w-4 h-4" style={{ color: v.fg }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm" style={{ color: '#1C2E20' }}>{nameFor(row.notification_key)}</span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: v.bg, color: v.fg }}>
                      {v.label}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 truncate">
                    {row.recipient_email}
                    {row.reference_date && <span> &middot; תאריך יעד: {new Date(row.reference_date).toLocaleDateString('he-IL')}</span>}
                  </div>
                </div>
                <div className="text-[11px] text-gray-400 shrink-0">
                  {new Date(row.sent_at).toLocaleString('he-IL')}
                </div>
              </button>
              {isOpen && (
                <div className="border-t bg-gray-50 p-3 text-xs space-y-2">
                  {row.error && (
                    <div className="text-red-700">
                      <strong>שגיאה:</strong> {row.error}
                    </div>
                  )}
                  {row.message_id && (
                    <div className="font-mono" dir="ltr">
                      <strong>Resend ID:</strong> {row.message_id}
                    </div>
                  )}
                  {row.metadata && Object.keys(row.metadata).length > 0 && (
                    <details>
                      <summary className="cursor-pointer text-gray-600 font-semibold">Metadata</summary>
                      <pre className="mt-2 p-2 bg-white rounded border text-[10px] overflow-auto" dir="ltr">
                        {JSON.stringify(row.metadata, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}

    </div>
  );
}
