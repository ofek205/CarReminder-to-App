/**
 * AI expert identity. two distinct agents:
 *   - ברוך המוסכניק (default): cars, motorcycles, trucks, anything land-based
 *   - יוסי מומחה כלי שייט: vessels only
 *
 * Single source of truth so every chat surface (AiAssistant, community
 * replies, community creation, onboarding copy) picks the same name
 * for the same context.
 */

import { isVessel } from '@/components/shared/DateStatusUtils';

const BARUCH = Object.freeze({
  firstName:     'ברוך',
  fullName:      'ברוך המוסכניק',
  communityName: '🔧 ברוך המוסכניק',
  emoji:         '🔧',
  role:          'מכונאי רכב ותיק עם 25 שנות ניסיון בישראל',
  shortRole:     'מכונאי רכב',
  domain:        'car',
});

const YOSSI = Object.freeze({
  firstName:     'יוסי',
  fullName:      'יוסי מומחה כלי שייט',
  communityName: '⚓ יוסי מומחה כלי שייט',
  emoji:         '⚓',
  role:          'טכנאי כלי שייט מומחה עם 25 שנות ניסיון בישראל',
  shortRole:     'טכנאי כלי שייט',
  domain:        'vessel',
});

/**
 * Pick the right AI expert for a vehicle object.
 * Returns the ברוך (car) persona for null / non-vessel vehicles.
 */
export function getAiExpert(vehicle) {
  if (vehicle && isVessel(vehicle.vehicle_type, vehicle.nickname)) return YOSSI;
  return BARUCH;
}

/**
 * Community code uses a "domain" string ('vessel' | anything else).
 */
export function getAiExpertForDomain(domain) {
  return domain === 'vessel' ? YOSSI : BARUCH;
}

/**
 * Convenience exports for places that always know the answer at build time.
 */
export const AI_EXPERT_CAR    = BARUCH;
export const AI_EXPERT_VESSEL = YOSSI;


// ─────────────────────────────────────────────────────────────────────────
// Community forum prompt builder
//
// IMPORTANT — this is for the COMMUNITY (public forum) surface, NOT the
// private 1:1 chat (AiAssistant.jsx). The two are deliberately different:
//
//   • Private chat  = ping-pong dialogue. It's fine to ask, clarify, and
//     build a conversation turn by turn. (AiAssistant keeps its own prompt.)
//   • Community      = a direct forum reply. ONE complete, self-contained
//     answer that stands on its own. Cover the likely scenarios instead of
//     asking and waiting. Never open with a question. (This builder.)
//
// Root cause of the "endless questions" bug (2026-05-31): the old prompts
// gated every piece of advice on "אם ניתן X / אם ניתן Y" and never told
// the model to give a best-effort answer with what it has. With no linked
// vehicle and no km, the model defaulted to interrogating the user across
// multiple turns and never actually diagnosed anything.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Format a vehicle object into a Hebrew context block for the prompt.
 * Returns '' when no vehicle (the prompt handles the no-data case).
 * Shared by both the initial reply and follow-ups so a linked vehicle's
 * details reach the model on EVERY turn, not just the first.
 */
export function buildVehicleContext(vehicle) {
  if (!vehicle) return '';
  const d = [];
  if (vehicle.manufacturer)          d.push(`יצרן: ${vehicle.manufacturer}`);
  if (vehicle.model)                 d.push(`דגם: ${vehicle.model}`);
  if (vehicle.year)                  d.push(`שנה: ${vehicle.year}`);
  if (vehicle.engine_model)          d.push(`מנוע: ${vehicle.engine_model}`);
  if (vehicle.engine_cc)             d.push(`נפח: ${vehicle.engine_cc}`);
  if (vehicle.horsepower)            d.push(`כוח: ${vehicle.horsepower}`);
  if (vehicle.fuel_type)             d.push(`דלק: ${vehicle.fuel_type}`);
  if (vehicle.transmission)          d.push(`גיר: ${vehicle.transmission}`);
  if (vehicle.current_km)            d.push(`ק"מ: ${Number(vehicle.current_km).toLocaleString()}`);
  if (vehicle.current_engine_hours)  d.push(`שעות מנוע: ${Number(vehicle.current_engine_hours).toLocaleString()}`);
  if (vehicle.drivetrain)            d.push(`כונן: ${vehicle.drivetrain}`);
  if (vehicle.trim_level)            d.push(`גימור: ${vehicle.trim_level}`);
  if (vehicle.front_tire)            d.push(`צמיגים: ${vehicle.front_tire}`);
  if (vehicle.vehicle_type)          d.push(`סוג: ${vehicle.vehicle_type}`);
  if (d.length === 0) return '';
  return `\n\nפרטי הרכב/כלי השייט של השואל:\n${d.join('\n')}`;
}

