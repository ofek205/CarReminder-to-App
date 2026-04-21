/**
 * Skipper Assistant — system checklist templates.
 *
 * Source of truth for V1. Later phases can add user templates on top via
 * a DB table; for now, system templates live in code so we can iterate
 * without migrations.
 *
 * Shape:
 *   template = {
 *     key,                        // stable identifier used in checklist_runs.template_key
 *     name,                       // Hebrew display name
 *     phase,                      // 'pre' | 'post'
 *     applicable_boat_types,      // array of vehicle_type values
 *     requires_attrs,             // optional filter — item only appears if all true
 *     sections: [{ id, name, items: [...] }],
 *   }
 *
 * item = {
 *   key,                          // unique within the template
 *   name,                         // Hebrew label
 *   severity_on_fail,             // 'blocker' | 'advisory' | 'log'
 *   requires_attrs?,              // optional — only include this item if matched
 *   help?,                        // optional short help text
 * }
 *
 * `requires_attrs` example:
 *   { has_vhf: true }             → include item only when vehicle has VHF
 *   { engine_type: 'outboard' }   → include for outboards only
 *   { has_sails: true }           → sailing-specific
 */

// ── Section priority — drives ordering in the runner ─────────────────────
export const SECTION_ORDER = [
  'safety', 'weather', 'engine', 'fuel', 'electrical', 'navigation',
  'deck', 'sails', 'rigging', 'cleanup', 'shutdown', 'docking',
];

// ── Severity labels for UI ───────────────────────────────────────────────
export const SEVERITY = {
  blocker:  { label: 'חוסם יציאה',  color: '#DC2626', bg: '#FEE2E2' },
  advisory: { label: 'מומלץ לטפל',  color: '#D97706', bg: '#FEF3C7' },
  log:      { label: 'הערה',        color: '#6B7280', bg: '#F3F4F6' },
};

// ═══════════════════════════════════════════════════════════════════════════
// MOTORBOAT  ·  pre / post (short trip)
// ═══════════════════════════════════════════════════════════════════════════

