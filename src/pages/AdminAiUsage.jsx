/**
 * AdminAiUsage — admin-only dashboard for AI feature usage + flag toggles.
 *
 * Two surfaces in one page:
 *   1. ANALYTICS — pulls the last 30 days of public.ai_usage_logs and
 *      shows KPI cards (unique users 7d/30d, total tokens, attachment
 *      share), plus breakdowns by provider and by feature, plus the
 *      top 10 heaviest users this week.
 *   2. FLAGS — three toggles backed by public.app_config rows:
 *        • chat_attachments_enabled  — image / document upload in chat
 *        • scan_extraction_enabled   — AI scan kill-switch
 *        • ai_usage_tracking_enabled — master switch for the writer
 *      Writes hit app_config directly; the admin write policy lives in
 *      supabase-app-config-admin-write.sql.
 *
 * Why bundle them: the two surfaces share an audience (admin),
 * a context (the AI subsystem), and a useful interaction — the admin
 * watches a metric move while flipping a flag.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import useIsAdmin from '@/hooks/useIsAdmin';
import { invalidateFeatureFlagCache } from '@/lib/featureFlags';
import { toast } from 'sonner';
import {
  ArrowRight, BarChart3, Loader2, Sparkles, Paperclip, Users,
  Coins, Image as ImageIcon, ToggleRight, RefreshCw,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';

const SEVEN_DAYS_MS  = 7  * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const ROW_FETCH_CAP  = 5000;  // safety cap; raise if traffic grows

const FLAG_LABELS = {
  chat_attachments_enabled: {
    title:       'צירוף קבצים בצ׳אט',
    description: 'מאפשר למשתמשים רגילים לראות כפתור מהדק בייעוץ עם המומחה. מנהלים רואים תמיד.',
  },
  scan_extraction_enabled: {
    title:       'סריקת מסמכים',
    description: 'הפעלה של חילוץ אוטומטי של פרטים מרישיון רכב, ביטוח, וקבלות. כיבוי מציג למשתמש "כרגע לא זמין".',
  },
  ai_usage_tracking_enabled: {
    title:       'רישום שימוש',
    description: 'מתג ראשי לכתיבה אל ai_usage_logs. כיבוי משאיר את ה-AI עובד אבל מפסיק את האנליטיקה.',
  },
};

function numberFmt(n) {
  if (!Number.isFinite(n)) return '0';
  return Math.round(n).toLocaleString('en-US');
}

function pctFmt(num, denom) {
  if (!denom) return '0%';
  return `${Math.round(100 * num / denom)}%`;
}

// Anchor short text label per provider/feature key for prettier display.
const PROVIDER_LABELS = {
  groq:   'Groq',
  gemini: 'Gemini',
  claude: 'Claude',
  grok:   'Grok',
};
const FEATURE_LABELS = {
  yossi_chat:       'ייעוץ עם מומחה',
  community_expert: 'מומחה בקהילה',
  scan_extraction:  'סריקת מסמכים',
};

export default function AdminAiUsage() {
  const isAdmin  = useIsAdmin();
  const navigate = useNavigate();
  const [rows,    setRows]    = useState([]);
  const [flags,   setFlags]   = useState({});
  const [loading, setLoading] = useState(true);
  const [savingFlag, setSavingFlag] = useState(null);

  const load = async () => {
    setLoading(true);
    const since30 = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
    try {
      const [usageRes, flagsRes] = await Promise.all([
        supabase
          .from('ai_usage_logs')
          .select('user_id, provider, model, feature, prompt_tokens, completion_tokens, total_tokens, had_attachment, created_at')
          .gte('created_at', since30)
          .order('created_at', { ascending: false })
          .limit(ROW_FETCH_CAP),
        supabase
          .from('app_config')
          .select('key, value')
          .in('key', Object.keys(FLAG_LABELS)),
      ]);
      if (usageRes.error) throw usageRes.error;
      if (flagsRes.error) throw flagsRes.error;
      setRows(usageRes.data || []);
      const map = {};
      (flagsRes.data || []).forEach(r => {
        const v = r.value;
        map[r.key] = v === true || v === 'true';
      });
      Object.keys(FLAG_LABELS).forEach(k => {
        if (!(k in map)) map[k] = false;
      });
      setFlags(map);
    } catch (err) {
      toast.error('טעינת הנתונים נכשלה: ' + (err?.message || 'תקלה'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin !== true) return;
    load();

  }, [isAdmin]);

  const stats = useMemo(() => {
    const now = Date.now();
    const last7  = rows.filter(r => now - new Date(r.created_at).getTime() < SEVEN_DAYS_MS);
    const last30 = rows;

    const usersSet7  = new Set(last7.map(r => r.user_id));
    const usersSet30 = new Set(last30.map(r => r.user_id));

    const totalTokens30 = last30.reduce((s, r) => s + (r.total_tokens || 0), 0);
    const totalTokens7  = last7.reduce((s, r) => s + (r.total_tokens || 0), 0);

    const attached7 = last7.filter(r => r.had_attachment).length;
    const attachmentPct7 = pctFmt(attached7, last7.length);

    // Breakdown helpers — return [{ label, count, tokens, share }] sorted desc.
    const breakdown = (list, keyField, labelMap) => {
      const byKey = {};
      for (const r of list) {
        const k = r[keyField] || '—';
        if (!byKey[k]) byKey[k] = { count: 0, tokens: 0 };
        byKey[k].count  += 1;
        byKey[k].tokens += (r.total_tokens || 0);
      }
      const totalT = Object.values(byKey).reduce((s, v) => s + v.tokens, 0);
      return Object.entries(byKey)
        .map(([k, v]) => ({
          key:    k,
          label:  (labelMap && labelMap[k]) || k,
          count:  v.count,
          tokens: v.tokens,
          share:  totalT ? v.tokens / totalT : 0,
        }))
        .sort((a, b) => b.tokens - a.tokens);
    };

    const byProvider30 = breakdown(last30, 'provider', PROVIDER_LABELS);
    const byFeature30  = breakdown(last30, 'feature',  FEATURE_LABELS);

    // Top users this week.
    const userTokenMap = {};
    for (const r of last7) {
      userTokenMap[r.user_id] = (userTokenMap[r.user_id] || 0) + (r.total_tokens || 0);
    }
    const topUsers = Object.entries(userTokenMap)
      .map(([user_id, tokens]) => ({ user_id, tokens }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 10);

    return {
      users7d:      usersSet7.size,
      users30d:     usersSet30.size,
      totalTokens30,
      totalTokens7,
      attachmentPct7,
      requestCount30: last30.length,
      byProvider30,
      byFeature30,
      topUsers,
    };
  }, [rows]);

  const toggleFlag = async (key) => {
    const prev   = !!flags[key];
    const newVal = !prev;
    setFlags(f => ({ ...f, [key]: newVal }));
    setSavingFlag(key);
    try {
      const { error } = await supabase
        .from('app_config')
        .upsert(
          { key, value: newVal, updated_at: new Date().toISOString() },
          { onConflict: 'key' },
        );
      if (error) throw error;
      // Invalidate the local cache + notify any mounted useFeatureFlag
      // hooks so the change takes effect immediately on this tab.
      invalidateFeatureFlagCache(key);
      toast.success(`${FLAG_LABELS[key]?.title || key} — ${newVal ? 'הופעל' : 'כובה'}`);
    } catch (err) {
      setFlags(f => ({ ...f, [key]: prev }));
      toast.error('שמירה נכשלה: ' + (err?.message || 'תקלה'));
    } finally {
      setSavingFlag(null);
    }
  };

  if (isAdmin === null) {
    return <div className="p-8 text-center text-sm text-gray-500">בודק הרשאות...</div>;
  }
  if (isAdmin === false) {
    return (
      <div className="p-8 text-center" dir="rtl">
        <p className="text-sm text-gray-600 mb-4">דף זה פתוח לאדמינים בלבד.</p>
        <button onClick={() => navigate(-1)} className="px-4 py-2 rounded-lg bg-[#2D5233] text-white text-sm font-bold">חזרה</button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6" dir="rtl">
      <div className="flex items-center justify-between mb-6">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm font-bold text-[#2D5233]">
          <ArrowRight className="w-4 h-4" /> חזרה
        </button>
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-[#D97706]" />
          <h1 className="text-xl sm:text-2xl font-bold text-[#1F2937]">שימוש במנוע AI</h1>
        </div>
      </div>

      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-600 leading-relaxed">
          סטטיסטיקות מבוססות על שלושים הימים האחרונים, מתוך טבלת הרישום של פונקציית הקצה.
        </p>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 text-xs font-bold text-[#2D5233] disabled:opacity-40">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          רענן
        </button>
      </div>

      {loading ? (
        <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <KpiCard icon={Users} label="משתמשים פעילים השבוע"  value={stats.users7d} />
            <KpiCard icon={Users} label="משתמשים פעילים החודש"  value={stats.users30d} />
            <KpiCard icon={Coins} label="סה״כ מטבעות החודש"     value={numberFmt(stats.totalTokens30)} />
            <KpiCard icon={ImageIcon} label="אחוז בקשות עם צירוף" value={stats.attachmentPct7} />
          </div>

          {/* Provider breakdown */}
          <Section title="פילוח לפי ספק (שלושים יום)" icon={Sparkles}>
            {stats.byProvider30.length === 0 ? (
              <Empty text="אין נתונים בטווח הזה." />
            ) : (
              <ul className="space-y-2">
                {stats.byProvider30.map(row => (
                  <BreakdownRow key={row.key} row={row} />
                ))}
              </ul>
            )}
          </Section>

          {/* Feature breakdown */}
          <Section title="פילוח לפי פיצ׳ר (שלושים יום)" icon={Paperclip}>
            {stats.byFeature30.length === 0 ? (
              <Empty text="אין נתונים בטווח הזה." />
            ) : (
              <ul className="space-y-2">
                {stats.byFeature30.map(row => (
                  <BreakdownRow key={row.key} row={row} />
                ))}
              </ul>
            )}
          </Section>

          {/* Top users */}
          <Section title="עשרת המשתמשים הכבדים השבוע" icon={Users}>
            {stats.topUsers.length === 0 ? (
              <Empty text="אין נתונים בטווח הזה." />
            ) : (
              <ul className="space-y-2">
                {stats.topUsers.map((u, idx) => (
                  <li key={u.user_id} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-gray-50">
                    <span className="w-6 h-6 rounded-full bg-[#2D5233] text-white text-xs font-bold flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <span className="flex-1 text-[12px] font-mono truncate text-gray-700" dir="ltr">
                      {u.user_id}
                    </span>
                    <span className="text-[12px] font-bold text-[#1F2937]" dir="ltr">
                      {numberFmt(u.tokens)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Flag toggles */}
          <Section title="ניהול דגלים" icon={ToggleRight}>
            <div className="space-y-3">
              {Object.entries(FLAG_LABELS).map(([key, meta]) => (
                <div key={key} className="flex items-start gap-3 p-3 rounded-xl border border-gray-200 bg-white">
                  <Switch
                    checked={!!flags[key]}
                    onCheckedChange={() => toggleFlag(key)}
                    disabled={savingFlag === key}
                    aria-label={meta.title}
                  />
                  <div className="flex-1 text-right">
                    <p className="text-sm font-bold text-[#1F2937]">{meta.title}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
                      {meta.description}
                    </p>
                  </div>
                  {savingFlag === key && (
                    <Loader2 className="w-4 h-4 animate-spin text-gray-400 shrink-0" />
                  )}
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3 leading-relaxed">
              שינויי דגל נכנסים לתוקף מיד לכרטיסיית הדפדפן הזו, ועד דקה למשתמשים אחרים בגלל מטמון.
            </p>
          </Section>
        </>
      )}
    </div>
  );
}

function KpiCard({ icon: Icon, label, value }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-3.5 shadow-sm">
      <div className="flex items-center gap-1.5 text-[10px] font-bold text-gray-500 mb-1.5">
        {Icon && <Icon className="w-3.5 h-3.5" />}
        <span>{label}</span>
      </div>
      <p className="text-2xl font-bold text-[#1F2937]" dir="ltr">{value}</p>
    </div>
  );
}

function Section({ title, icon: Icon, children }) {
  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-5 shadow-sm mb-5">
      <div className="flex items-center gap-2 mb-3">
        {Icon && <Icon className="w-4 h-4 text-[#D97706]" />}
        <h2 className="text-sm font-bold text-[#1F2937]">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function BreakdownRow({ row }) {
  const pct = Math.round(row.share * 100);
  return (
    <li className="flex items-center gap-3">
      <span className="w-20 text-[12px] font-bold text-gray-700 truncate text-right">{row.label}</span>
      <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full rounded-full bg-[#2D5233]"
          style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
      <span className="text-[11px] text-gray-500 w-10 text-left" dir="ltr">{pct}%</span>
      <span className="text-[12px] font-bold text-[#1F2937] w-20 text-left" dir="ltr">
        {numberFmt(row.tokens)}
      </span>
    </li>
  );
}

function Empty({ text }) {
  return (
    <p className="text-[12px] text-gray-400 text-center py-4">{text}</p>
  );
}
