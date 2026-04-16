import React, { useState, useEffect, useRef, useCallback } from 'react';
import { db } from '@/lib/supabaseEntities';
import { supabase } from '@/lib/supabase';
import { useAuth } from '../components/shared/GuestContext';
import { aiRequest } from '@/lib/aiProxy';
import { C, getVehicleVisual } from '@/lib/designTokens';
import VehicleIcon from '../components/shared/VehicleIcon';
import { isVessel, getDateStatus } from '../components/shared/DateStatusUtils';
import { Send, Wrench, Loader2, Sparkles, Trash2, Car, Ship, AlertTriangle, Check, ChevronDown, X, Copy, RotateCcw, Info } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from 'sonner';

const STORAGE_KEY_PREFIX = 'yossi_chat_history_';
const getStorageKey = (userId) => `${STORAGE_KEY_PREFIX}${userId || 'guest'}`;
const MIN_LEN = 2;
const MAX_LEN = 800;
const MIN_INTERVAL_MS = 1500; // rate limit between sends

const SUGGESTED_PROMPTS_GENERAL = [
  'מה חשוב לבדוק לפני קניית רכב יד שניה?',
  'מה המחיר הממוצע להחלפת בלמים?',
  'איך מטפלים בנורית check engine?',
  'מתי להחליף שמן מנוע?',
  'איך מכינים רכב לטסט?',
  'מהן בעיות נפוצות ברכבי 2018-2020?',
];

const SUGGESTED_PROMPTS_VEHICLE = [
  'מה הטיפולים הקרובים שצריך לעשות?',
  'איזה בעיות נפוצות יש לדגם הזה?',
  'מתי כדאי להחליף צמיגים?',
  'מה המחיר המוערך לטיפול הבא?',
  'יש לי רעש מוזר, מה זה יכול להיות?',
];

// Sanitize message text — strip HTML, control chars
function sanitize(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .trim();
}

