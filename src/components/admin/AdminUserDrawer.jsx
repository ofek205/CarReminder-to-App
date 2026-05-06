/**
 * AdminUserDrawer — full-detail right-side drawer for /AdminDashboard
 * Users tab. Opens when an admin clicks the "VIEW" button on a row.
 *
 * Data: one RPC call to admin_account_details(p_account_id) which
 * returns a denormalized JSON blob with everything the drawer renders:
 * owner identity, vehicles + breakdown by type, documents + breakdown
 * by category, members, recent activity, money totals.
 *
 * Visual language: Living Dashboard system Card surfaces with accent
 * stripes. Same family as BusinessDashboard / Drivers / Reports so the
 * admin views feel like the rest of the product, not a separate tool.
 */
import React, { useEffect, useState, useMemo } from 'react';
import { format, parseISO, formatDistanceToNow } from 'date-fns';
import { he } from 'date-fns/locale';
import {
  X, Mail, Phone, Calendar, Truck, FileText, Users,
  Activity, Wrench, Shield, AlertTriangle, Briefcase,
  Copy, Anchor, TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/business/system';

// Format an ILS amount with no decimals — same convention as /Reports.
const fmtMoney = (n) => new Intl.NumberFormat('he-IL', {
  style: 'currency', currency: 'ILS', maximumFractionDigits: 0,
}).format(Number(n) || 0);

// Short money for tight spaces ("₪1.2K" / "₪34K").
const fmtMoneyShort = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1_000_000) return `₪${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1000)      return `₪${Math.round(v / 1000)}K`;
  return `₪${Math.round(v)}`;
};

const fmtDate = (d) => d ? format(parseISO(d), 'dd/MM/yyyy', { locale: he }) : '—';
const fmtDateTime = (d) => d ? format(parseISO(d), 'dd/MM/yyyy HH:mm', { locale: he }) : '—';
const fmtRelative = (d) => {
  if (!d) return '—';
  try { return formatDistanceToNow(parseISO(d), { addSuffix: true, locale: he }); }
  catch { return '—'; }
};

// Vessel detection — mirrors the rest of the app.
const VESSEL_TYPES = new Set(['כלי שייט','מפרשית','סירה מנועית','אופנוע ים','סירת גומי','יאכטה','ג׳ט סקי']);
const isVessel = (t) => VESSEL_TYPES.has(t);

// Category meta for documents — keeps the chip + icon consistent with the
// /Documents page itself.
const DOC_CATEGORY_META = {
  'ביטוח חובה':    { color: '#3B82F6', bg: '#EFF6FF', emoji: '🛡' },
  'ביטוח מקיף':    { color: '#6366F1', bg: '#EEF2FF', emoji: '🔒' },
  'ביטוח צד ג':    { color: '#06B6D4', bg: '#ECFEFF', emoji: '🤝' },
  'רישיון רכב':    { color: '#10B981', bg: '#ECFDF5', emoji: '🚗' },
  'רישיון נהיגה':  { color: '#F59E0B', bg: '#FFFBEB', emoji: '👤' },
  'טסט':           { color: '#EA580C', bg: '#FFF7ED', emoji: '🔧' },
  'טיפול תקופתי':  { color: '#A855F7', bg: '#FAF5FF', emoji: '⚙️' },
  'מסמך אחר':      { color: '#6B7280', bg: '#F9FAFB', emoji: '📄' },
};
const docMeta = (cat) => DOC_CATEGORY_META[cat] || DOC_CATEGORY_META['מסמך אחר'];

// Activity kind → icon + tone. Matches the route status / activity log
// vocabulary used elsewhere in the B2B family.
const ACTIVITY_META = {
  maintenance: { icon: Wrench,         label: 'טיפול',      tone: { bg: '#D1FAE5', fg: '#065F46' } },
  repair:      { icon: AlertTriangle,  label: 'תיקון',      tone: { bg: '#FEF3C7', fg: '#92400E' } },
  accident:    { icon: AlertTriangle,  label: 'תאונה',      tone: { bg: '#FEE2E2', fg: '#991B1B' } },
  expense:     { icon: TrendingUp,     label: 'הוצאה',      tone: { bg: '#DBEAFE', fg: '#1E40AF' } },
};

// Default: drawer closed = null. When non-null, contains { id, name }
// of the account whose details we want to show.
export default function AdminUserDrawer({ account, onClose }) {
  const [data, setData]     = useState(null);
  const [loading, setLoad]  = useState(false);
  const [error, setError]   = useState(null);

  useEffect(() => {
    if (!account?.id) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoad(true);
    setError(null);
    setData(null);
    supabase.rpc('admin_account_details', { p_account_id: account.id })
      .then(({ data: payload, error: rpcErr }) => {
        if (cancelled) return;
        if (rpcErr) {
          setError(rpcErr.message || 'שגיאה בטעינת הפרטים');
          return;
        }
        setData(payload);
      })
      .finally(() => { if (!cancelled) setLoad(false); });
    return () => { cancelled = true; };
  }, [account?.id]);

  // ESC closes the drawer.
  useEffect(() => {
    if (!account) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [account, onClose]);

  if (!account) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex justify-start"
      // start = right edge in RTL, so the drawer slides in from the right.
      // The dark backdrop catches outside-clicks to close.
      onClick={onClose}
      dir="rtl"
    >
      {/* Backdrop */}
      <div className="absolute inset-0" style={{ background: 'rgba(11,41,18,0.45)' }} />

      {/* Drawer panel */}
      <aside
        className="relative h-full w-full sm:w-[520px] md:w-[600px] overflow-y-auto"
        style={{
          background: `
            radial-gradient(ellipse at 70% -10%, rgba(16,185,129,0.06) 0%, transparent 40%),
            linear-gradient(180deg, #F0F7F4 0%, #FFFFFF 50%)
          `,
          boxShadow: '-12px 0 32px rgba(11,41,18,0.18)',
          animation: 'admin-drawer-in 220ms cubic-bezier(0.16,1,0.3,1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header — close button + account name. */}
        <div
          className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between gap-3"
          style={{
            background: 'rgba(240,247,244,0.92)',
            backdropFilter: 'blur(8px)',
            borderBottom: '1px solid #E5EDE8',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-emerald-100/40 transition"
            aria-label="סגור"
          >
            <X className="w-4 h-4" style={{ color: '#0B2912' }} />
          </button>
          <div className="text-center flex-1 min-w-0">
            <p className="text-[10px] font-bold" style={{ color: '#10B981' }}>פירוט חשבון</p>
            <p className="text-sm font-bold truncate" style={{ color: '#0B2912' }}>
              {account.name || 'ללא שם'}
            </p>
          </div>
          {/* Spacer to balance the close button. */}
          <div className="w-8" />
        </div>

        <div className="p-4 space-y-4 pb-12">
          {loading && <DrawerSkeleton />}
          {error && <DrawerError message={error} />}
          {!loading && !error && data && (
            <DrawerContent data={data} />
          )}
        </div>
      </aside>

      {/* Slide-in keyframes — scoped style so we don't leak globally. */}
      <style>{`
        @keyframes admin-drawer-in {
          from { transform: translateX(40px); opacity: 0; }
          to   { transform: translateX(0);     opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Drawer content — split out so the loading/error states stay clean.
// ────────────────────────────────────────────────────────────────────

function DrawerContent({ data }) {
  const { account, owner, vehicles, vehicles_by_type: vehiclesByType,
          documents, documents_by_category: docsByCat,
          expiring_docs_30d: expiringDocs,
          members, activity, totals } = data;

  // Owner initials for the avatar.
  const initials = useMemo(() => {
    const src = owner?.full_name || owner?.email || account?.name || 'משתמש';
    return String(src).trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('') || 'מ';
  }, [owner, account]);

  // Days since last sign-in — drives the "active / dormant" chip.
  const daysSinceSignin = useMemo(() => {
    if (!owner?.last_sign_in_at) return null;
    const ms = Date.now() - new Date(owner.last_sign_in_at).getTime();
    return Math.floor(ms / (1000 * 60 * 60 * 24));
  }, [owner]);

  return (
    <>
      {/* IDENTITY HERO ─────────────────────────────────────────────── */}
      <Card accent="emerald">
        <div className="flex items-start gap-3">
          <div
            className="shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-black"
            style={{
              background: 'linear-gradient(135deg, #065F46 0%, #10B981 80%, #34D399 100%)',
              color: '#FFFFFF',
              boxShadow: '0 8px 20px rgba(16,185,129,0.32)',
            }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <p className="text-sm font-black truncate" style={{ color: '#0B2912' }}>
                {owner?.full_name || account?.name || 'ללא שם'}
              </p>
              {owner?.role === 'admin' && (
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded inline-flex items-center gap-1"
                  style={{ background: '#FAF5FF', color: '#6B21A8' }}
                >
                  <Shield className="w-3 h-3" /> אדמין
                </span>
              )}
              {account?.kind === 'business' && (
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded inline-flex items-center gap-1"
                  style={{ background: '#D1FAE5', color: '#065F46' }}
                >
                  <Briefcase className="w-3 h-3" /> עסקי
                </span>
              )}
              {daysSinceSignin === null ? (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                  style={{ background: '#F0F7F4', color: '#6B7C72' }}>
                  לא התחבר
                </span>
              ) : daysSinceSignin <= 7 ? (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                  style={{ background: '#D1FAE5', color: '#065F46' }}>
                  פעיל
                </span>
              ) : daysSinceSignin <= 30 ? (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                  style={{ background: '#FEF3C7', color: '#92400E' }}>
                  לא פעיל {daysSinceSignin} ימים
                </span>
              ) : (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                  style={{ background: '#FEE2E2', color: '#991B1B' }}>
                  רדום {daysSinceSignin} ימים
                </span>
              )}
            </div>

            {/* Identity rows — email / phone / verified / created. */}
            <div className="space-y-1 text-[11px]" style={{ color: '#4B5D52' }}>
              {owner?.email && (
                <CopyableRow icon={Mail} value={owner.email} dir="ltr"
                  trailing={!owner.email_confirmed_at && (
                    <span className="text-[9px] font-bold px-1 rounded"
                      style={{ background: '#FEF3C7', color: '#92400E' }}>!</span>
                  )} />
              )}
              {owner?.phone && (
                <CopyableRow icon={Phone} value={owner.phone} dir="ltr" />
              )}
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3 h-3 shrink-0" style={{ color: '#10B981' }} />
                <span>נוצר: {fmtDate(account?.created_at)}</span>
                {owner?.last_sign_in_at && (
                  <span style={{ color: '#A7B3AB' }}>
                    · התחבר {fmtRelative(owner.last_sign_in_at)}
                  </span>
                )}
              </div>
              <CopyableRow icon={() => null} label="ID" value={account?.id || ''} dir="ltr"
                small />
            </div>
          </div>
        </div>
      </Card>

      {/* TOTALS KPI ROW ────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <KpiTile
          label="כלי תחבורה"
          value={totals?.vehicles ?? 0}
          sub={`${vehicles.filter(v => isVessel(v.vehicle_type)).length} כלי שייט`}
          tone="emerald"
        />
        <KpiTile
          label="מסמכים"
          value={totals?.documents ?? 0}
          sub={expiringDocs > 0 ? `${expiringDocs} פגים בקרוב` : 'הכל בתוקף'}
          tone={expiringDocs > 0 ? 'amber' : 'blue'}
        />
        <KpiTile
          label="חברים"
          value={totals?.members ?? 0}
          sub={totals?.routes > 0 ? `${totals.routes} משימות` : 'אין משימות'}
          tone="purple"
        />
        <KpiTile
          label="הוצאות"
          value={fmtMoneyShort(totals?.spend_total)}
          sub={`${totals?.repairs ?? 0} תיקונים · ${totals?.maintenance ?? 0} טיפולים`}
          tone={totals?.spend_total > 0 ? 'blue' : 'emerald'}
        />
      </section>

      {/* VEHICLES BREAKDOWN ────────────────────────────────────────── */}
      <Card accent="emerald">
        <SectionHeader
          icon={Truck}
          title="כלי תחבורה"
          right={vehicles.length > 0 && (
            <span className="text-[11px] tabular-nums" style={{ color: '#6B7C72' }} dir="ltr">
              {vehicles.length}
            </span>
          )}
        />
        {vehicles.length === 0 ? (
          <EmptyText>אין כלי תחבורה בחשבון</EmptyText>
        ) : (
          <>
            {/* Breakdown by type — bar chart, sorted desc. */}
            <BreakdownBars data={vehiclesByType} total={vehicles.length} tone="emerald" />

            {/* List of vehicles */}
            <ul className="space-y-1.5 mt-3">
              {vehicles.slice(0, 12).map(v => (
                <VehicleRow key={v.id} vehicle={v} />
              ))}
              {vehicles.length > 12 && (
                <li className="text-center text-[11px] py-1.5" style={{ color: '#A7B3AB' }}>
                  ועוד {vehicles.length - 12} כלי תחבורה
                </li>
              )}
            </ul>
          </>
        )}
      </Card>

      {/* DOCUMENTS BREAKDOWN ───────────────────────────────────────── */}
      <Card accent={expiringDocs > 0 ? 'amber' : 'blue'}>
        <SectionHeader
          icon={FileText}
          title="מסמכים"
          right={documents.length > 0 && (
            <div className="flex items-center gap-1.5">
              {expiringDocs > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                  style={{ background: '#FEF3C7', color: '#92400E' }}>
                  {expiringDocs} פגים ב-30 ימים
                </span>
              )}
              <span className="text-[11px] tabular-nums" style={{ color: '#6B7C72' }} dir="ltr">
                {documents.length}
              </span>
            </div>
          )}
        />
        {documents.length === 0 ? (
          <EmptyText>לא הועלו מסמכים</EmptyText>
        ) : (
          <>
            {/* Breakdown by category */}
            <DocCategoryBars data={docsByCat} total={documents.length} />

            {/* List */}
            <ul className="space-y-1.5 mt-3">
              {documents.slice(0, 10).map(d => (
                <DocumentRow key={d.id} doc={d} />
              ))}
              {documents.length > 10 && (
                <li className="text-center text-[11px] py-1.5" style={{ color: '#A7B3AB' }}>
                  ועוד {documents.length - 10} מסמכים
                </li>
              )}
            </ul>
          </>
        )}
      </Card>

      {/* MEMBERS ───────────────────────────────────────────────────── */}
      {members.length > 0 && (
        <Card accent="purple">
          <SectionHeader
            icon={Users}
            title="חברי החשבון"
            right={(
              <span className="text-[11px] tabular-nums" style={{ color: '#6B7C72' }} dir="ltr">
                {members.length}
              </span>
            )}
          />
          <ul className="space-y-1.5">
            {members.map(m => <MemberRow key={m.user_id} member={m} />)}
          </ul>
        </Card>
      )}

      {/* MONEY BREAKDOWN — only when there's spend ─────────────────── */}
      {totals?.spend_total > 0 && (
        <Card accent="blue">
          <SectionHeader icon={TrendingUp} title="התפלגות הוצאות" />
          <SpendByCategoryBars
            byCat={totals.spend_by_category}
            total={totals.spend_total}
          />
          <div className="flex items-center justify-between mt-3 pt-2.5"
            style={{ borderTop: '1px solid #F0F7F4' }}>
            <span className="text-[11px] font-bold" style={{ color: '#0B2912' }}>סה״כ</span>
            <span className="text-sm font-black tabular-nums" style={{ color: '#065F46' }} dir="ltr">
              {fmtMoney(totals.spend_total)}
            </span>
          </div>
        </Card>
      )}

      {/* ACTIVITY TIMELINE ─────────────────────────────────────────── */}
      {activity.length > 0 && (
        <Card accent="emerald">
          <SectionHeader
            icon={Activity}
            title="פעילות אחרונה"
            right={(
              <span className="text-[11px]" style={{ color: '#6B7C72' }}>
                30 אחרונים
              </span>
            )}
          />
          <ul className="space-y-1.5">
            {activity.slice(0, 15).map((a, i) => <ActivityRow key={i} item={a} />)}
            {activity.length > 15 && (
              <li className="text-center text-[11px] py-1.5" style={{ color: '#A7B3AB' }}>
                ועוד {activity.length - 15} אירועים
              </li>
            )}
          </ul>
        </Card>
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────

function KpiTile({ label, value, sub, tone = 'emerald' }) {
  // Tone palette mirrors the system KpiTile but stays inline so we can
  // shrink the type ramp for the drawer (where space is tight).
  const tones = {
    emerald: { bg: 'linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)', border: '#A7F3D0', label: '#065F46', value: '#0B2912' },
    blue:    { bg: 'linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)', border: '#BFDBFE', label: '#1E40AF', value: '#0B2912' },
    amber:   { bg: 'linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%)', border: '#FCD34D', label: '#92400E', value: '#0B2912' },
    purple:  { bg: 'linear-gradient(135deg, #FAF5FF 0%, #F3E8FF 100%)', border: '#E9D5FF', label: '#6B21A8', value: '#0B2912' },
    red:     { bg: 'linear-gradient(135deg, #FEF2F2 0%, #FEE2E2 100%)', border: '#FECACA', label: '#991B1B', value: '#0B2912' },
  };
  const t = tones[tone] || tones.emerald;
  return (
    <div
      className="rounded-2xl p-2.5 border"
      style={{ background: t.bg, borderColor: t.border }}
    >
      <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: t.label }}>
        {label}
      </p>
      <p className="text-base font-black tabular-nums truncate mt-0.5" style={{ color: t.value }} dir="ltr">
        {value}
      </p>
      {sub && (
        <p className="text-[10px] truncate mt-0.5" style={{ color: '#4B5D52' }}>{sub}</p>
      )}
    </div>
  );
}

function SectionHeader({ icon: Icon, title, right }) {
  return (
    <div className="flex items-center justify-between mb-2.5">
      <h3 className="text-sm font-bold flex items-center gap-1.5" style={{ color: '#0B2912' }}>
        <Icon className="w-4 h-4" style={{ color: '#10B981' }} />
        {title}
      </h3>
      {right}
    </div>
  );
}

function EmptyText({ children }) {
  return (
    <p className="text-[11px] py-2 text-center" style={{ color: '#A7B3AB' }}>{children}</p>
  );
}

// CopyableRow — renders an info line with a copy button on hover. The
// label is optional (when present, the value is displayed in monospace
// mode for IDs).
function CopyableRow({ icon: Icon, label, value, dir, trailing, small }) {
  const onCopy = async () => {
    try { await navigator.clipboard.writeText(value); toast.success('הועתק'); } catch {}
  };
  return (
    <div className="flex items-center gap-1.5 group">
      {Icon && <Icon className="w-3 h-3 shrink-0" style={{ color: '#10B981' }} />}
      {label && (
        <span className="text-[9px] uppercase tracking-wider font-bold shrink-0" style={{ color: '#A7B3AB' }}>
          {label}
        </span>
      )}
      <span
        className={`truncate ${small ? 'text-[10px] font-mono' : ''}`}
        dir={dir}
        style={small ? { color: '#6B7C72' } : undefined}
      >
        {value}
      </span>
      {trailing}
      <button
        type="button"
        onClick={onCopy}
        className="opacity-0 group-hover:opacity-100 transition shrink-0 p-0.5 hover:bg-emerald-100/40 rounded"
        aria-label="העתק"
      >
        <Copy className="w-3 h-3" style={{ color: '#A7B3AB' }} />
      </button>
    </div>
  );
}

function BreakdownBars({ data, total, tone = 'emerald' }) {
  const entries = useMemo(
    () => Object.entries(data || {}).sort((a, b) => b[1] - a[1]),
    [data]
  );
  if (entries.length === 0) return null;
  const colors = {
    emerald: { fill: 'linear-gradient(90deg, #065F46 0%, #34D399 100%)', track: '#F0F7F4' },
    blue:    { fill: 'linear-gradient(90deg, #1E40AF 0%, #60A5FA 100%)', track: '#EFF6FF' },
  };
  const c = colors[tone] || colors.emerald;
  return (
    <div className="space-y-1.5">
      {entries.map(([label, count]) => {
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const Icon = isVessel(label) ? Anchor : Truck;
        return (
          <div key={label}>
            <div className="flex items-center justify-between text-[11px] mb-0.5">
              <span className="flex items-center gap-1 truncate" style={{ color: '#0B2912' }}>
                <Icon className="w-3 h-3 shrink-0" style={{ color: '#10B981' }} />
                {label}
              </span>
              <span className="tabular-nums font-bold shrink-0" style={{ color: '#4B5D52' }} dir="ltr">
                {count} <span style={{ color: '#A7B3AB' }}>· {pct}%</span>
              </span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: c.track }}>
              <div
                className="h-full transition-all duration-500"
                style={{ width: `${pct}%`, background: c.fill }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DocCategoryBars({ data, total }) {
  const entries = useMemo(
    () => Object.entries(data || {}).sort((a, b) => b[1] - a[1]),
    [data]
  );
  if (entries.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {entries.map(([label, count]) => {
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const meta = docMeta(label);
        return (
          <div key={label}>
            <div className="flex items-center justify-between text-[11px] mb-0.5">
              <span className="flex items-center gap-1 truncate" style={{ color: '#0B2912' }}>
                <span>{meta.emoji}</span>
                {label}
              </span>
              <span className="tabular-nums font-bold shrink-0" style={{ color: '#4B5D52' }} dir="ltr">
                {count} <span style={{ color: '#A7B3AB' }}>· {pct}%</span>
              </span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: meta.bg }}>
              <div
                className="h-full transition-all duration-500"
                style={{ width: `${pct}%`, background: meta.color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SpendByCategoryBars({ byCat, total }) {
  const entries = [
    { key: 'repair',    label: 'תיקונים', color: '#EA580C' },
    { key: 'insurance', label: 'ביטוח',   color: '#7C3AED' },
    { key: 'other',     label: 'אחר',     color: '#64748B' },
  ];
  return (
    <div className="space-y-1.5">
      {entries.map(({ key, label, color }) => {
        const value = Number(byCat?.[key]) || 0;
        const pct = total > 0 ? Math.round((value / total) * 100) : 0;
        return (
          <div key={key}>
            <div className="flex items-center justify-between text-[11px] mb-0.5">
              <span className="font-bold" style={{ color: '#0B2912' }}>{label}</span>
              <span className="tabular-nums font-bold shrink-0" style={{ color: '#4B5D52' }} dir="ltr">
                {fmtMoney(value)} <span style={{ color: '#A7B3AB' }}>· {pct}%</span>
              </span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#F0F7F4' }}>
              <div className="h-full" style={{ width: `${pct}%`, background: color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function VehicleRow({ vehicle: v }) {
  const label = v.nickname
    || `${v.manufacturer || ''} ${v.model || ''}`.trim()
    || v.license_plate
    || 'רכב';
  const Icon = isVessel(v.vehicle_type) ? Anchor : Truck;
  // Days until expiry — drives the chip color.
  const daysToTest = v.test_due_date
    ? Math.ceil((new Date(v.test_due_date) - new Date()) / 86400000)
    : null;
  const daysToInsurance = v.insurance_due_date
    ? Math.ceil((new Date(v.insurance_due_date) - new Date()) / 86400000)
    : null;
  const worstDays = Math.min(daysToTest ?? 999, daysToInsurance ?? 999);
  const status = worstDays < 0
    ? { bg: '#FEE2E2', fg: '#991B1B', text: 'דחוף' }
    : worstDays <= 30
    ? { bg: '#FEF3C7', fg: '#92400E', text: 'מתקרב' }
    : { bg: '#D1FAE5', fg: '#065F46', text: 'תקין' };

  return (
    <li
      className="flex items-center gap-2 px-2.5 py-2 rounded-lg"
      style={{ background: '#FFFFFF', border: '1px solid #E5EDE8' }}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: '#10B981' }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[12px] font-bold truncate" style={{ color: '#0B2912' }}>
            {label}
          </span>
          {v.license_plate && (
            <span
              className="text-[9px] font-mono px-1 py-0.5 rounded shrink-0 tabular-nums"
              dir="ltr"
              style={{ background: '#F0F7F4', color: '#4B5D52' }}
            >
              {v.license_plate}
            </span>
          )}
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
            style={{ background: status.bg, color: status.fg }}
          >
            {status.text}
          </span>
        </div>
        <p className="text-[10px] truncate mt-0.5" style={{ color: '#6B7C72' }}>
          {[v.year, v.vehicle_type].filter(Boolean).join(' · ') || '—'}
        </p>
      </div>
    </li>
  );
}

function DocumentRow({ doc: d }) {
  const meta = docMeta(d.category);
  const days = d.expires_at
    ? Math.ceil((new Date(d.expires_at) - new Date()) / 86400000)
    : null;
  const expiryChip = days === null ? null
    : days < 0
    ? { bg: '#FEE2E2', fg: '#991B1B', text: 'פג' }
    : days <= 30
    ? { bg: '#FEF3C7', fg: '#92400E', text: `בעוד ${days} ימים` }
    : { bg: '#D1FAE5', fg: '#065F46', text: 'בתוקף' };

  return (
    <li
      className="flex items-center gap-2 px-2.5 py-2 rounded-lg"
      style={{ background: '#FFFFFF', border: '1px solid #E5EDE8' }}
    >
      <span className="shrink-0 text-base">{meta.emoji}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[12px] font-bold truncate" style={{ color: '#0B2912' }}>
            {d.title || d.category || 'מסמך'}
          </span>
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
            style={{ background: meta.bg, color: meta.color }}
          >
            {d.category}
          </span>
          {expiryChip && (
            <span
              className="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
              style={{ background: expiryChip.bg, color: expiryChip.fg }}
            >
              {expiryChip.text}
            </span>
          )}
        </div>
        {d.expires_at && (
          <p className="text-[10px] mt-0.5 tabular-nums" style={{ color: '#6B7C72' }} dir="ltr">
            תוקף עד: {fmtDate(d.expires_at)}
          </p>
        )}
      </div>
    </li>
  );
}

function MemberRow({ member: m }) {
  const ROLE_TONE = {
    'בעלים':  { bg: '#FAF5FF', fg: '#6B21A8', label: 'בעלים' },
    'מנהל':   { bg: '#D1FAE5', fg: '#065F46', label: 'מנהל' },
    'שותף':   { bg: '#EFF6FF', fg: '#1E40AF', label: 'צופה' },
    'driver': { bg: '#FFFBEB', fg: '#92400E', label: 'נהג' },
  };
  const tone = ROLE_TONE[m.role] || { bg: '#F0F7F4', fg: '#4B5D52', label: m.role };
  const initials = (m.display_name || m.email || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('') || '?';
  return (
    <li
      className="flex items-center gap-2 px-2.5 py-2 rounded-lg"
      style={{ background: '#FFFFFF', border: '1px solid #E5EDE8' }}
    >
      <div
        className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-black"
        style={{ background: tone.bg, color: tone.fg }}
      >
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[12px] font-bold truncate" style={{ color: '#0B2912' }}>
            {m.display_name || 'ללא שם'}
          </span>
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
            style={{ background: tone.bg, color: tone.fg }}
          >
            {tone.label}
          </span>
        </div>
        {m.email && (
          <p className="text-[10px] truncate mt-0.5" style={{ color: '#6B7C72' }} dir="ltr">
            {m.email}
          </p>
        )}
      </div>
      {m.joined_at && (
        <span className="text-[10px] shrink-0 tabular-nums" style={{ color: '#A7B3AB' }} dir="ltr">
          {fmtDate(m.joined_at)}
        </span>
      )}
    </li>
  );
}

function ActivityRow({ item }) {
  const meta = ACTIVITY_META[item.kind] || ACTIVITY_META.expense;
  const Icon = meta.icon;
  return (
    <li
      className="flex items-center gap-2 px-2.5 py-2 rounded-lg"
      style={{ background: '#FFFFFF', border: '1px solid #E5EDE8' }}
    >
      <div
        className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
        style={{ background: meta.tone.bg, color: meta.tone.fg }}
      >
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-bold" style={{ color: meta.tone.fg }}>
            {meta.label}
          </span>
          <span className="text-[12px] truncate" style={{ color: '#0B2912' }}>
            {item.title}
          </span>
        </div>
        <p className="text-[10px] mt-0.5" style={{ color: '#6B7C72' }}>
          {fmtDateTime(item.occurred_at)}
        </p>
      </div>
      {Number(item.cost) > 0 && (
        <span className="text-[11px] font-bold tabular-nums shrink-0" style={{ color: '#065F46' }} dir="ltr">
          {fmtMoneyShort(item.cost)}
        </span>
      )}
    </li>
  );
}

// Loading skeleton for the drawer body.
function DrawerSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="rounded-2xl h-24" style={{ background: '#F0F7F4' }} />
      <div className="grid grid-cols-2 gap-2.5">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="rounded-2xl h-16" style={{ background: '#F0F7F4' }} />
        ))}
      </div>
      <div className="rounded-2xl h-32" style={{ background: '#F0F7F4' }} />
      <div className="rounded-2xl h-32" style={{ background: '#F0F7F4' }} />
    </div>
  );
}

function DrawerError({ message }) {
  return (
    <Card accent="red" className="text-center py-6">
      <AlertTriangle className="w-8 h-8 mx-auto mb-2" style={{ color: '#991B1B' }} />
      <p className="text-sm font-bold mb-1" style={{ color: '#0B2912' }}>שגיאה בטעינת הפרטים</p>
      <p className="text-[11px]" style={{ color: '#6B7C72' }}>{message}</p>
      <p className="text-[10px] mt-3" style={{ color: '#A7B3AB' }}>
        ייתכן שה-RPC <code style={{ background: '#FEE2E2', padding: '1px 4px', borderRadius: 4 }}>admin_account_details</code> עוד לא פרוס. הרץ את <code style={{ background: '#FEE2E2', padding: '1px 4px', borderRadius: 4 }}>supabase-admin-account-details.sql</code> ב-Supabase.
      </p>
    </Card>
  );
}