const MOTORBOAT_PRE_SHORT = {
  key: 'motorboat_pre_short',
  name: 'לפני יציאה — סירה מנועית',
  phase: 'pre',
  applicable_boat_types: ['סירה מנועית', 'סירת גומי', 'אופנוע ים'],
  sections: [
    {
      id: 'safety',
      name: 'בטיחות',
      items: [
        { key: 'life_jackets',   name: 'חגורות הצלה לכל הנוסעים',        severity_on_fail: 'blocker' },
        { key: 'flares_valid',   name: 'פירוטכניקה בתוקף',                severity_on_fail: 'blocker' },
        { key: 'fire_ext',       name: 'מטף בתוך תוקף',                   severity_on_fail: 'blocker' },
        { key: 'first_aid',      name: 'ערכת עזרה ראשונה',                severity_on_fail: 'advisory' },
        { key: 'kill_switch',    name: 'חבל ניתוק / שלט חירום מחובר',     severity_on_fail: 'blocker' },
        { key: 'vhf_test',       name: 'VHF עובד',                         severity_on_fail: 'advisory',
          requires_attrs: { has_vhf: true } },
        { key: 'life_raft',      name: 'רפסודת הצלה בתוך תוקף',            severity_on_fail: 'advisory',
          help: 'בדיקה תקופתית אחת לשנה. סימון שחוק = אתגר בעת חירום.' },
      ],
    },
    {
      id: 'weather',
      name: 'מזג אוויר וניווט',
      items: [
        { key: 'forecast_wind',  name: 'בדקתי תחזית רוח',                  severity_on_fail: 'blocker',
          help: 'מעל 20 קשר = שקול לדחות יציאה. מעל 25 קשר = לא יוצאים.' },
        { key: 'forecast_wave',  name: 'בדקתי תחזית גלים',                severity_on_fail: 'blocker' },
        { key: 'float_plan',     name: 'הודעתי למישהו ביבשה על יעד וזמן חזרה', severity_on_fail: 'advisory' },
        { key: 'chart_gps',      name: 'GPS / מפת ניווט פעילה',            severity_on_fail: 'advisory' },
      ],
    },
    {
      id: 'engine',
      name: 'מנוע ודלק',
      items: [
        { key: 'fuel_level',     name: 'דלק: לפחות 2/3 מהמכל',            severity_on_fail: 'blocker',
          help: 'כלל האצבע: 1/3 הלוך · 1/3 חזור · 1/3 רזרבה.' },
        { key: 'fuel_contamination', name: 'דלק ללא מים (מפריד מים)',     severity_on_fail: 'blocker' },
        { key: 'oil_check',      name: 'מפלס שמן תקין',                    severity_on_fail: 'blocker' },
        { key: 'cooling_inlet',  name: 'פתחי מי קירור נקיים',               severity_on_fail: 'blocker' },
        { key: 'engine_start',   name: 'מנוע מניע בקלות',                   severity_on_fail: 'blocker' },
        { key: 'cooling_flow',   name: 'זרימת מי קירור (tell-tale)',        severity_on_fail: 'blocker',
          help: 'אין זרימה = לכבות מיד. סיכון להתחממות יתר תוך דקות.' },
        { key: 'impeller_visual', name: 'משאבת מים נראית תקינה (ללא רעידות)', severity_on_fail: 'advisory' },
      ],
    },
    {
      id: 'electrical',
      name: 'חשמל',
      items: [
        { key: 'battery_voltage', name: 'מצבר מעל 12.4V',                   severity_on_fail: 'advisory' },
        { key: 'nav_lights',     name: 'אורות ניווט עובדים',               severity_on_fail: 'advisory' },
        { key: 'bilge_pump',     name: 'משאבת בילג׳ עובדת',                 severity_on_fail: 'blocker',
          requires_attrs: { has_bilge_pump: true } },
      ],
    },
    {
      id: 'deck',
      name: 'סיפון ועגינה',
      items: [
        { key: 'anchor_ready',   name: 'עוגן + שרשרת זמינים',               severity_on_fail: 'blocker' },
        { key: 'electric_anchor', name: 'עוגן חשמלי עובד',                  severity_on_fail: 'advisory',
          requires_attrs: { has_electric_anchor: true } },
        { key: 'fenders',        name: 'מגיני רציף זמינים',                 severity_on_fail: 'advisory' },
        { key: 'ropes',          name: 'חבלי עגינה במצב טוב',               severity_on_fail: 'advisory' },
        { key: 'hull_visual',    name: 'בדיקה ויזואלית של גוף הסירה',       severity_on_fail: 'blocker' },
        { key: 'drain_plug',     name: 'פקק ניקוז סגור',                    severity_on_fail: 'blocker',
          help: 'פקק פתוח = סירה שוקעת תוך דקות. בדיקה קריטית.' },
      ],
    },
  ],
};

