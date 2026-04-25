/**
 * AdminAiSettings — admin-only UI for picking the AI provider per feature.
 *
 * Writes go through `set_ai_provider(feature, provider)` (SECURITY
 * DEFINER, throws 'admin_required' if the caller isn't an admin), so the
 * client is a thin wrapper — no trust on the client to enforce admin.
 *
 * Reads go through `get_ai_provider(feature)` (authenticated users can
 * read so the Community / AI chat pages can render the badge).
 */

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useNavigate } from 'react-router-dom';
import useIsAdmin from '@/hooks/useIsAdmin';
import { toast } from 'sonner';
import { Sparkles, Check, Loader2, ArrowRight } from 'lucide-react';

const FEATURES = [
  {
    key: 'community_expert',
    title: 'התייעצות עם מומחה AI',
    description: 'תשובות של המומחים בקהילה (ברוך / יוסי) ובצ׳אט עם מומחה.',
  },
  {
    key: 'yossi_chat',
    title: 'צ׳אט קהילה + תגובות AI',
    description: 'תגובות המומחה לשרשורים בקהילה.',
  },
  {
    key: 'scan_extraction',
    title: 'סריקת מסמכים (OCR)',
    description: 'חילוץ פרטים מרישיון רכב, רישיון כלי שיט, רישיון נהיגה.',
  },
];

// Claude intentionally omitted: ANTHROPIC_API_KEY is paid-only and not
// configured for this deployment. The Edge Function still accepts 'claude'
// as a value (back-compat for older saved settings) — we just don't offer
// it as a fresh choice. If a feature is currently set to 'claude' the UI
// auto-corrects it to 'gemini' on load.
const PROVIDERS = [
  { key: 'gemini', label: 'Gemini',  hint: 'Google — מהיר, תומך טקסט + תמונה (מומלץ כברירת מחדל)' },
  { key: 'groq',   label: 'Groq',    hint: 'Meta Llama — טקסט בלבד, הכי מהיר' },
  { key: 'auto',   label: 'אוטומטי', hint: 'המערכת תבחר לפי זמינות וסוג הבקשה (טקסט→Groq, תמונה→Gemini)' },
];

export default function AdminAiSettings() {
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const [settings, setSettings] = useState({}); // { feature: provider }
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);   // feature key currently saving
  // Which provider keys are actually present in Supabase Edge secrets.
  // `null` while loading; populated by the providers_status meta-call.
  // 'auto' is always available (it's a routing strategy, not a key).
  const [available, setAvailable] = useState(null);

  useEffect(() => {
    if (isAdmin !== true) return;
    (async () => {
      // Load both in parallel — saved selections + which keys exist on
      // the server. The latter goes through the ai-proxy Edge Function's
      // `action: 'providers_status'` admin-only branch so we never see
      // the keys themselves, only booleans.
      const [settingsRes, statusRes] = await Promise.all([
        supabase.from('ai_provider_settings').select('feature, preferred_provider'),
        supabase.functions.invoke('ai-proxy', { body: { action: 'providers_status' } }),
      ]);

      if (settingsRes.error) {
        toast.error('טעינת ההגדרות נכשלה: ' + settingsRes.error.message);
        setLoading(false);
        return;
      }
      const map = {};
      (settingsRes.data || []).forEach(r => { map[r.feature] = r.preferred_provider; });
      FEATURES.forEach(f => { if (!map[f.key]) map[f.key] = 'gemini'; });
      // Stale 'claude' from before the option was retired → display as
      // 'gemini' so the user sees a coherent choice. Doesn't write back
      // to the DB; on the next intentional change the new value is saved.
      Object.keys(map).forEach(k => { if (map[k] === 'claude') map[k] = 'gemini'; });
      setSettings(map);

      // Failure here is non-fatal — we just won't grey out unavailable
      // providers (the original behavior). Surface a soft warning.
      if (statusRes.error) {
        if (import.meta.env.DEV) console.warn('[AdminAiSettings] providers_status failed:', statusRes.error.message);
      } else if (statusRes.data?.providers) {
        setAvailable(statusRes.data.providers);
      }

      setLoading(false);
    })();
  }, [isAdmin]);

  // 'auto' is always available; physical providers depend on secrets.
  const isProviderAvailable = (key) => {
    if (key === 'auto') return true;
    if (!available) return true; // unknown → don't disable
    return !!available[key];
  };

  const update = async (feature, provider) => {
    setSaving(feature);
    const prev = settings[feature];
    setSettings(s => ({ ...s, [feature]: provider }));
    const { error } = await supabase.rpc('set_ai_provider', {
      p_feature:  feature,
      p_provider: provider,
    });
    setSaving(null);
    if (error) {
      setSettings(s => ({ ...s, [feature]: prev }));
      toast.error('שמירה נכשלה: ' + error.message);
      return;
    }
    toast.success(`${FEATURES.find(f => f.key === feature)?.title || feature} → ${PROVIDERS.find(p => p.key === provider)?.label || provider}`);
  };

  if (isAdmin === null) return <div className="p-8 text-center text-sm text-gray-500">בודק הרשאות...</div>;
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
          <Sparkles className="w-5 h-5 text-[#D97706]" />
          <h1 className="text-xl sm:text-2xl font-black text-[#1F2937]">הגדרות AI</h1>
        </div>
      </div>

      <p className="text-sm text-gray-600 mb-6 leading-relaxed">
        בחר את ספק ה-AI לכל פיצ׳ר. השינוי חל מיידית על הבקשות הבאות — אין צורך בפריסה מחדש.
        ברירת המחדל למערכת היא <strong>Gemini</strong>.
      </p>

      {loading ? (
        <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : (
        <div className="space-y-5">
          {FEATURES.map(feature => (
            <div key={feature.key} className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
              <div className="mb-3">
                <h3 className="font-bold text-base text-[#1F2937]">{feature.title}</h3>
                <p className="text-xs text-gray-500 mt-1">{feature.description}</p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {PROVIDERS.map(p => {
                  const selected = settings[feature.key] === p.key;
                  const isSaving = saving === feature.key;
                  const unavailable = !isProviderAvailable(p.key);
                  const disabled = isSaving || unavailable;
                  // Note: a provider can be both `selected` (was chosen
                  // before its key was rotated/removed) AND `unavailable`.
                  // We show it as selected but with the "לא מוגדר" hint
                  // so the admin sees the broken state and can re-pick.
                  return (
                    <button
                      key={p.key}
                      onClick={() => !selected && !disabled && update(feature.key, p.key)}
                      disabled={disabled}
                      className={`relative px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                        selected
                          ? 'bg-[#2D5233] text-white shadow-sm'
                          : 'bg-gray-50 text-[#374151] hover:bg-gray-100'
                      } ${disabled && !selected ? 'opacity-40 cursor-not-allowed' : ''}`}
                      title={unavailable ? `${p.label} — אין מפתח API מוגדר ב־Supabase secrets` : p.hint}
                    >
                      {selected && <Check className="w-3.5 h-3.5 absolute top-1.5 right-1.5" />}
                      {p.label}
                      {unavailable && (
                        <span className="block text-[9px] font-bold mt-0.5 opacity-70">
                          לא מוגדר
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-gray-400 mt-2">
                {PROVIDERS.find(p => p.key === settings[feature.key])?.hint}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
