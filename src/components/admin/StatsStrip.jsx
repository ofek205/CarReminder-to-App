import React from 'react';
import { Send, CheckCircle2, Eye, MousePointerClick, AlertCircle, XCircle } from 'lucide-react';
import { useEmailStats } from '@/hooks/useEmailAdmin';

/**
 * StatsStrip — 30-day rollup of delivery health across all notifications.
 *
 * Shows: sent, delivered, opened, clicked, bounced, failed. Rates (open %,
 * click %) are computed relative to delivered. Shown as a horizontal
 * strip at the top of EmailCenter, above the tabs.
 *
 * If Resend webhook isn't configured yet, delivered/opened/clicked will
 * all be zero — the hint line explains why.
 */
export default function StatsStrip() {
  const { data: stats, isLoading } = useEmailStats({ days: 30 });

  if (isLoading) return null;

  const s = stats || { sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0, failed: 0 };
  const total = Number(s.sent || 0);
  const delivered = Number(s.delivered || 0);
  const openRate  = delivered > 0 ? Math.round((Number(s.opened)  / delivered) * 100) : 0;
  const clickRate = delivered > 0 ? Math.round((Number(s.clicked) / delivered) * 100) : 0;

  const noEvents = total > 0 && delivered === 0 && Number(s.opened) === 0;

  return (
    <div dir="rtl" className="rounded-2xl p-4 mb-6"
      style={{ background: '#FFFFFF', border: '1.5px solid #E5E7EB' }}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-sm" style={{ color: '#1C2E20' }}>סטטיסטיקה — 30 ימים אחרונים</h3>
        <span className="text-[10px] text-gray-400">{total} מיילים נשלחו</span>
      </div>

      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        <Stat icon={Send}              label="נשלחו"    value={total}         fg="#2563EB" bg="#DBEAFE" />
        <Stat icon={CheckCircle2}      label="נמסרו"    value={delivered}     fg="#047857" bg="#D1FAE5" />
        <Stat icon={Eye}               label="נפתחו"    value={s.opened}      rate={openRate}  fg="#0891B2" bg="#CFFAFE" />
        <Stat icon={MousePointerClick} label="קליקים"   value={s.clicked}     rate={clickRate} fg="#7C3AED" bg="#EDE9FE" />
        <Stat icon={AlertCircle}       label="הוחזרו"   value={s.bounced}     fg="#DC2626" bg="#FEE2E2" warn={Number(s.bounced) > 0} />
        <Stat icon={XCircle}           label="נכשלו"    value={s.failed}      fg="#991B1B" bg="#FEE2E2" warn={Number(s.failed) > 0} />
      </div>

      {noEvents && (
        <p className="text-[11px] text-gray-400 mt-3">
          אירועים (delivered / opened / clicked) עדיין לא נרשמים. יש להגדיר את Resend Webhook
          ב-<a href="https://resend.com/webhooks" target="_blank" rel="noreferrer" className="underline">resend.com/webhooks</a>.
        </p>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value, rate, fg, bg, warn }) {
  const v = Number(value || 0);
  return (
    <div className={`rounded-xl p-2.5 ${warn ? 'ring-1 ring-red-200' : ''}`}
      style={{ background: bg }}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="w-3.5 h-3.5" style={{ color: fg }} />
        <span className="text-[10px] font-semibold" style={{ color: fg }}>{label}</span>
      </div>
      <div className="text-xl font-black leading-tight" style={{ color: fg }}>{v.toLocaleString('he-IL')}</div>
      {rate !== undefined && v > 0 && (
        <div className="text-[10px]" style={{ color: fg, opacity: 0.7 }}>{rate}%</div>
      )}
    </div>
  );
}
