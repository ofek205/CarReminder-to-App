import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '../components/shared/GuestContext';
import { aiRequest } from '@/lib/aiProxy';
import { hapticFeedback } from '@/lib/capacitor';
import { C, getVehicleVisual, getVehicleCategory } from '@/lib/designTokens';
import VehicleIcon from '../components/shared/VehicleIcon';
import VehicleImage, { hasVehiclePhoto } from '../components/shared/VehicleImage';
import { isVessel, getDateStatus, getVehicleLabels } from '../components/shared/DateStatusUtils';
import { getAiExpert } from '@/lib/aiExpert';
import { Send, Wrench, Loader2, Sparkles, Trash2, AlertTriangle, Check, ChevronDown, X, Copy, RotateCcw, Info } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from 'sonner';
import AiProviderBadge from '@/components/shared/AiProviderBadge';
import useAccountRole from '@/hooks/useAccountRole';
import useMyVehicles from '@/hooks/useMyVehicles';

const STORAGE_KEY_PREFIX = 'yossi_chat_';
// Chat history retention. After this many days the saved messages
// are dropped on next load. Short window (3 days) matches the
// product decision — users come back asking different questions
// and a long backlog clutters the screen. Per-message timestamp
// (date + time) is shown next to each bubble so the user always
// knows when a question/answer happened, even on the last day
// before it expires.
const CHAT_EXPIRY_DAYS = 3;
const getStorageKey = (userId) => `${STORAGE_KEY_PREFIX}${userId || 'guest'}`;
const MIN_LEN = 2;
const MAX_LEN = 800;
const MIN_INTERVAL_MS = 1500; // rate limit between sends

const SUGGESTED_PROMPTS_GENERAL_CAR = [
  'מה חשוב לבדוק לפני קניית רכב יד שניה?',
  'מה המחיר הממוצע להחלפת בלמים?',
  'איך מטפלים בנורית check engine?',
  'מתי להחליף שמן מנוע?',
  'איך מכינים רכב לטסט?',
  'מהן בעיות נפוצות ברכבי 2018-2020?',
];

const SUGGESTED_PROMPTS_GENERAL_VESSEL = [
  'מה חשוב לבדוק לפני קניית כלי שייט יד שנייה?',
  'מתי להחליף שמן במנוע ימי?',
  'מה לבדוק לפני יציאה לים?',
  'איזה ציוד בטיחות חובה בסירה?',
  'איך מכינים כלי שייט לכושר שייט?',
  'תקלות נפוצות במנועים חוץ-ימיים',
];

const SUGGESTED_PROMPTS_VEHICLE_CAR = [
  'מה הטיפולים הקרובים שצריך לעשות?',
  'איזה בעיות נפוצות יש לדגם הזה?',
  'מתי כדאי להחליף צמיגים?',
  'מה המחיר המוערך לטיפול הבא?',
  'יש לי רעש מוזר, מה זה יכול להיות?',
];

const SUGGESTED_PROMPTS_VEHICLE_VESSEL = [
  'מה הטיפולים הקרובים שצריך לעשות?',
  'איזה תקלות נפוצות יש בכלי הזה?',
  'מתי כדאי לעלות למספנה?',
  'מה המחיר המוערך לטיפול הבא?',
  'יש לי רעש/רעידה במנוע, מה זה יכול להיות?',
];

const SUGGESTED_PROMPTS_VEHICLE_MOTORCYCLE = [
  'מה הטיפולים הקרובים שצריך לעשות?',
  'מתי כדאי להחליף שרשרת ושמן מנוע?',
  'איזה צמיגים מתאימים לדגם הזה?',
  'מה המחיר המוערך לטסט שנתי?',
  'יש לי רעידה בכידון, מה זה יכול להיות?',
];

const SUGGESTED_PROMPTS_VEHICLE_TRUCK = [
  'מה הטיפולים הקרובים שצריך לעשות?',
  'מתי הטיפול הבא של מערכת הבלמים?',
  'מה לבדוק לפני נסיעה ארוכה?',
  'מתי כדאי להחליף שמן הילוכים ודיפרנציאל?',
  'יש דליפת אוויר במערכת הבלמים, מה לבדוק?',
];

// CME = Construction & Material Equipment (מלגזה, מחפר, טרקטור, מנוף וכו')
// — שעות מנוע במקום ק"מ, טיפולים אחרים לחלוטין מרכב כביש.
const SUGGESTED_PROMPTS_VEHICLE_CME = [
  'מה הטיפולים הקרובים לפי שעות מנוע?',
  'איזה תקלות נפוצות בכלי הזה?',
  'מה לבדוק לפני יום עבודה?',
  'מתי כדאי להחליף שמן הידראולי ופילטרים?',
  'יש רעש מהמערכת ההידראולית, מה זה יכול להיות?',
];

// Off-road recreational — טרקטורון, באגי, ATV, אופנוע שטח
const SUGGESTED_PROMPTS_VEHICLE_OFFROAD = [
  'מה הטיפולים הקרובים שצריך לעשות?',
  'איזה תקלות נפוצות בכלי הזה?',
  'מה לבדוק אחרי יציאה לשטח?',
  'מתי כדאי להחליף שמן, פילטרים ושרשרת/רצועה?',
  'יש רעש מהתמסורת או מהשרשרת, מה זה יכול להיות?',
];