const MOTORBOAT_POST_SHORT = {
  key: 'motorboat_post_short',
  name: 'חזרה לנמל — סירה מנועית',
  phase: 'post',
  applicable_boat_types: ['סירה מנועית', 'סירת גומי', 'אופנוע ים'],
  sections: [
    {
      id: 'shutdown',
      name: 'כיבוי מנוע',
      items: [
        { key: 'flush_engine',   name: 'שטיפת מנוע במים מתוקים',            severity_on_fail: 'advisory',
          help: 'מי מלח גורמים לקורוזיה מהירה. שטיפה של 5 דקות = הבדל משמעותי.',
          requires_attrs: { water_type: 'sea' } },
        { key: 'fuel_shutoff',   name: 'ברז דלק סגור (אם יש)',              severity_on_fail: 'log' },
        { key: 'battery_off',    name: 'מפסק מצבר ראשי כבוי',               severity_on_fail: 'advisory' },
      ],
    },
    {
      id: 'cleanup',
      name: 'ניקוי וסגירה',
      items: [
        { key: 'wash_deck',      name: 'שטיפת סיפון ממלח',                   severity_on_fail: 'log' },
        { key: 'cover',          name: 'כיסוי הסירה',                        severity_on_fail: 'log' },
        { key: 'electronics_off', name: 'אלקטרוניקה כבויה (GPS, VHF)',       severity_on_fail: 'advisory' },
      ],
    },
    {
      id: 'docking',
      name: 'עגינה',
      items: [
        { key: 'lines_secured',  name: 'חבלי עגינה קשורים נכון',             severity_on_fail: 'blocker' },
        { key: 'fenders_placed', name: 'מגיני רציף במקומם',                  severity_on_fail: 'blocker' },
        { key: 'bilge_dry',      name: 'בילג׳ יבש',                          severity_on_fail: 'advisory',
          requires_attrs: { has_bilge_pump: true },
          help: 'מים בבילג׳ אחרי הפלגה = דליפה. לבדוק מוצא.' },
      ],
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// SAILING YACHT  ·  pre / post (short trip)
// ═══════════════════════════════════════════════════════════════════════════

const SAILING_PRE_SHORT = {
  key: 'sailing_pre_short',
  name: 'לפני יציאה — מפרשית',
  phase: 'pre',
  applicable_boat_types: ['מפרשית'],
  sections: [
    {
      id: 'safety',
      name: 'בטיחות',
      items: [
        { key: 'life_jackets',   name: 'חגורות הצלה + רתמות לכולם',          severity_on_fail: 'blocker' },
        { key: 'harness_line',   name: 'חבל גרירה + רתמות במצב טוב',         severity_on_fail: 'blocker' },
        { key: 'flares_valid',   name: 'פירוטכניקה בתוקף',                    severity_on_fail: 'blocker' },
        { key: 'fire_ext',       name: 'מטף בתוך תוקף',                       severity_on_fail: 'blocker' },
        { key: 'mob_gear',       name: 'ציוד Man-Over-Board זמין',            severity_on_fail: 'advisory' },
        { key: 'life_raft',      name: 'רפסודת הצלה בתוך תוקף',                severity_on_fail: 'blocker' },
        { key: 'vhf_test',       name: 'VHF עובד',                             severity_on_fail: 'blocker',
          requires_attrs: { has_vhf: true } },
      ],
    },
    {
      id: 'weather',
      name: 'מזג אוויר',
      items: [
        { key: 'forecast_wind',  name: 'בדקתי תחזית רוח (מהירות + כיוון)',     severity_on_fail: 'blocker',
          help: 'מעל 30 קשר במפרש = שקול זיזוף דחוף או ביטול.' },
        { key: 'forecast_wave',  name: 'בדקתי תחזית גלים',                    severity_on_fail: 'blocker' },
        { key: 'tide_times',     name: 'בדקתי גאות/שפל',                      severity_on_fail: 'advisory' },
        { key: 'float_plan',     name: 'הודעתי למישהו על יעד וזמן חזרה',     severity_on_fail: 'advisory' },
      ],
    },
    {
      id: 'sails',
      name: 'מפרשים',
      items: [
        { key: 'main_hoist',     name: 'מפרש ראשי מוכן להרמה',                severity_on_fail: 'blocker',
          requires_attrs: { has_sails: true } },
        { key: 'main_inspect',   name: 'מפרש ראשי ללא קרעים',                 severity_on_fail: 'advisory',
          requires_attrs: { has_sails: true } },
        { key: 'jib_ready',      name: 'ג׳יב/גנואה מוכנים',                    severity_on_fail: 'advisory',
          requires_attrs: { has_sails: true } },
        { key: 'sheets_free',    name: 'חבלי שחרור ללא קשרים',                severity_on_fail: 'advisory',
          requires_attrs: { has_sails: true } },
        { key: 'halyards',       name: 'חבלי הרמה זמינים',                    severity_on_fail: 'advisory',
          requires_attrs: { has_sails: true } },
      ],
    },
    {
      id: 'rigging',
      name: 'תרן וציוד עליון',
      items: [
        { key: 'standing_visual', name: 'בדיקה ויזואלית של stays + shrouds',  severity_on_fail: 'advisory' },
        { key: 'boom_free',      name: 'בום זז חופשי ללא תקיעות',              severity_on_fail: 'advisory' },
        { key: 'winches',        name: 'ווינצ׳ים זזים חופשי',                  severity_on_fail: 'advisory' },
      ],
    },
    {
      id: 'engine',
      name: 'מנוע עזר',
      items: [
        { key: 'fuel_level',     name: 'דלק במנוע העזר',                       severity_on_fail: 'advisory',
          requires_attrs: { has_engine: true } },
        { key: 'oil_check',      name: 'מפלס שמן תקין',                        severity_on_fail: 'advisory',
          requires_attrs: { has_engine: true } },
        { key: 'engine_start',   name: 'מנוע עזר מניע',                        severity_on_fail: 'blocker',
          requires_attrs: { has_engine: true },
          help: 'מנוע עזר חיוני לכניסה/יציאה מהמרינה.' },
        { key: 'cooling_flow',   name: 'זרימת מי קירור',                       severity_on_fail: 'blocker',
          requires_attrs: { has_engine: true } },
      ],
    },
    {
      id: 'electrical',
      name: 'חשמל',
      items: [
        { key: 'battery_voltage', name: 'מצבר מעל 12.4V',                      severity_on_fail: 'advisory' },
        { key: 'nav_lights',     name: 'אורות ניווט עובדים',                   severity_on_fail: 'blocker' },
        { key: 'instruments',    name: 'מכשירים עובדים (GPS, מד רוח)',         severity_on_fail: 'advisory' },
        { key: 'bilge_pump',     name: 'משאבת בילג׳ עובדת',                    severity_on_fail: 'blocker',
          requires_attrs: { has_bilge_pump: true } },
      ],
    },
    {
      id: 'deck',
      name: 'סיפון ועגינה',
      items: [
        { key: 'anchor_ready',   name: 'עוגן + שרשרת זמינים',                  severity_on_fail: 'blocker' },
        { key: 'fenders',        name: 'מגיני רציף זמינים',                    severity_on_fail: 'advisory' },
        { key: 'hull_visual',    name: 'בדיקה ויזואלית של גוף הסירה',           severity_on_fail: 'blocker' },
      ],
    },
  ],
};

const SAILING_POST_SHORT = {
  key: 'sailing_post_short',
  name: 'חזרה לנמל — מפרשית',
  phase: 'post',
  applicable_boat_types: ['מפרשית'],
  sections: [
    {
      id: 'sails',
      name: 'מפרשים',
      items: [
        { key: 'main_flake',     name: 'מפרש ראשי מקופל/כרוך',                 severity_on_fail: 'log',
          requires_attrs: { has_sails: true } },
        { key: 'jib_furled',     name: 'ג׳יב/גנואה ארוזים',                    severity_on_fail: 'log',
          requires_attrs: { has_sails: true } },
        { key: 'sheets_stowed',  name: 'חבלים אוחסנו',                         severity_on_fail: 'log' },
        { key: 'sail_cover',     name: 'כיסוי מפרש (אם ארוך יותר מיום)',       severity_on_fail: 'log',
          requires_attrs: { has_sails: true } },
      ],
    },
    {
      id: 'shutdown',
      name: 'מנוע + חשמל',
      items: [
        { key: 'flush_engine',   name: 'שטיפת מנוע עזר במים מתוקים',           severity_on_fail: 'advisory',
          requires_attrs: { has_engine: true, water_type: 'sea' } },
        { key: 'battery_off',    name: 'מפסק מצבר כבוי',                       severity_on_fail: 'advisory' },
        { key: 'gas_off',        name: 'ברז גז סגור (אם יש)',                  severity_on_fail: 'blocker' },
      ],
    },
    {
      id: 'docking',
      name: 'עגינה',
      items: [
        { key: 'lines_secured',  name: 'חבלי עגינה קשורים (ראש + זנב + spring)', severity_on_fail: 'blocker' },
        { key: 'fenders_placed', name: 'מגיני רציף במקומם',                    severity_on_fail: 'blocker' },
        { key: 'bilge_dry',      name: 'בילג׳ יבש',                            severity_on_fail: 'advisory',
          requires_attrs: { has_bilge_pump: true } },
      ],
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// JET SKI  ·  pre / post
// ═══════════════════════════════════════════════════════════════════════════

const JETSKI_PRE_SHORT = {
  key: 'jetski_pre_short',
  name: 'לפני יציאה — אופנוע ים',
  phase: 'pre',
  applicable_boat_types: ['אופנוע ים'],
  sections: [
    {
      id: 'safety',
      name: 'בטיחות',
      items: [
        { key: 'life_jacket',    name: 'חגורת הצלה (חובה על הגוף)',            severity_on_fail: 'blocker' },
        { key: 'lanyard',        name: 'רצועת חירום מחוברת למפסק',             severity_on_fail: 'blocker' },
        { key: 'whistle',        name: 'משרוקית',                              severity_on_fail: 'advisory' },
      ],
    },
    {
      id: 'engine',
      name: 'מנוע ודלק',
      items: [
        { key: 'fuel_level',     name: 'דלק מלא או 3/4',                        severity_on_fail: 'blocker' },
        { key: 'oil_level',      name: 'מפלס שמן תקין (2-stroke)',              severity_on_fail: 'blocker' },
        { key: 'engine_start',   name: 'מנוע מניע',                             severity_on_fail: 'blocker' },
        { key: 'impeller_check', name: 'אין חפצים/אצות במשאבת הסילון',          severity_on_fail: 'blocker',
          help: 'חפץ זר = נזק למשאבה, סיכון לפריצה של צינור המים.' },
      ],
    },
    {
      id: 'weather',
      name: 'מזג אוויר',
      items: [
        { key: 'forecast_wind',  name: 'תחזית רוח מתאימה',                      severity_on_fail: 'blocker' },
        { key: 'forecast_wave',  name: 'גלים מתאימים לרמה שלי',                 severity_on_fail: 'blocker' },
      ],
    },
    {
      id: 'deck',
      name: 'מבנה',
      items: [
        { key: 'hull_visual',    name: 'בדיקה ויזואלית של גוף הסירה',            severity_on_fail: 'blocker' },
        { key: 'drain_plug',     name: 'פקקי ניקוז סגורים',                     severity_on_fail: 'blocker' },
      ],
    },
  ],
};

const JETSKI_POST_SHORT = {
  key: 'jetski_post_short',
  name: 'חזרה לנמל — אופנוע ים',
  phase: 'post',
  applicable_boat_types: ['אופנוע ים'],
  sections: [
    {
      id: 'shutdown',
      name: 'שטיפה וכיבוי',
      items: [
        { key: 'flush_cooling',  name: 'שטיפת מערכת קירור במים מתוקים (5 דקות)', severity_on_fail: 'advisory',
          help: 'קריטי להארכת חיי המנוע. 5 דקות לא מקוצרות.',
          requires_attrs: { water_type: 'sea' } },
        { key: 'wash_exterior',  name: 'שטיפת הגוף והמושב',                     severity_on_fail: 'log' },
        { key: 'dry_hull',       name: 'סירה יבשה',                              severity_on_fail: 'log' },
        { key: 'open_drain',     name: 'פקקי ניקוז פתוחים לאחסון',               severity_on_fail: 'advisory',
          help: 'אם נשארו מים הם יקפאו/יעמיסו בזמן האחסון.' },
      ],
    },
  ],
};

// ── Export registry ──────────────────────────────────────────────────────

export const SYSTEM_TEMPLATES = {
  motorboat_pre_short:  MOTORBOAT_PRE_SHORT,
  motorboat_post_short: MOTORBOAT_POST_SHORT,
  sailing_pre_short:    SAILING_PRE_SHORT,
  sailing_post_short:   SAILING_POST_SHORT,
  jetski_pre_short:     JETSKI_PRE_SHORT,
  jetski_post_short:    JETSKI_POST_SHORT,
};

// Pick the right template for a boat + phase.
// Boat types not covered fall back to motorboat.
export function pickTemplateForBoat(vehicle, phase = 'pre') {
  const type = vehicle?.vehicle_type || '';
  if (type === 'מפרשית')     return phase === 'pre' ? SAILING_PRE_SHORT : SAILING_POST_SHORT;
  if (type === 'אופנוע ים')  return phase === 'pre' ? JETSKI_PRE_SHORT  : JETSKI_POST_SHORT;
  // motorboat fallback (סירה מנועית, סירת גומי, anything else vessel-y)
  return phase === 'pre' ? MOTORBOAT_PRE_SHORT : MOTORBOAT_POST_SHORT;
}