function timeFmt(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

export default function AiAssistant() {
  const { user, isAuthenticated } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [vehicles, setVehicles] = useState([]);
  const [hasVessel, setHasVessel] = useState(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [maintenanceLogs, setMaintenanceLogs] = useState([]); // logs for selected vehicle
  const [error, setError] = useState(null);
  const lastSendRef = useRef(0);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  // Load chat history per-user (privacy: each user sees only their own chat)
  useEffect(() => {
    // CLEAR previous messages when user changes (security)
    setMessages([]);
    if (!user?.id) return;
    try {
      const stored = localStorage.getItem(getStorageKey(user.id));
      if (stored) setMessages(JSON.parse(stored));
    } catch {}

    // CLEANUP: remove old shared key from previous version (one-time migration)
    try { localStorage.removeItem('yossi_chat_history'); } catch {}
  }, [user?.id]);

  // Save chat history (last 50 only) - per user
  useEffect(() => {
    if (!user?.id) return;
    try {
      localStorage.setItem(getStorageKey(user.id), JSON.stringify(messages.slice(-50)));
    } catch {}
  }, [messages, user?.id]);

  // Load user vehicles
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    (async () => {
      try {
        const members = await db.account_members.filter({ user_id: user.id, status: 'פעיל' });
        if (members.length === 0) return;
        const vs = await db.vehicles.filter({ account_id: members[0].account_id });
        setVehicles(vs || []);
        setHasVessel((vs || []).some(v => isVessel(v.vehicle_type, v.nickname)));
      } catch {}
    })();
  }, [isAuthenticated, user]);

  // Load maintenance logs for selected vehicle
  useEffect(() => {
    if (!selectedVehicleId) { setMaintenanceLogs([]); return; }
    (async () => {
      try {
        const { data } = await supabase
          .from('maintenance_logs')
          .select('*')
          .eq('vehicle_id', selectedVehicleId)
          .order('date', { ascending: false })
          .limit(10);
        setMaintenanceLogs(data || []);
      } catch { setMaintenanceLogs([]); }
    })();
  }, [selectedVehicleId]);

  // Auto-scroll on new message
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  const selectedVehicle = vehicles.find(v => v.id === selectedVehicleId);

  const buildVehicleContext = useCallback(() => {
    if (!selectedVehicle) return '';
    const v = selectedVehicle;
    const lines = [];

    // Identity
    const vName = v.nickname || `${v.manufacturer || ''} ${v.model || ''}`.trim() || 'הרכב';
    lines.push(`### רכב הנדון: ${vName}`);

    // Specs
    const specs = [];
    if (v.manufacturer) specs.push(`יצרן: ${v.manufacturer}`);
    if (v.model) specs.push(`דגם: ${v.model}`);
    if (v.year) specs.push(`שנה: ${v.year}`);
    if (v.trim_level) specs.push(`גימור: ${v.trim_level}`);
    if (v.engine_model) specs.push(`מנוע: ${v.engine_model}`);
    if (v.engine_cc) specs.push(`נפח מנוע: ${v.engine_cc} סמ"ק`);
    if (v.horsepower) specs.push(`כוח סוס: ${v.horsepower}`);
    if (v.fuel_type) specs.push(`דלק: ${v.fuel_type}`);
    if (v.transmission) specs.push(`גיר: ${v.transmission}`);
    if (v.drivetrain) specs.push(`כונן: ${v.drivetrain}`);
    if (v.body_type) specs.push(`סוג מרכב: ${v.body_type}`);
    if (specs.length) lines.push('**מפרט טכני:** ' + specs.join(' | '));

    // Mileage / hours - critical context
    const usage = [];
    if (v.current_km) usage.push(`קילומטראז' נוכחי: ${Number(v.current_km).toLocaleString()} ק"מ`);
    if (v.current_engine_hours) usage.push(`שעות מנוע: ${Number(v.current_engine_hours).toLocaleString()}`);
    if (v.first_registration_date) usage.push(`עלייה לכביש: ${v.first_registration_date}`);
    if (usage.length) lines.push('**שימוש:** ' + usage.join(' | '));

    // Tires
    if (v.front_tire || v.rear_tire) {
      lines.push(`**צמיגים:** ${[v.front_tire, v.rear_tire].filter(Boolean).join(' / ')}`);
      if (v.last_tire_change_date) lines.push(`החלפת צמיגים אחרונה: ${v.last_tire_change_date}`);
    }

    // Status (test, insurance)
    const status = [];
    if (v.test_due_date) {
      const st = getDateStatus(v.test_due_date);
      status.push(`טסט: ${v.test_due_date} (${st?.label || 'תקין'})`);
    }
    if (v.insurance_due_date) {
      const st = getDateStatus(v.insurance_due_date);
      status.push(`ביטוח: ${v.insurance_due_date} (${st?.label || 'תקין'})`);
    }
    if (status.length) lines.push('**מצב רישוי:** ' + status.join(' | '));

    // Recent maintenance — KEY for AI to avoid suggesting things already done
    if (maintenanceLogs.length) {
      lines.push('\n### היסטוריית טיפולים אחרונים (אל תמליץ על מה שכבר בוצע לאחרונה!):');
      maintenanceLogs.slice(0, 8).forEach(log => {
        const parts = [];
        if (log.date) parts.push(log.date);
        if (log.type) parts.push(log.type);
        if (log.title) parts.push(log.title);
        if (log.km_at_service) parts.push(`ב-${Number(log.km_at_service).toLocaleString()} ק"מ`);
        if (log.cost) parts.push(`(${Number(log.cost).toLocaleString()} ש"ח)`);
        if (log.garage_name) parts.push(`@ ${log.garage_name}`);
        lines.push(`- ${parts.join(' · ')}${log.notes ? ` // ${log.notes.slice(0, 80)}` : ''}`);
      });
    } else {
      lines.push('\n*אין היסטוריית טיפולים מתועדת*');
    }

    return '\n\n' + lines.join('\n');
  }, [selectedVehicle, maintenanceLogs]);

  const send = async (text, isRetry = false) => {
    setError(null);
    const raw = (text !== undefined ? text : input);
    const clean = sanitize(raw);

    // Validations
    if (!clean) return;
    if (clean.length < MIN_LEN) {
      setError('הודעה קצרה מדי');
      return;
    }
    if (clean.length > MAX_LEN) {
      setError(`הודעה ארוכה מדי (מקסימום ${MAX_LEN} תווים)`);
      return;
    }
    if (sending) return;

    // Rate limit (skip for retries)
    const now = Date.now();
    if (!isRetry && now - lastSendRef.current < MIN_INTERVAL_MS) {
      setError('רגע, לאט-לאט... חכה שנייה לפני שאלה חדשה');
      return;
    }
    lastSendRef.current = now;

    if (!isRetry) setInput('');
    const userMsg = { role: 'user', content: clean, ts: now, vehicleId: selectedVehicleId };
    // On retry: don't re-add the user message (it's already there)
    if (!isRetry) {
      setMessages(prev => [...prev, userMsg]);
    }
    setSending(true);

    try {
      const vehicleContext = buildVehicleContext();
      const systemPrompt = `אתה יוסי המוסכניק, מכונאי רכב ותיק עם 25 שנות ניסיון בישראל. אתה מכיר לעומק את כל דגמי הרכב הנפוצים בישראל, בעיות ידועות לפי דגם ושנה, מחירי תיקון ישראליים${hasVessel ? ', וגם כלי שייט (מנועי Yanmar, Mercury, Volvo Penta) ומרינות בישראל' : ''}.

## אופן עבודה — כמו מוסכניק אמיתי:
כשמגיעה שאלה על **בעיה, תסמין, תקלה, רעש, נורית אזהרה, דלף, ריח, רעידה** — אל תענה מיד. תחילה שאל **2-3 שאלות ממוקדות** שיעזרו לך לאבחן בדיוק, כמו שאתה שואל לקוח שנכנס למוסך. לאחר שתקבל תשובות — תן אבחון מפורט ומדויק.

דוגמאות לשאלות טובות:
- "מתי זה קורה - בהתנעה, בנסיעה, בבלימה?"
- "הרעש מגיע מאיזה כיוון - קדמי/אחורי/ימין/שמאל?"
- "כמה זמן זה קורה? האם זה מתגבר?"
- "יש אורות אזהרה שנדלקו יחד עם זה?"
- "האם הרכב ביצע לאחרונה טיפול?"

לשאלות **כלליות/אינפורמטיביות** (מחיר, תדירות, מידע כללי, "מתי להחליף X") — ענה ישירות ללא שאלות הכנה.

## כללי תשובה:
- ענה בעברית בלבד, בטון ידידותי וברור
- ${selectedVehicle ? 'התשובה צריכה להתייחס *ספציפית* לרכב שצוין למטה' : 'השאלה כללית - ענה תשובה כללית בלי להתייחס לרכב מסוים'}
${selectedVehicle ? `- חשוב: היסטוריית הטיפולים מצורפת. **אל תמליץ** על טיפולים שכבר בוצעו לאחרונה (פחות מ-6 חודשים)` : ''}
${selectedVehicle ? `- התייחס לקילומטראז' הנוכחי - האם הרכב בקילומטראז' נמוך/בינוני/גבוה` : ''}
- ציין טווח מחירים ישראלי ריאלי לתיקון בשקלים (₪)
- הבדל בין דחוף (בטיחותי) לבין משהו שיכול לחכות
- אל תמציא עובדות - אם אינך בטוח, אמור "מומלץ לבדוק במוסך"
- בסוף כל תשובה רגישה (אבחון/המלצת תיקון/הערכת מחיר) הוסף שורה: "התשובה לצורך התרשמות בלבד - מומלץ להתייעץ עם מוסך מוסמך"
- כשאתה שואל שאלות הכנה — אורך: 2-4 שאלות קצרות בלבד. כשאתה עונה לאחר קבלת המידע — 2-5 משפטים, ברורה ופרקטית${vehicleContext}`;

      // Conversation history (last 6 messages, excluding errors/retries)
      const recentMessages = [...messages.filter(m => !m.error).slice(-6), userMsg].map(m => ({
        role: m.role,
        content: m.content,
      }));

      const json = await aiRequest({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 700,
        system: systemPrompt,
        messages: recentMessages,
      });

      const aiText = json?.content?.[0]?.text || 'מצטער, לא הצלחתי לענות. נסה שוב.';
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: sanitize(aiText).slice(0, 2500),
        ts: Date.now(),
        vehicleId: selectedVehicleId,
      }]);
    } catch (err) {
      console.error('AI chat error:', err);
      const errMsg = err?.message || '';
      let userMsg = 'אופס, תקלת תקשורת. נסה שוב.';
      if (errMsg.includes('Invalid Groq API key') || errMsg.includes('401') || errMsg.includes('403')) {
        userMsg = 'מפתח ה-AI לא תקין. צור קשר עם המנהל.';
      } else if (errMsg.includes('429') || errMsg.includes('rate')) {
        userMsg = 'יותר מדי בקשות. חכה רגע ונסה שוב.';
      } else if (errMsg.includes('שירות AI לא זמין')) {
        userMsg = errMsg;
      } else if (errMsg) {
        userMsg = `שגיאה: ${errMsg.slice(0, 80)}`;
      }
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: userMsg,
        ts: Date.now(),
        error: true,
        retryText: clean,
      }]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const retryLast = (text) => {
    // Remove the last error message and resend (without re-adding user message)
    setMessages(prev => prev.filter((m, i) => !(i === prev.length - 1 && m.error)));
    setTimeout(() => send(text, true), 100);
  };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('הועתק ללוח');
    } catch { toast.error('שגיאה בהעתקה'); }
  };

  const clearChat = () => {
    if (!confirm('למחוק את כל היסטוריית השיחה?')) return;
    setMessages([]);
    if (user?.id) {
      try { localStorage.removeItem(getStorageKey(user.id)); } catch {}
    }
    toast.success('היסטוריה נמחקה');
  };

  const charsLeft = MAX_LEN - input.length;
  const isInputValid = input.trim().length >= MIN_LEN && input.length <= MAX_LEN;
  const suggestedPrompts = selectedVehicle ? SUGGESTED_PROMPTS_VEHICLE : SUGGESTED_PROMPTS_GENERAL;

  return (
    <div dir="rtl" className="-mx-4 -mt-4 flex flex-col" style={{ background: '#F9FAFB', minHeight: '100dvh' }}>

      {/* Hero gradient header — premium */}
      <div className="sticky top-0 z-30 relative overflow-hidden pb-6" style={{ background: C.grad }}>
        {/* Decorative circles */}
        <div className="absolute -top-12 -left-16 w-48 h-48 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }} />
        <div className="absolute -bottom-8 -right-8 w-32 h-32 rounded-full" style={{ background: 'rgba(255,191,0,0.18)' }} />
        <div className="absolute top-10 right-1/3 w-2 h-2 rounded-full bg-white/30 animate-pulse" />
        <div className="absolute top-16 right-1/4 w-1.5 h-1.5 rounded-full bg-yellow-300/60" />

        <div className="relative z-10 px-4 pt-4">
          <div className="flex items-center justify-between mb-2">
            {/* Left avatar — yellow accent */}
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
              style={{ background: '#FFBF00', boxShadow: '0 4px 16px rgba(255,191,0,0.5), 0 2px 4px rgba(255,191,0,0.3)' }}>
              <Sparkles className="w-6 h-6" style={{ color: C.primary }} />
            </div>

            {/* Center title */}
            <div className="text-center flex-1">
              <h1 className="text-base font-black text-white">התייעצות עם מומחה AI</h1>
              <div className="flex items-center justify-center gap-1.5 mt-0.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400" />
                </span>
                <p className="text-[10px] font-bold" style={{ color: 'rgba(255,255,255,0.9)' }}>יוסי זמין · עונה תוך שניות</p>
              </div>
            </div>

            {/* Right action */}
            {messages.length > 0 ? (
              <button onClick={clearChat}
                className="w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-[0.92] hover:bg-white/30"
                style={{ background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(8px)' }}>
                <Trash2 className="w-4 h-4 text-white/90" />
              </button>
            ) : (
              <div className="w-9 h-9" />
            )}
          </div>

          <p className="text-[11px] font-medium text-center mt-2" style={{ color: 'rgba(255,255,255,0.85)' }}>
            🔧 מכונאי AI עם 25 שנות ניסיון - שאל הכל
          </p>
        </div>
      </div>

      {/* Vehicle picker + Disclaimer */}
      <div className="px-3 pt-3 pb-1 space-y-2 -mt-3 relative z-20" style={{ background: 'transparent' }}>
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <button className="w-full flex items-center justify-between px-3 py-3 rounded-2xl transition-all active:scale-[0.99] hover:shadow-md"
              style={{
                background: '#fff',
                border: `1.5px solid ${selectedVehicle ? C.primary + '40' : '#E5E7EB'}`,
                boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
              }}>
              <div className="flex items-center gap-2 min-w-0">
                {selectedVehicle ? (
                  <>
                    {(() => {
                      const { theme } = getVehicleVisual(selectedVehicle);
                      return (
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: theme.light }}>
                          <VehicleIcon vehicle={selectedVehicle} className="w-3.5 h-3.5" style={{ color: theme.primary }} />
                        </div>
                      );
                    })()}
                    <div className="text-right min-w-0">
                      <p className="text-[11px] font-bold truncate" style={{ color: '#1F2937' }}>
                        {selectedVehicle.nickname || `${selectedVehicle.manufacturer || ''} ${selectedVehicle.model || ''}`.trim()}
                      </p>
                      <p className="text-[9px]" style={{ color: '#9CA3AF' }}>
                        {selectedVehicle.year ? `${selectedVehicle.year} · ` : ''}
                        {selectedVehicle.current_km ? `${Number(selectedVehicle.current_km).toLocaleString()} ק"מ · ` : ''}
                        {maintenanceLogs.length > 0 ? `${maintenanceLogs.length} טיפולים מתועדים` : 'אין היסטוריה'}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: '#F3F4F6' }}>
                      <Sparkles className="w-3.5 h-3.5" style={{ color: '#6B7280' }} />
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] font-bold" style={{ color: '#1F2937' }}>שאלה כללית</p>
                      <p className="text-[9px]" style={{ color: '#9CA3AF' }}>לחץ לבחירת רכב ספציפי</p>
                    </div>
                  </>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {selectedVehicle && (
                  <button onClick={(e) => { e.stopPropagation(); setSelectedVehicleId(null); }}
                    className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: '#F3F4F6' }}>
                    <X className="w-3 h-3" style={{ color: '#9CA3AF' }} />
                  </button>
                )}
                <ChevronDown className="w-4 h-4" style={{ color: '#9CA3AF' }} />
              </div>
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[calc(100vw-24px)] max-w-sm p-2 rounded-2xl" dir="rtl">
            <div className="space-y-1 max-h-72 overflow-y-auto">
              <button onClick={() => { setSelectedVehicleId(null); setPickerOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-right transition-all hover:bg-gray-50">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: '#F3F4F6' }}>
                  <Sparkles className="w-3.5 h-3.5" style={{ color: '#6B7280' }} />
                </div>
                <div className="flex-1 text-right">
                  <p className="text-[12px] font-bold" style={{ color: '#1F2937' }}>שאלה כללית</p>
                  <p className="text-[10px]" style={{ color: '#9CA3AF' }}>בלי קישור לרכב מסוים</p>
                </div>
                {!selectedVehicle && <Check className="w-4 h-4" style={{ color: C.primary }} />}
              </button>
              {vehicles.length > 0 && <div className="my-1 h-px bg-gray-100" />}
              {vehicles.map(v => {
                const { theme } = getVehicleVisual(v);
                const sel = selectedVehicleId === v.id;
                return (
                  <button key={v.id} onClick={() => { setSelectedVehicleId(v.id); setPickerOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-right transition-all hover:bg-gray-50">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: theme.light }}>
                      <VehicleIcon vehicle={v} className="w-3.5 h-3.5" style={{ color: theme.primary }} />
                    </div>
                    <div className="flex-1 text-right min-w-0">
                      <p className="text-[12px] font-bold truncate" style={{ color: '#1F2937' }}>
                        {v.nickname || `${v.manufacturer || ''} ${v.model || ''}`.trim()}
                      </p>
                      <p className="text-[10px]" style={{ color: '#9CA3AF' }}>
                        {[v.manufacturer, v.year].filter(Boolean).join(' · ')}
                        {v.current_km ? ` · ${Number(v.current_km).toLocaleString()} ק"מ` : ''}
                        {v.current_engine_hours && !v.current_km ? ` · ${v.current_engine_hours} שעות` : ''}
                      </p>
                    </div>
                    {sel && <Check className="w-4 h-4" style={{ color: theme.primary }} />}
                  </button>
                );
              })}
              {vehicles.length === 0 && (
                <p className="text-[11px] text-center py-3" style={{ color: '#9CA3AF' }}>אין רכבים שמורים</p>
              )}
            </div>
          </PopoverContent>
        </Popover>

        {/* Smart context indicator (when vehicle selected) */}
        {selectedVehicle && maintenanceLogs.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl"
            style={{ background: '#EEF2FF', border: '1px solid #C7D2FE' }}>
            <Info className="w-3 h-3 shrink-0" style={{ color: '#4338CA' }} />
            <p className="text-[10px] leading-tight" style={{ color: '#4338CA' }}>
              יוסי יודע על {maintenanceLogs.length} טיפולים אחרונים ולא יציע מה שכבר בוצע
            </p>
          </div>
        )}

        {/* Disclaimer — vibrant amber */}
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-2xl"
          style={{
            background: 'linear-gradient(135deg, #FFFBEB, #FEF3C7)',
            border: '1.5px solid #FDE68A',
            boxShadow: '0 1px 4px rgba(217,119,6,0.08)',
          }}>
          <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: '#FDE68A' }}>
            <AlertTriangle className="w-3.5 h-3.5" style={{ color: '#92400E' }} />
          </div>
          <p className="text-[10px] leading-relaxed font-medium" style={{ color: '#78350F' }}>
            <span className="font-bold">לתשומת לב:</span> התשובות לצורך התרשמות בלבד. AI עלול לטעות - מומלץ להתייעץ עם מוסך מוסמך.
          </p>
        </div>
      </div>

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 pb-32 space-y-3">
        {messages.length === 0 ? (
          <div className="card-animate">
            {/* Welcome card */}
            <div className="text-center py-4">
              <div className="relative w-20 h-20 mx-auto mb-3">
                <div className="absolute inset-0 rounded-3xl"
                  style={{
                    background: 'linear-gradient(135deg, #FEF3C7, #FFF8E1)',
                    border: '2px solid #FDE68A',
                    boxShadow: '0 8px 24px rgba(217,119,6,0.2)',
                  }} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Wrench className="w-10 h-10" style={{ color: '#D97706' }} />
                </div>
                <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center"
                  style={{ background: '#16A34A', boxShadow: '0 2px 8px rgba(22,163,74,0.4)' }}>
                  <Check className="w-4 h-4 text-white" strokeWidth={3} />
                </div>
              </div>
              <h3 className="text-lg font-black mb-1" style={{ color: '#1F2937' }}>שלום! אני יוסי 👋</h3>
              <p className="text-sm leading-relaxed max-w-[300px] mx-auto" style={{ color: '#6B7280' }}>
                {hasVessel ? 'מכונאי רכב וטכנאי כלי שייט. ' : 'מכונאי רכב ותיק. '}
                שאל אותי כל שאלה - מבעיות מנוע, דרך טיפולים ועד מחירי תיקון.
              </p>
            </div>

            {vehicles.length > 0 && !selectedVehicle && (
              <div className="rounded-2xl p-3 mb-3 mx-1 flex items-center gap-2"
                style={{
                  background: 'linear-gradient(135deg, #EEF2FF, #F5F3FF)',
                  border: '1.5px solid #C7D2FE',
                  boxShadow: '0 1px 4px rgba(99,102,241,0.08)',
                }}>
                <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: '#6366F1', boxShadow: '0 2px 8px rgba(99,102,241,0.4)' }}>
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <p className="text-[11px] font-bold leading-tight" style={{ color: '#3730A3' }}>
                  רוצה תשובה ספציפית לרכב שלך?<br />
                  <span className="font-medium" style={{ color: '#6366F1' }}>בחר רכב מהרשימה למעלה</span>
                </p>
              </div>
            )}

            <div className="space-y-2 mt-5 px-1">
              <div className="flex items-center gap-2 mb-2 px-1">
                <Sparkles className="w-3.5 h-3.5" style={{ color: C.primary }} />
                <p className="text-[11px] font-black" style={{ color: '#1F2937' }}>
                  {selectedVehicle ? `הצעות לרכב הזה:` : 'הצעות לשאלה:'}
                </p>
              </div>
              {suggestedPrompts.map((p, i) => (
                <button key={i} onClick={() => send(p)}
                  className="w-full text-right p-3.5 rounded-2xl text-[13px] font-medium transition-all active:scale-[0.98] hover:shadow-md card-animate group"
                  style={{
                    background: '#fff',
                    border: '1.5px solid #E5E7EB',
                    color: '#374151',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                    animationDelay: `${100 + i * 60}ms`,
                  }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-right flex-1">{p}</span>
                    <span className="text-base opacity-50 group-hover:opacity-100 transition-opacity" style={{ color: C.primary }}>←</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => {
            const isAssistant = msg.role === 'assistant';
            const showVehicleBadge = msg.vehicleId && msg.vehicleId !== messages[i - 1]?.vehicleId;
            const vehicleForMsg = msg.vehicleId ? vehicles.find(v => v.id === msg.vehicleId) : null;
            return (
              <React.Fragment key={msg.ts || i}>
                {showVehicleBadge && vehicleForMsg && (() => {
                  const { theme: themeMsg } = getVehicleVisual(vehicleForMsg);
                  return (
                    <div className="flex justify-center my-2">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-bold"
                        style={{ background: themeMsg.light, color: themeMsg.primary }}>
                        <VehicleIcon vehicle={vehicleForMsg} className="w-2.5 h-2.5" />
                        שואל על: {vehicleForMsg.nickname || vehicleForMsg.manufacturer}
                      </span>
                    </div>
                  );
                })()}
                <div className={`flex gap-2 card-animate group ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  {isAssistant && (
                    <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: '#FFFBEB', border: '1.5px solid #FEF3C7' }}>
                      <Wrench className="w-3.5 h-3.5" style={{ color: '#D97706' }} />
                    </div>
                  )}
                  <div className="max-w-[78%] flex flex-col gap-1">
                    <div className="rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed"
                      style={{
                        background: msg.role === 'user' ? C.primary : '#fff',
                        color: msg.role === 'user' ? '#fff' : (msg.error ? '#DC2626' : '#1F2937'),
                        border: msg.role === 'user' ? 'none' : '1px solid #E5E7EB',
                        borderRadius: msg.role === 'user' ? '20px 20px 4px 20px' : '20px 20px 20px 4px',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}>
                      {msg.content}
                    </div>
                    {/* Action row below message */}
                    <div className={`flex items-center gap-2 text-[9px] px-2 ${msg.role === 'user' ? 'justify-start flex-row-reverse' : 'justify-start'}`}
                      style={{ color: '#9CA3AF' }}>
                      {msg.ts && <span>{timeFmt(msg.ts)}</span>}
                      {isAssistant && !msg.error && (
                        <button onClick={() => copyToClipboard(msg.content)}
                          className="flex items-center gap-0.5 p-1 rounded hover:bg-gray-100 transition-all opacity-60 group-hover:opacity-100"
                          title="העתק">
                          <Copy className="w-2.5 h-2.5" />
                        </button>
                      )}
                      {isAssistant && msg.error && msg.retryText && (
                        <button onClick={() => retryLast(msg.retryText)}
                          className="flex items-center gap-1 px-2 py-0.5 rounded-full font-bold transition-all"
                          style={{ background: '#FEE2E2', color: '#DC2626' }}>
                          <RotateCcw className="w-2.5 h-2.5" />
                          נסה שוב
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </React.Fragment>
            );
          })
        )}

        {sending && (
          <div className="flex gap-2 card-animate">
            <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
              style={{ background: '#FFFBEB', border: '1.5px solid #FEF3C7' }}>
              <Wrench className="w-3.5 h-3.5 animate-pulse" style={{ color: '#D97706' }} />
            </div>
            <div className="rounded-2xl px-4 py-3 flex items-center gap-1.5"
              style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: '20px 20px 20px 4px' }}>
              <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: '#D97706', animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: '#D97706', animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: '#D97706', animationDelay: '300ms' }} />
            </div>
          </div>
        )}
      </div>

      {/* Input area — premium */}
      <div className="fixed left-0 right-0 z-40"
        style={{
          bottom: 'calc(56px + env(safe-area-inset-bottom, 0px))',
          background: 'rgba(255,255,255,0.95)',
          backdropFilter: 'blur(12px)',
          borderTop: '1px solid #E5E7EB',
          boxShadow: '0 -4px 16px rgba(0,0,0,0.04)',
        }}>
        {error && (
          <div className="px-3 py-2 text-[11px] font-bold text-center flex items-center justify-center gap-1.5"
            style={{ background: 'linear-gradient(135deg, #FEF2F2, #FEE2E2)', color: '#DC2626' }}>
            <AlertTriangle className="w-3 h-3" />
            {error}
          </div>
        )}
        <div className="flex items-center gap-2 px-3 py-2.5 max-w-md mx-auto">
          <Input
            ref={inputRef}
            value={input}
            onChange={e => { setInput(e.target.value.slice(0, MAX_LEN)); setError(null); }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={selectedVehicle
              ? `שאל את יוסי על ${selectedVehicle.nickname || selectedVehicle.manufacturer}...`
              : 'שאל את יוסי על הרכב שלך...'}
            disabled={sending}
            maxLength={MAX_LEN}
            className="flex-1 h-11 rounded-full px-4 text-[13px] focus-visible:ring-2 focus-visible:ring-offset-0 transition-all"
            style={{
              background: '#F9FAFB',
              border: `1.5px solid ${input.trim().length > 0 ? C.primary + '40' : '#E5E7EB'}`,
              boxShadow: input.trim().length > 0 ? `0 0 0 3px ${C.primary}10` : 'none',
            }} />
          <button onClick={() => send()} disabled={!isInputValid || sending}
            className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-all disabled:opacity-30 active:scale-[0.92]"
            style={{
              background: isInputValid ? C.grad : C.primary,
              color: '#fff',
              boxShadow: isInputValid ? `0 4px 16px ${C.primary}50` : `0 2px 8px ${C.primary}30`,
            }}>
            {sending
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : <Send className="w-4 h-4 send-fly" style={{ transform: 'scaleX(-1)' }} />
            }
          </button>
        </div>
        {input.length > MAX_LEN * 0.7 && (
          <div className="px-3 pb-1.5 text-[9px] text-left font-bold" style={{ color: charsLeft < 50 ? '#DC2626' : '#9CA3AF' }}>
            {charsLeft} תווים נותרו
          </div>
        )}
      </div>
    </div>
  );
}
