/**
 * UpcomingReminders.jsx
 * Dashboard section that shows all upcoming/overdue reminders:
 * vehicle tests, insurance, and expiring documents.
 * Uses ReminderEngine for centralized calculation.
 */

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Card } from '@/components/ui/card';
import { Bell, ChevronLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { calcReminders, daysLabel, daysLabelShort } from '../shared/ReminderEngine';
import { formatDateHe } from '../shared/DateStatusUtils';
import { useAuth } from '../shared/GuestContext';

//  Status color tokens 
const STATUS = {
  danger:   { bar: 'bg-red-500',     badge: 'bg-red-50 text-red-700 border border-red-200',     dot: 'bg-red-500'    },
  warn:     { bar: 'bg-amber-400',   badge: 'bg-amber-50 text-amber-700 border border-amber-200', dot: 'bg-amber-400'  },
  upcoming: { bar: 'bg-blue-400',    badge: 'bg-blue-50 text-blue-700 border border-blue-200',   dot: 'bg-blue-400'   },
  ok:       { bar: 'bg-emerald-400', badge: 'bg-emerald-50 text-emerald-700 border border-emerald-200', dot: 'bg-emerald-400' },
};

//  Single reminder row 
function ReminderRow({ item }) {
  const s = STATUS[item.status] || STATUS.ok;

  return (
    <Link to={createPageUrl(item.linkTo)}>
      <div
        className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50/80 active:bg-gray-100 transition-colors cursor-pointer"
        dir="rtl"
      >
        {/* Left accent bar */}
        <div className={`w-1 self-stretch rounded-full shrink-0 ${s.bar}`} style={{ minHeight: 36 }} />

        {/* Emoji icon */}
        <span className="text-xl shrink-0 leading-none">{item.emoji}</span>

        {/* Text info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate leading-tight">{item.name}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            <span className="font-medium text-gray-500">{item.typeName}</span>
            {' · '}
            {formatDateHe(item.dueDate)}
          </p>
        </div>

        {/* Days badge */}
        <span className={`text-xs font-semibold px-2 py-1 rounded-lg shrink-0 whitespace-nowrap ${s.badge}`}>
          {daysLabel(item.daysLeft)}
        </span>

        <ChevronLeft className="h-4 w-4 text-gray-300 shrink-0" />
      </div>
    </Link>
  );
}

//  Main component 
export default function UpcomingReminders({ vehicles = [], accountId }) {
  const { isGuest, guestDocuments, guestReminderSettings } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const MAX_COLLAPSED = 3;

  // Fetch documents (disabled - not yet migrated from Base44)
  const { data: documents = [] } = useQuery({
    queryKey: ['documents-reminders', accountId],
    queryFn: async () => {
      try {
        // TODO: migrate Document entity to Supabase
        return [];
      } catch (e) { return []; }
    },
    enabled: !!accountId && !isGuest,
  });

  // Fetch reminder settings (disabled - not yet migrated from Base44)
  const { data: settingsArr = [] } = useQuery({
    queryKey: ['reminder-settings-dash'],
    queryFn: async () => {
      try {
        // TODO: migrate ReminderSettings entity to Supabase
        return [];
      } catch (e) { return []; }
    },
    enabled: !isGuest,
  });

  const settings = isGuest ? guestReminderSettings : (settingsArr[0] ?? {});
  const docs     = isGuest ? guestDocuments        : documents;

  const reminders = calcReminders({ vehicles, documents: docs, settings });

  if (reminders.length === 0) return null;

  const overdue  = reminders.filter(r => r.status === 'danger').length;
  const warning  = reminders.filter(r => r.status === 'warn').length;
  const visible  = expanded ? reminders : reminders.slice(0, MAX_COLLAPSED);
  const hasMore  = reminders.length > MAX_COLLAPSED;

  return (
    <Card className="border border-gray-100 rounded-2xl overflow-hidden mt-4 shadow-sm" dir="rtl">
      {/*  Header  */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gradient-to-l from-[#FDF6F0] to-white">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#2D5233] flex items-center justify-center">
            <Bell className="h-3.5 w-3.5 text-white" />
          </div>
          <div>
            <h3 className="font-bold text-gray-900 text-sm leading-tight">תזכורות קרובות</h3>
            {(overdue > 0 || warning > 0) && (
              <p className="text-xs text-gray-400">
                {overdue > 0 && <span className="text-red-600 font-medium">{overdue} פגי תוקף</span>}
                {overdue > 0 && warning > 0 && ' · '}
                {warning > 0 && <span className="text-amber-600 font-medium">{warning} קרובים לפקיעה</span>}
              </p>
            )}
          </div>
        </div>
        <span className="text-xs font-bold bg-[#2D5233] text-white px-2.5 py-1 rounded-full">
          {reminders.length}
        </span>
      </div>

      {/*  Rows  */}
      <div className="divide-y divide-gray-50">
        {visible.map(item => (
          <ReminderRow key={item.id} item={item} />
        ))}
      </div>

      {/*  Expand / collapse  */}
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 border-t border-gray-100 text-xs font-medium text-[#2D5233] hover:bg-[#FDF6F0] transition-colors"
        >
          {expanded ? (
            <><ChevronUp className="h-3.5 w-3.5" /> הצג פחות</>
          ) : (
            <><ChevronDown className="h-3.5 w-3.5" /> הצג עוד {reminders.length - MAX_COLLAPSED} תזכורות</>
          )}
        </button>
      )}
    </Card>
  );
}