// Sanitize message text. strip HTML, control chars
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
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    // Same-day messages show time only (it's obvious it's today).
    // Cross-day messages prepend the date so the user can tell at a
    // glance whether the answer is fresh or from yesterday — useful
    // because chat history is now retained only 3 days.
    if (sameDay) return time;
    const date = d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
    return `${date} · ${time}`;
  } catch { return ''; }
}

export default function AiAssistant() {
  const { user, isAuthenticated } = useAuth();
  const { accountId: activeAccountId } = useAccountRole();
  // Vehicles list comes from the shared useMyVehicles hook. Same
  // queryKey ['vehicles', accountId] as the rest of the app, so this
  // screen now hits the in-memory cache (and localStorage seed) the
  // moment the user opens it — no more empty-list flash before the
  // first network response. `hasVessel` is derived directly from the
  // returned list, so a single source of truth feeds both lookups.
  const { vehicles } = useMyVehicles();
  const hasVessel = vehicles.some(v => isVessel(v.vehicle_type, v.nickname));
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Auto-select the vehicle when the user owns exactly one — there's
  // no choice to make, so forcing a manual pick before each question
  // is friction. Two or more vehicles → leave as null so the user
  // explicitly picks the one being asked about (or stays on "general"
  // question). Zero vehicles → stay null, the chat answers
  // general-knowledge questions only. Effect re-runs whenever the
  // vehicles list changes (e.g. the user adds a second vehicle and
  // we should stop auto-selecting).
  useEffect(() => {
    if (vehicles.length === 1 && !selectedVehicleId) {
      setSelectedVehicleId(vehicles[0].id);
    }
  }, [vehicles, selectedVehicleId]);
  const [maintenanceLogs, setMaintenanceLogs] = useState([]); // logs for selected vehicle
  const [error, setError] = useState(null);
  const lastSendRef = useRef(0);
  const scrollRef = useRef(null);
  const messagesEndRef = useRef(null); // sentinel at bottom of message list — anchor for scrollIntoView
  const inputRef = useRef(null);

  // Load chat history. works for both guests and authenticated users
  useEffect(() => {
    setMessages([]);
    const key = getStorageKey(user?.id);
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        const data = parsed?.messages || parsed; // support old format (array) + new format ({messages, savedAt})
        const savedAt = parsed?.savedAt || Date.now();
        // Expire after 30 days
        if (Date.now() - savedAt > CHAT_EXPIRY_DAYS * 24 * 60 * 60 * 1000) {
          localStorage.removeItem(key);
        } else if (Array.isArray(data) && data.length > 0) {
          setMessages(data);
        }
      }
    } catch {}
    // Cleanup old key
    try { localStorage.removeItem('yossi_chat_history'); } catch {}
  }, [user?.id]);

  // Save chat history (last 50 messages). auto-save with timestamp
  useEffect(() => {
    if (messages.length === 0) return;
    const key = getStorageKey(user?.id);
    try {
      localStorage.setItem(key, JSON.stringify({ messages: messages.slice(-50), savedAt: Date.now() }));
    } catch {}
  }, [messages, user?.id]);

  // Vehicles fetch lived here as a useState + useEffect that re-issued
  // db.vehicles.filter on every mount. Replaced by useMyVehicles() at
  // the top of the component — same source-of-truth across all screens,
  // shared cache, instant first paint from localStorage.

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

  // Auto-scroll on new message.
  //
  // We use a sentinel <div ref={messagesEndRef}> at the bottom of the
  // list and call scrollIntoView on it. That's more reliable than
  // computing scrollHeight on the parent — it works regardless of
  // which element is actually the scroll container (inner overflow div
  // vs the document itself), which matters on Android Capacitor where
  // adjustResize changes who's scrolling when the keyboard opens.
  //
  // Two animation frames cover the paint-timing trap: markdown bubbles
  // (badges, tool blocks, multi-line replies) grow the container AFTER
  // the effect runs, so a single rAF would land on a still-stale layout
  // and leave the new bubble off-screen. We also fire one final scroll
  // 250ms later as a safety net for slow Android paints.
  const scrollChatToBottom = useCallback((behavior = 'smooth') => {
    const el = messagesEndRef.current;
    if (!el) return;
    try { el.scrollIntoView({ behavior, block: 'end' }); } catch { /* old browsers */ }
    // scrollIntoView targets the nearest scroll ancestor — which here
    // is the messages container with overflow-y-auto. Once the
    // conversation grows past the viewport (3-4 long replies), the
    // WINDOW also needs to scroll to keep the latest message visible
    // above the fixed input. iOS WKWebView doesn't cascade
    // scrollIntoView from the inner container up to the window, so
    // the new reply stayed off-screen while the user saw the
    // previous one — exactly the "stays at the top" symptom on
    // TestFlight. Scroll the window explicitly as a follow-up.
    try {
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior,
      });
    } catch { /* old browsers */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        scrollChatToBottom('smooth');
      });
    });
    const t = setTimeout(() => { if (!cancelled) scrollChatToBottom('auto'); }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [messages, sending, scrollChatToBottom]);

  // When the input is focused (keyboard opens on mobile), the layout
  // re-flows. Re-anchor to the bottom so the latest message is visible
  // above the keyboard instead of leaving the user mid-thread.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const onFocus = () => {
      // Three timed retries — keyboard animations on Android take
      // 100-300ms to settle, and the WebView resize fires partway through.
      [120, 280, 450].forEach(ms => setTimeout(() => scrollChatToBottom('auto'), ms));
    };
    input.addEventListener('focus', onFocus);
    return () => input.removeEventListener('focus', onFocus);
  }, [scrollChatToBottom]);

  const selectedVehicle = vehicles.find(v => v.id === selectedVehicleId);

  const buildVehicleContext = useCallback(() => {
    if (!selectedVehicle) return '';
    const v = selectedVehicle;
    const lines = [];

    // Identity. Header uses the vehicle-type-aware noun so the model
    // sees "כלי שייט הנדון" / "מלגזה הנדונה" instead of always "רכב",
    // matching the in-page UI labels.
    const ctxLabels = getVehicleLabels(v.vehicle_type, v.nickname);
    const vName = v.nickname || `${v.manufacturer || ''} ${v.model || ''}`.trim() || ctxLabels.vehicleFallback;
    lines.push(`### ${ctxLabels.vehicleWord} הנדון: ${vName}`);

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

    // Recent maintenance. KEY for AI to avoid suggesting things already done
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
    hapticFeedback('light');
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
      setError('רגע אחד. ניתן לשאול שאלה הבאה בעוד שנייה.');
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
      // Pick the expert that matches the selected vehicle (vessel → יוסי, else → ברוך).
      // With no vehicle selected, default to ברוך (the app is car-first).
      const expert = getAiExpert(selectedVehicle);
      const isVesselExpert = expert.domain === 'vessel';
      // Branch the whole prompt — not just the expertise paragraph —
      // because the diagnostic examples and rules are domain-specific
      // (a vessel doesn't have "בלימה" or "קילומטראז'", and the right
      // place to send the user is a שירות שייט / מספנה, not a מוסך).
      // Without this split, יוסי still spoke car at the user.
      const expertise = isVesselExpert
        ? 'אתה מכיר לעומק את כל סוגי כלי השייט (מפרשיות, סירות מנוע, אופנועי ים, סירות גומי, סקי-ג\'ט), מנועים ימיים (Yanmar, Mercury, Volvo Penta, Yamaha, Suzuki Marine, Honda Marine), מערכות חשמל ימיות, ציוד בטיחות ימי, מערכות הנעה (תוך-ימי / חוץ-ימי / סטרן-דרייב), ואת המרינות והמספנות בישראל'
        : 'אתה מכיר לעומק את כל דגמי הרכב הנפוצים בישראל, בעיות ידועות לפי דגם ושנה, ומחירי תיקון ישראליים';

      const vesselExamples = `דוגמאות לשאלות טובות לכלי שייט:
- "מתי זה קורה - בהתנעת המנוע, בנסיעה, בעצירה, בעת השטה במהירות גבוהה?"
- "הרעש/התקלה מהיכן - מנוע, מערכת ההיגוי, גוף הסירה, הפרופלור?"
- "באיזה תנאי ים זה קורה - שקט, גלי, פתוח?"
- "מתי בוצעה ההעלאה האחרונה למספנה / טיפול אחרון?"
- "כמה שעות מנוע יש כיום? מתי הוחלף שמן?"
- "האם השרשרת/עוגן/ציוד הבטיחות במצב תקין?"`;

      const carExamples = `דוגמאות לשאלות טובות:
- "מתי זה קורה - בהתנעה, בנסיעה, בבלימה?"
- "הרעש מגיע מאיזה כיוון - קדמי/אחורי/ימין/שמאל?"
- "כמה זמן זה קורה? האם זה מתגבר?"
- "יש אורות אזהרה שנדלקו יחד עם זה?"
- "האם הרכב ביצע לאחרונה טיפול?"`;

      const itemWord     = isVesselExpert ? 'כלי השייט' : 'הרכב';
      const itemWordRef  = isVesselExpert ? 'כלי השייט שצוין למטה' : 'הרכב שצוין למטה';
      const usageMetric  = isVesselExpert ? 'שעות המנוע' : 'הקילומטראז';
      const fallbackPlace = isVesselExpert
        ? 'מומלץ לבדוק עם טכנאי כלי שייט מוסמך / מספנה'
        : 'מומלץ לבדוק במוסך';
      const finalDisclaimer = isVesselExpert
        ? 'התשובה לצורך התרשמות בלבד - מומלץ להתייעץ עם טכנאי כלי שייט / מספנה מוסמכת'
        : 'התשובה לצורך התרשמות בלבד - מומלץ להתייעץ עם מוסך מוסמך';
      const workStyleLabel = isVesselExpert
        ? 'אופן עבודה, כמו טכנאי כלי שייט מנוסה'
        : 'אופן עבודה, כמו מוסכניק אמיתי';
      const workStyleScene = isVesselExpert
        ? 'כשהבעלים מתאר תקלה במספנה'
        : 'כשאתה שואל לקוח שנכנס למוסך';

      // System prompt structure (Wave 4 #5):
      //   1. Identity + domain expertise.
      //   2. Two response modes — diagnostic flow vs general info.
      //   3. Explicit data-utilization rules so the model actually
      //      uses the vehicle row and maintenance history attached
      //      below instead of giving generic answers.
      //   4. Output template — diagnosis / cause / urgency / cost /
      //      next step. Helps the model give consistently structured
      //      replies the user can scan.
      //   5. Confidence calibration — explicit "say if you're not
      //      sure" rule so the model stops inventing facts.
      //   6. Style rules — Hebrew only, warm-professional tone.
      const systemPrompt = `אתה ${expert.fullName}, ${expert.role}. ${expertise}.

## שני מצבי תשובה:

### א. שאלת אבחון (בעיה, תסמין, תקלה, רעש, נורית, דלף, ריח, רעידה)
אל תענה מיד. שאל **2-4 שאלות ממוקדות** שמכוונות לאבחון בפועל, כמו ${workStyleScene}.

${isVesselExpert ? vesselExamples : carExamples}

אחרי שקיבלת תשובות, תן אבחון בפורמט:
1. **תסמינים תואמים** — שורה אחת. מה זיהית מהמידע.
2. **סיבה סבירה** — שורה-שתיים. הסיבה הטכנית בשם המקצועי (לא רק "תקלה במנוע", אלא "סבירות גבוהה לבעיה במסנן דלק") + ציון רמת הביטחון (גבוהה / בינונית / נדרשת בדיקה).
3. **דחיפות** — דחוף בטיחותית / לטפל בשבועיים / לא דחוף.
4. **הערכת עלות** — טווח שקלים ישראלי ריאלי, אם רלוונטי (חלפים + עבודה בנפרד כשהמידע ידוע).
5. **הצעד הבא** — מה לעשות כעת. בדיקה? נסיעה למוסך? להמתין?

### ב. שאלה כללית/אינפורמטיבית (מחיר, תדירות, "מתי להחליף X")
ענה ישירות, ללא שאלות הכנה, 3-6 שורות.

## שימוש בנתונים — חובה:
${selectedVehicle ? `- ל${itemWord} שצורף יש נתונים מלאים למטה (יצרן, דגם, שנה, ${usageMetric}, היסטוריית טיפולים). **חובה** להזכיר לפחות אחד מהם בתשובה ולקשר אותו לאבחון.
- אם ${usageMetric} גבוה ל${itemWord} (מעל הממוצע), צייני זאת ועל מה זה משפיע.
- אם יש טיפולים ב-6 החודשים האחרונים, **אל תמליצי שוב** עליהם. במקום זה, התייחסי אליהם ("הוחלף שמן לפני 3 חודשים, אז אם הרעש חזר זה לא קשור").
- אם הרכב ישן (10+ שנים) או עם ${usageMetric} גבוה, התייחסי לעלויות יחסית לערך הרכב.` : `- השאלה כללית, ללא ${itemWord} מצורף. תני תשובה כללית בלי להמציא נתונים ספציפיים.`}

## דיוק ואמינות:
- אל תמציאי עובדות. אם אינך בטוח/ה — אמרי במפורש "${fallbackPlace}" או "צריך בדיקה במקום".
- ציוני שמות חלפים/מערכות בשמם המקצועי (אלטרנטור, מסנן אוויר, מצמד) ולא בלשון עממית בלבד.
- במחירים — תני טווח אמיתי לישראל. אם זה דגם נדיר ואינך יודע/ת, צייני זאת.
- בסוף תשובה רגישה (אבחון/המלצת תיקון/הערכת מחיר) — שורה ברורה: "${finalDisclaimer}"

## סגנון:
- עברית בלבד. לא מעורבת. כתיב נכון.
- טון של מקצוען חם — לא רובוטי, לא יומרני. כמו ${workStyleScene}.
- שאלות הכנה: קצרות, 2-4 שאלות, לא שגרת חקירה.
- תשובה לאחר מידע: ממוקדת, ניתנת לסריקה (כותרות/בולטים כשמתאים), בלי "הקדמות".${vehicleContext}`;

      // Conversation history (last 6 messages, excluding errors/retries)
      const recentMessages = [...messages.filter(m => !m.error).slice(-6), userMsg].map(m => ({
        role: m.role,
        content: m.content,
      }));

      const json = await aiRequest({
        // `feature` tells the Edge Function which admin-configured
        // provider to prefer. Defaults to 'gemini' server-side when no
        // override is set.
        feature: 'yossi_chat',
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
        provider: json?.provider || null,  // which AI actually answered
      }]);
    } catch (err) {
      console.error('AI chat error:', err?.code, err?.message);
      // aiProxy now tags errors with .code — match on code first,
      // fall back to message matching for legacy paths. This gives
      // the user an actionable explanation rather than the generic
      // "שירות AI לא זמין" that hid the real problem (network /
      // expired session / quota / slow cold-start).
      let userMsg;
      switch (err?.code) {
        case 'TIMEOUT':
          userMsg = 'התשובה איטית. נסה שוב, יכול להיות שהשירות קם מרדמה.'; break;
        case 'NETWORK':
          userMsg = 'אין חיבור לאינטרנט. בדוק את הרשת ונסה שוב.'; break;
        case 'RATE_LIMIT':
          userMsg = 'יותר מדי בקשות. המתן דקה ונסה שוב.'; break;
        case 'UNAUTHORIZED':
        case 'NO_SESSION':
          userMsg = 'ההתחברות פגה. התחבר מחדש ונסה שוב.'; break;
        case 'PROVIDER_UNAVAILABLE':
          // The proxy already builds a provider-specific message
          // ("Groq זמנית לא זמין. אדמין יכול לבחור ספק אחר...") with
          // an actionable next step. Hardcoding 'לא מוגדר' here threw
          // that away and left the user with a non-actionable line.
          userMsg = err?.message || 'שירות AI לא זמין כרגע. נסה שוב בעוד רגע.';
          break;
        case 'AI_UNAVAILABLE':
          userMsg = 'שירות AI לא זמין כרגע. נסה שוב בעוד רגע.'; break;
        default: {
          const errMsg = err?.message || '';
          if (errMsg.includes('401') || errMsg.includes('403')) {
            userMsg = 'מפתח ה-AI לא תקין. צור קשר עם המנהל.';
          } else if (errMsg.includes('429')) {
            userMsg = 'יותר מדי בקשות. חכה רגע ונסה שוב.';
          } else if (errMsg) {
            userMsg = `שגיאה: ${errMsg.slice(0, 80)}`;
          } else {
            userMsg = 'אופס, תקלת תקשורת. נסה שוב.';
          }
        }
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
    const { copyToClipboard: cp } = await import('@/lib/clipboard');
    const ok = await cp(text);
    toast[ok ? 'success' : 'error'](ok ? 'הועתק ללוח' : 'שגיאה בהעתקה');
  };

  const clearChat = () => {
    if (!confirm('למחוק את כל היסטוריית השיחה?')) return;
    setMessages([]);
    if (user?.id) {
      try { localStorage.removeItem(getStorageKey(user.id)); } catch {}
    }
    toast.success('היסטוריה נמחקה');
  };

  // All hooks first (Rules of Hooks: same order every render, no
  // hook may sit below a derived `const` that could short-circuit).
  const [showAllPrompts, setShowAllPrompts] = useState(false);

  // Expert identity for the currently-selected vehicle (or the default
  // ברוך for general questions). MUST come before any `const` that
  // reads `expert.*` — a previous version had the `expert.domain` check
  // above this line, which crashed at runtime as a TDZ ("Cannot access
  // 'u' before initialization" in the minified bundle).
  const expert = getAiExpert(selectedVehicle);
  const isVesselExpert = expert.domain === 'vessel';

  // Context-aware noun for "this vehicle" — vessel/forklift/tractor users
  // were seeing "רכב" everywhere on this page, which jarred. labels.vehicleWord
  // returns the right Hebrew (כלי שייט / מלגזה / טרקטורון / רכב) per type.
  const labels = getVehicleLabels(selectedVehicle?.vehicle_type, selectedVehicle?.nickname);
  const itemNoun = selectedVehicle ? labels.vehicleWord : 'רכב';

  // Input validation
  const charsLeft = MAX_LEN - input.length;
  const isInputValid = input.trim().length >= MIN_LEN && input.length <= MAX_LEN;

  // Category-aware derivations. We use getVehicleCategory() (the same
  // helper that powers icon/theme picking) so chip prompts AND the
  // disclaimer text ("התייעץ עם...") match the actual kind of vehicle:
  // a forklift gets hour-meter prompts and a "טכנאי כלי הנדסה" hint, a
  // truck gets brake-system prompts, an ATV gets off-road prompts, etc.
  const vehicleCategory = selectedVehicle
    ? getVehicleCategory(selectedVehicle.vehicle_type, selectedVehicle.nickname, selectedVehicle.manufacturer)
    : null;

  // Suggested prompts. General prompts (no vehicle picked) still split
  // car↔vessel on the active expert (יוסי vs ברוך) — that's the only
  // meaningful distinction before a specific vehicle is chosen.
  const generalPrompts = isVesselExpert ? SUGGESTED_PROMPTS_GENERAL_VESSEL : SUGGESTED_PROMPTS_GENERAL_CAR;
  let vehiclePrompts = SUGGESTED_PROMPTS_VEHICLE_CAR;
  if      (vehicleCategory === 'vessel')     vehiclePrompts = SUGGESTED_PROMPTS_VEHICLE_VESSEL;
  else if (vehicleCategory === 'motorcycle') vehiclePrompts = SUGGESTED_PROMPTS_VEHICLE_MOTORCYCLE;
  else if (vehicleCategory === 'truck')      vehiclePrompts = SUGGESTED_PROMPTS_VEHICLE_TRUCK;
  else if (vehicleCategory === 'cme')        vehiclePrompts = SUGGESTED_PROMPTS_VEHICLE_CME;
  else if (vehicleCategory === 'offroad')    vehiclePrompts = SUGGESTED_PROMPTS_VEHICLE_OFFROAD;
  // 'special' / 'car' / null fall through to the car bucket — generic enough.
  const allSuggestedPrompts = selectedVehicle ? vehiclePrompts : generalPrompts;
  const suggestedPrompts = showAllPrompts ? allSuggestedPrompts : allSuggestedPrompts.slice(0, 3);

  // Right kind of professional to recommend. Replaces the old
  // "מוסך מוסמך / טכנאי כלי שייט" binary.
  let repairProfessional = 'מוסך מוסמך';
  if      (vehicleCategory === 'vessel')     repairProfessional = 'טכנאי כלי שייט / מספנה מוסמכת';
  else if (vehicleCategory === 'motorcycle') repairProfessional = 'מוסך אופנועים מוסמך';
  else if (vehicleCategory === 'truck')      repairProfessional = 'מוסך משאיות מוסמך';
  else if (vehicleCategory === 'cme')        repairProfessional = 'טכנאי כלי הנדסה מוסמך';
  else if (vehicleCategory === 'offroad')    repairProfessional = 'מוסך מוסמך לכלי שטח';

  return (
    <div dir="rtl" className="-mx-4 -mt-4 flex flex-col" style={{ background: C.gray50, minHeight: '100dvh' }}>

      {/* Hero gradient header. scrolls away naturally so the layout's fixed
          top bar is the only thing pinned. Sticky here was overlapping the
          chat under the global bar at z-9998. */}
      <div className="relative overflow-hidden pb-6" style={{ background: C.grad }}>
        <div className="relative z-10 px-4 pt-4">
          <div className="flex items-center justify-between mb-2">
            {/* Left avatar. yellow accent */}
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
              style={{ background: C.yellow, boxShadow: '0 4px 16px rgba(255,191,0,0.5), 0 2px 4px rgba(255,191,0,0.3)' }}>
              <Sparkles className="w-6 h-6" style={{ color: C.primary }} />
            </div>

            {/* Center title */}
            <div className="text-center flex-1">
              <h1 className="text-base font-bold text-white">התייעצות עם מומחה AI</h1>
              <div className="flex items-center justify-center gap-1.5 mt-0.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400" />
                </span>
                <p className="text-[10px] font-bold" style={{ color: 'rgba(255,255,255,0.9)' }}>{expert.firstName} זמין · עונה תוך שניות</p>
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
            {expert.shortRole} AI עם 25 שנות ניסיון - שאל הכל
          </p>
        </div>
      </div>

      {/* Vehicle picker + Disclaimer */}
      <div className="px-3 pt-3 pb-1 space-y-2 -mt-3 relative z-20" style={{ background: 'transparent' }}>
        {/* Vehicle picker — same visual language as PostCreateDialog.
         *
         * The old picker was a small chip that users didn't realize was the
         * key to personalised answers. The new card shows the full value
         * prop upfront ("קבל תשובה מותאמת לרכב שלך") and flips to a warm,
         * confirmed state when a vehicle is selected (photo + "ברוך יודע
         * על N טיפולים אחרונים"). */}
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            {(() => {
              const selTheme = selectedVehicle ? getVehicleVisual(selectedVehicle).theme : null;
              const hasPhoto = hasVehiclePhoto(selectedVehicle);
              return (
                <button className="w-full flex items-center justify-between p-3.5 rounded-2xl transition-all active:scale-[0.99] hover:shadow-md"
                  style={{
                    background: selectedVehicle ? `linear-gradient(135deg, ${selTheme.light} 0%, #ffffff 100%)` : '#F0FDF4',
                    border: `2px solid ${selectedVehicle ? selTheme.primary + '55' : C.primary + '40'}`,
                    boxShadow: selectedVehicle ? `0 2px 12px ${selTheme.primary}15` : `0 2px 12px ${C.primary}12`,
                  }}>
                  <div className="flex items-center gap-3 min-w-0">
                    {selectedVehicle ? (
                      <>
                        <div className="w-12 h-12 rounded-xl overflow-hidden flex items-center justify-center shrink-0"
                          style={{ background: selTheme.light }}>
                          {hasPhoto
                            ? <VehicleImage vehicle={selectedVehicle} alt="" className="w-full h-full object-cover" />
                            : <VehicleIcon vehicle={selectedVehicle} className="w-6 h-6" style={{ color: selTheme.primary }} />}
                        </div>
                        <div className="text-right min-w-0">
                          <p className="text-[14px] font-bold truncate" style={{ color: '#111827' }}>
                            {selectedVehicle.nickname || `${selectedVehicle.manufacturer || ''} ${selectedVehicle.model || ''}`.trim()}
                          </p>
                          <p className="text-[11px] font-bold flex items-center gap-1 mt-0.5" style={{ color: selTheme.primary }}>
                            <Sparkles className="w-3 h-3" />
                            {maintenanceLogs.length > 0
                              ? `${expert.firstName} יודע על ${maintenanceLogs.length} טיפולים אחרונים`
                              : `${expert.firstName} יענה מותאם ל${itemNoun} הזה`}
                          </p>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                          style={{ background: C.primary, boxShadow: `0 4px 14px ${C.primary}40` }}>
                          <Sparkles className="w-6 h-6 text-white" />
                        </div>
                        <div className="text-right">
                          <p className="text-[14px] font-bold" style={{ color: '#111827' }}>
                            התייעץ על כלי תחבורה ספציפי
                          </p>
                          <p className="text-[11px] font-semibold mt-0.5" style={{ color: C.primary }}>
                            קבל תשובה מותאמת לכלי התחבורה שלך
                            {vehicles.length > 0 ? ` · ${vehicles.length} ${vehicles.length === 1 ? 'כלי זמין' : 'כלים זמינים'}` : ''}
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {selectedVehicle && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedVehicleId(null); }}
                        className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-black/5 transition-colors"
                        style={{ background: 'rgba(0,0,0,0.04)' }}
                        aria-label="בטל בחירה">
                        <X className="w-3.5 h-3.5" style={{ color: C.gray500 }} />
                      </button>
                    )}
                    <ChevronDown className={`w-5 h-5 transition-transform ${pickerOpen ? 'rotate-180' : ''}`}
                      style={{ color: selectedVehicle ? selTheme.primary : C.primary }} />
                  </div>
                </button>
              );
            })()}
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[calc(100vw-24px)] max-w-sm p-2 rounded-2xl" dir="rtl">
            <div className="space-y-1 max-h-72 overflow-y-auto">
              <button onClick={() => { setSelectedVehicleId(null); setPickerOpen(false); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-right transition-all hover:bg-gray-50"
                style={{ background: !selectedVehicle ? C.gray100 : 'transparent' }}>
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: C.gray200 }}>
                  <Sparkles className="w-4 h-4" style={{ color: C.gray500 }} />
                </div>
                <div className="flex-1 text-right">
                  <p className="text-[13px] font-bold" style={{ color: C.gray700 }}>שאלה כללית</p>
                  <p className="text-[10px]" style={{ color: C.gray400 }}>בלי קישור לכלי תחבורה מסוים</p>
                </div>
                {!selectedVehicle && <Check className="w-4 h-4" style={{ color: C.primary }} />}
              </button>
              {vehicles.length > 0 && <div className="my-1 h-px bg-gray-100" />}
              {vehicles.map(v => {
                const { theme } = getVehicleVisual(v);
                const sel = selectedVehicleId === v.id;
                const vPhoto = hasVehiclePhoto(v);
                return (
                  <button key={v.id} onClick={() => { setSelectedVehicleId(v.id); setPickerOpen(false); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-right transition-all hover:bg-gray-50"
                    style={{ background: sel ? theme.light : 'transparent', border: sel ? `1.5px solid ${theme.primary}40` : '1.5px solid transparent' }}>
                    <div className="w-9 h-9 rounded-lg overflow-hidden flex items-center justify-center shrink-0" style={{ background: theme.light }}>
                      {vPhoto
                        ? <VehicleImage vehicle={v} alt="" className="w-full h-full object-cover" />
                        : <VehicleIcon vehicle={v} className="w-4 h-4" style={{ color: theme.primary }} />}
                    </div>
                    <div className="flex-1 text-right min-w-0">
                      <p className="text-[13px] font-bold truncate" style={{ color: C.gray800 }}>
                        {v.nickname || `${v.manufacturer || ''} ${v.model || ''}`.trim()}
                      </p>
                      <p className="text-[10px]" style={{ color: C.gray400 }}>
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
                <p className="text-[11px] text-center py-3" style={{ color: C.gray400 }}>אין כלי תחבורה שמורים</p>
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
              {expert.firstName} יודע על {maintenanceLogs.length} טיפולים אחרונים ולא יציע מה שכבר בוצע
            </p>
          </div>
        )}

        {/* Disclaimer. vibrant amber */}
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-2xl"
          style={{
            background: `linear-gradient(135deg, ${C.warnSubtle}, ${C.warnBg})`,
            border: `1.5px solid ${C.warnBorder}`,
            boxShadow: '0 1px 4px rgba(217,119,6,0.08)',
          }}>
          <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: C.warnBorder }}>
            <AlertTriangle className="w-3.5 h-3.5" style={{ color: C.warnDark }} />
          </div>
          <p className="text-[10px] leading-relaxed font-medium" style={{ color: '#78350F' }}>
            <span className="font-bold">לתשומת לב:</span> התשובות לצורך התרשמות בלבד. AI עלול לטעות - מומלץ להתייעץ עם {repairProfessional}.
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
                    background: `linear-gradient(135deg, ${C.warnBg}, ${C.yellowSoft})`,
                    border: `2px solid ${C.warnBorder}`,
                    boxShadow: '0 8px 24px rgba(217,119,6,0.2)',
                  }} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Wrench className="w-10 h-10" style={{ color: C.warn }} />
                </div>
                <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center"
                  style={{ background: '#16A34A', boxShadow: '0 2px 8px rgba(22,163,74,0.4)' }}>
                  <Check className="w-4 h-4 text-white" strokeWidth={3} />
                </div>
              </div>
              <h3 className="text-lg font-bold mb-1" style={{ color: C.gray800 }}>שלום! אני {expert.firstName}</h3>
              <p className="text-sm leading-relaxed max-w-[300px] mx-auto" style={{ color: C.gray500 }}>
                {expert.role}.{' '}
                {expert.domain === 'vessel'
                  ? 'שאל אותי על תחזוקה, כושר שייט, ציוד בטיחות או מנועים ימיים.'
                  : 'שאל אותי כל שאלה - מבעיות מנוע, דרך טיפולים ועד מחירי תיקון.'}
                {hasVessel && expert.domain === 'car' && ' (בחר כלי שייט למעלה כדי לעבור ליוסי, המומחה הימי.)'}
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
                  רוצה תשובה ספציפית לכלי שלך?<br />
                  <span className="font-medium" style={{ color: '#6366F1' }}>בחר מהרשימה למעלה</span>
                </p>
              </div>
            )}

            <div className="space-y-2 mt-5 px-1">
              <div className="flex items-center gap-2 mb-2 px-1">
                <Sparkles className="w-3.5 h-3.5" style={{ color: C.primary }} />
                <p className="text-[11px] font-bold" style={{ color: C.gray800 }}>
                  {selectedVehicle ? `הצעות ל${itemNoun} הזה:` : 'הצעות לשאלה:'}
                </p>
              </div>
              {suggestedPrompts.map((p, i) => (
                <button key={i} onClick={() => send(p)}
                  className="w-full text-right p-3.5 rounded-2xl text-[13px] font-medium transition-all active:scale-[0.98] hover:shadow-md card-animate group"
                  style={{
                    background: '#fff',
                    border: `1.5px solid ${C.gray200}`,
                    color: C.gray700,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                    animationDelay: `${100 + i * 60}ms`,
                  }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-right flex-1">{p}</span>
                    <span className="text-base opacity-50 group-hover:opacity-100 transition-opacity" style={{ color: C.primary }}>←</span>
                  </div>
                </button>
              ))}
              {!showAllPrompts && allSuggestedPrompts.length > 3 && (
                <button onClick={() => setShowAllPrompts(true)}
                  className="w-full text-center py-2.5 rounded-2xl text-xs font-bold transition-all active:scale-[0.97]"
                  style={{ color: C.primary, background: C.light, border: `1px solid ${C.border}` }}>
                  עוד הצעות ({allSuggestedPrompts.length - 3})
                </button>
              )}
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
                      style={{ background: C.warnSubtle, border: `1.5px solid ${C.warnBg}` }}>
                      <Wrench className="w-3.5 h-3.5" style={{ color: C.warn }} />
                    </div>
                  )}
                  <div className="max-w-[78%] flex flex-col gap-1">
                    <div className="rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed"
                      style={{
                        background: msg.role === 'user' ? C.primary : '#fff',
                        color: msg.role === 'user' ? '#fff' : (msg.error ? C.error : C.gray800),
                        border: msg.role === 'user' ? 'none' : `1px solid ${C.gray200}`,
                        borderRadius: msg.role === 'user' ? '20px 20px 4px 20px' : '20px 20px 20px 4px',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}>
                      {msg.content}
                    </div>
                    {/* Action row below message */}
                    <div className={`flex items-center gap-2 text-[9px] px-2 ${msg.role === 'user' ? 'justify-start flex-row-reverse' : 'justify-start'}`}
                      style={{ color: C.gray400 }}>
                      {msg.ts && <span>{timeFmt(msg.ts)}</span>}
                      {isAssistant && msg.provider && <AiProviderBadge provider={msg.provider} />}
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
                          style={{ background: C.errorLight, color: C.error }}>
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
              style={{ background: C.warnSubtle, border: `1.5px solid ${C.warnBg}` }}>
              <Wrench className="w-3.5 h-3.5 animate-pulse" style={{ color: C.warn }} />
            </div>
            <div className="rounded-2xl px-4 py-3 flex items-center gap-1.5"
              style={{ background: '#fff', border: `1px solid ${C.gray200}`, borderRadius: '20px 20px 20px 4px' }}>
              <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: C.warn, animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: C.warn, animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: C.warn, animationDelay: '300ms' }} />
            </div>
          </div>
        )}

        {/* Anchor for scrollIntoView — always the last child so auto-scroll
            lands on a stable element regardless of which element is the
            actual scroll container (inner div on desktop, body on Android
            after adjustResize). */}
        <div ref={messagesEndRef} aria-hidden="true" style={{ height: 1 }} />
      </div>

      {/* Input area. premium */}
      <div className="fixed left-0 right-0 z-40"
        style={{
          bottom: 'calc(56px + env(safe-area-inset-bottom, 0px))',
          background: 'rgba(255,255,255,0.95)',
          backdropFilter: 'blur(12px)',
          borderTop: `1px solid ${C.gray200}`,
          boxShadow: '0 -4px 16px rgba(0,0,0,0.04)',
        }}>
        {error && (
          <div className="px-3 py-2 text-[11px] font-bold text-center flex items-center justify-center gap-1.5"
            style={{ background: `linear-gradient(135deg, ${C.errorBg}, ${C.errorLight})`, color: C.error }}>
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
              ? `שאל את ${expert.firstName} על ${selectedVehicle.nickname || selectedVehicle.manufacturer}...`
              : `שאל את ${expert.firstName} על כלי התחבורה שלך...`}
            disabled={sending}
            maxLength={MAX_LEN}
            className="flex-1 h-11 rounded-full px-4 text-[13px] focus-visible:ring-2 focus-visible:ring-offset-0 transition-all"
            style={{
              background: C.gray50,
              border: `1.5px solid ${input.trim().length > 0 ? C.primary + '40' : C.gray200}`,
              boxShadow: input.trim().length > 0 ? `0 0 0 3px ${C.primary}10` : 'none',
            }} />
          <button onClick={() => send()} disabled={!isInputValid || sending}
            className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-all disabled:opacity-30 active:scale-[0.92]"
            style={{
              background: isInputValid ? C.grad : C.primary,
              color: '#fff',
              boxShadow: isInputValid ? `0 4px 16px ${C.primary}50` : `0 2px 8px ${C.primary}30`,
            }}
            aria-label={sending ? 'שולח שאלה למומחה AI' : 'שלח שאלה למומחה AI'}
            aria-busy={sending}>
            {sending
              ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
              : <Send className="w-4 h-4 send-fly" style={{ transform: 'scaleX(-1)' }} aria-hidden="true" />
            }
          </button>
        </div>
        {input.length > MAX_LEN * 0.7 && (
          <div className="px-3 pb-1.5 text-[9px] text-left font-bold" style={{ color: charsLeft < 50 ? C.error : C.gray400 }}>
            {charsLeft} תווים נותרו
          </div>
        )}
      </div>
    </div>
  );
}