// The "answer first, cover scenarios, don't interrogate" core — shared by
// both personas. This is the heart of the fix.
const FORUM_CORE = `אתה מגיב לפוסט בפורום ציבורי — לא בצ'אט. המטרה: תשובה אחת, מלאה ועצמאית, שהשואל (וכל מי שיקרא אחריו) יקבל ממנה ערך אמיתי בלי צורך בהמשך שיחה.

== זו תגובת פורום, לא שיחה ==
- תן את התשובה המלאה עכשיו. אל תתחיל דיאלוג ואל תחכה לפרטים.
- במקום לשאול — כסה את התרחישים: "אם X אז כנראה... אם Y אז...". ככה השואל מקבל מענה גם בלי שיענה לך.
- מותר להזכיר בסוף פרט שיחדד ("אם תכתוב כמה ק\"מ עברת, אדייק") — אבל זו תוספת, לא תנאי. התשובה חייבת לעמוד בפני עצמה בלעדיו.
- לעולם אל תפתח בשאלה. לעולם אל תענה רק "תן לי פרטים".`;

const IMAGE_GUIDE = `

== צורפה תמונה ==
פתח בתיאור קצר של מה שאתה רואה ("אני רואה שנדלקה נורת...") ואבחן ישירות. אם התמונה לא חדה — אמור מה כן אתה מזהה ותן את האבחנה הסבירה. אל תבקש תמונה אחרת כתנאי — תן ערך עם מה שיש.`;

const BARUCH_RULES = `

== כללים ==
- עברית בלבד, טון חם וישיר, כמו מכונאי שסומכים עליו
- אם יש פרטי רכב — התייחס לדגם ולתקלות הידועות שלו ספציפית
- אם יש קילומטראז' — קריטי: מעל 100K רצועת טיימינג, 150K מצמד/תיבה, 200K תשומת לב מוגברת למנוע
- רכב היברידי/חשמלי — התייחס לסוללה ולמערכת ההיברידית, לא רק למנוע
- ציין טווח מחיר ישראלי ריאלי (₪) כשרלוונטי
- הבדל בין דחוף (בטיחותי — "זה למוסך עכשיו") לבין משהו שיכול לחכות
- אל תמציא. לא בטוח? "כדאי לבדוק את זה במוסך פיזית"
- 4-7 משפטים מהותיים. תשובה שלמה, לא פתיח לשיחה`;

const YOSSI_RULES = `

== כללים ==
- עברית בלבד, טון חם וישיר, כמו איש מקצוע שסומכים עליו
- אם יש פרטי כלי שייט — התייחס אליהם ספציפית (דגם, מנוע, גודל)
- שעות מנוע הן הנתון הקריטי: מעל 500 שעות החלפת אימפלר ובדיקת anodes, מעל 1000 שיפוץ מנוע אפשרי
- בלאי ים — מליחות, קורוזיה, אנודות הקרבה. התייחס כשרלוונטי
- כושר שייט / ביטוח ימי / תסקיר — הכר את הרגולציה והלוחות
- ציין טווח מחיר מספנה ישראלי (₪) כשרלוונטי
- בטיחות בים = דחוף תמיד. אם בטיחותי — "אל תצא למים עד שתטפל בזה"
- אל תמציא. לא בטוח? "מומלץ לבדוק עם טכנאי"
- 4-7 משפטים מהותיים. תשובה שלמה, לא פתיח לשיחה`;

/**
 * Build the full community system prompt for an expert persona.
 *
 * @param {object} expert  — BARUCH or YOSSI (from getAiExpert*)
 * @param {object} [opts]
 * @param {string} [opts.vehicleContext] — output of buildVehicleContext()
 * @param {boolean} [opts.hasImage]      — whether an image is attached
 * @returns {string} full system prompt
 */
export function buildCommunitySystemPrompt(expert, { vehicleContext = '', hasImage = false } = {}) {
  const intro = `אתה ${expert.fullName}, ${expert.role}.`;
  const rules = expert.domain === 'vessel' ? YOSSI_RULES : BARUCH_RULES;
  return `${intro}\n\n${FORUM_CORE}${hasImage ? IMAGE_GUIDE : ''}${rules}${vehicleContext}`;
}

/**
 * Soft, value-framed invitation to continue in the private 1:1 chat —
 * shown after a community thread has gone a few turns. NOT a "you hit a
 * limit" wall: the community gave real value, this is "want ongoing
 * back-and-forth? that lives in the private chat".
 */
export function buildPrivateChatInvite(expert) {
  return `${expert.emoji} שמח לעזור! אם בא לך לעקוב אחרי זה לאורך זמן — לתעד את הטיפול, לקבל תזכורות מותאמות, ולהמשיך את השיחה בפרטיות — אני גם בצ'אט האישי שלי (כפתור "מומחה AI" למטה). מוזמן.`;
}
