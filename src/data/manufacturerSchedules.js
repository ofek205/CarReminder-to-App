/**
 * Manufacturer maintenance schedules — Top 7 Israeli brands (v1).
 *
 * Data is hand-curated from publicly published owner's-manual maintenance
 * schedules. Each entry covers a model family + year range commonly sold
 * in Israel; the goal is ~70% fleet coverage with a small, auditable file.
 *
 * IMPORTANT — legal posture
 * -------------------------
 * The companion UI surfaces the global disclaimer  («המידע להתרשמות
 * בלבד … יש לבדוק את ספר הרכב המקורי»)  and a per-row source attribution
 * sourced from the `source` field below. Do NOT add a row to this file
 * without filling `source` — the legal cover depends on the user seeing
 * where each milestone came from.
 *
 * Shape
 * -----
 *   makes[]:
 *     make           — string, matches vehicle.manufacturer case-insensitive
 *     hebrewName     — display string for the UI (optional, falls back to make)
 *     models[]:
 *       model        — string, matched case-insensitive against vehicle.model
 *       aliases?     — alternate model names ("i20" matches "I20", "ניב")
 *       yearFrom     — inclusive
 *       yearTo       — inclusive
 *       fuelType?    — 'gasoline' | 'diesel' | 'hybrid' (omit = any)
 *       source       — Hebrew, used as the per-row attribution
 *       schedule[]:
 *         km            — milestone in km (required)
 *         months?       — alt milestone in months (display only — engine picks
 *                         whichever comes first; we surface both for clarity)
 *         service       — short code, used for grouping/icon ('oil',
 *                         'plugs', 'belt', 'brakes', 'fluid', 'filter',
 *                         'transmission', 'inspection')
 *         title         — short Hebrew title shown on the milestone row
 *         note?         — optional longer description shown under the title
 *
 * Maintenance intervals are conservative — when an OEM publishes a range
 * (e.g. "60–120k for iridium plugs") we pick the lower bound to avoid
 * under-reminding. Owners who service early at a dealer will see the
 * milestone before the dealer recommends it; that's fine. The other way
 * around (recommending too late) risks liability and a real-world
 * breakdown.
 */

export const MANUFACTURER_SCHEDULES = [
  // ── Toyota ──────────────────────────────────────────────────────────────
  {
    make: 'Toyota',
    hebrewName: 'טויוטה',
    models: [
      {
        model: 'Corolla',
        aliases: ['קורולה'],
        yearFrom: 2014,
        yearTo: 2019,
        source: 'ספר רכב Toyota Corolla 2014-2019 (דור E170)',
        schedule: [
          { km: 15000,  months: 12, service: 'oil',           title: 'החלפת שמן + פילטר',     note: 'שמן מנוע סינתטי + פילטר שמן' },
          { km: 30000,  service: 'filter',     title: 'החלפת פילטר אוויר ופילטר תא נוסעים' },
          { km: 40000,  service: 'fluid',      title: 'בדיקת נוזל בלמים והחלפה לפי הצורך' },
          { km: 60000,  service: 'plugs',      title: 'החלפת מצתי אירידיום',                  note: 'אינטרוול 60-120 אלף — נשמר על הצד הבטוח' },
          { km: 80000,  service: 'transmission', title: 'החלפת שמן תיבת הילוכים (CVT)' },
          { km: 100000, service: 'inspection', title: 'בדיקת שרשרת תזמון',                     note: 'שרשרת לכל החיים — בדיקת מתח ושחיקה' },
          { km: 120000, service: 'fluid',      title: 'החלפת נוזל קירור (חירוף ארוך טווח)' },
        ],
      },
      {
        model: 'Corolla',
        aliases: ['קורולה'],
        yearFrom: 2020,
        yearTo: 2025,
        source: 'ספר רכב Toyota Corolla 2020+ (היברידי + 1.8 גז)',
        schedule: [
          { km: 15000,  months: 12, service: 'oil',           title: 'החלפת שמן + פילטר' },
          { km: 30000,  service: 'filter',     title: 'פילטר אוויר ותא נוסעים' },
          { km: 60000,  service: 'plugs',      title: 'החלפת מצתי אירידיום' },
          { km: 90000,  service: 'transmission', title: 'החלפת שמן תיבה (אוטומטית / CVT)' },
          { km: 100000, service: 'inspection', title: 'בדיקת מערכת היברידית',                  note: 'בדיקת סוללת הביניים + הצנינה' },
          { km: 150000, service: 'fluid',      title: 'החלפת נוזל קירור היברידי' },
        ],
      },
      {
        model: 'RAV4',
        aliases: ['ראב', 'ראב 4'],
        yearFrom: 2013,
        yearTo: 2018,
        source: 'ספר רכב Toyota RAV4 דור XA40',
        schedule: [
          { km: 15000,  months: 12, service: 'oil',     title: 'החלפת שמן + פילטר' },
          { km: 30000,  service: 'filter',     title: 'פילטר אוויר, פילטר תא נוסעים' },
          { km: 40000,  service: 'fluid',      title: 'בדיקת נוזל בלמים' },
          { km: 60000,  service: 'plugs',      title: 'החלפת מצתים' },
          { km: 80000,  service: 'transmission', title: 'החלפת שמן תיבה אוטומטית' },
          { km: 100000, service: 'inspection', title: 'בדיקת שרשרת תזמון' },
        ],
      },
    ],
  },

  // ── Hyundai ─────────────────────────────────────────────────────────────
  {
    make: 'Hyundai',
    hebrewName: 'יונדאי',
    models: [
      {
        model: 'i20',
        aliases: ['ניב'],
        yearFrom: 2014,
        yearTo: 2019,
        source: 'ספר רכב Hyundai i20 דור שני (GB)',
        schedule: [
          { km: 15000,  months: 12, service: 'oil',     title: 'החלפת שמן + פילטר' },
          { km: 30000,  service: 'filter',     title: 'פילטר אוויר ותא נוסעים' },
          { km: 60000,  service: 'plugs',      title: 'החלפת מצתים',                            note: 'מצתים סטנדרטיים — אינטרוול 60K' },
          { km: 90000,  service: 'belt',       title: 'החלפת רצועת תזמון',                       note: 'הכרחי לדגמי 1.4 גז — בדיקה לפי דגם המנוע' },
          { km: 120000, service: 'transmission', title: 'החלפת שמן תיבה' },
        ],
      },
      {
        model: 'Tucson',
        aliases: ['טוסון'],
        yearFrom: 2015,
        yearTo: 2020,
        source: 'ספר רכב Hyundai Tucson TL (דור 3)',
        schedule: [
          { km: 15000,  months: 12, service: 'oil',     title: 'החלפת שמן + פילטר' },
          { km: 30000,  service: 'filter',     title: 'פילטרים: אוויר + תא נוסעים' },
          { km: 40000,  service: 'fluid',      title: 'בדיקת נוזל בלמים והחלפה לפי הצורך' },
          { km: 60000,  service: 'plugs',      title: 'החלפת מצתים' },
          { km: 90000,  service: 'belt',       title: 'בדיקת/החלפת רצועת תזמון',                  note: 'תלוי דגם מנוע — חלק מהדגמים עם שרשרת' },
          { km: 100000, service: 'transmission', title: 'החלפת שמן תיבה אוטומטית' },
        ],
      },
      {
        model: 'Ioniq',
        aliases: ['איוניק'],
        yearFrom: 2017,
        yearTo: 2022,
        source: 'ספר רכב Hyundai Ioniq היברידי/חשמלי',
        schedule: [
          { km: 15000,  months: 12, service: 'oil',     title: 'החלפת שמן + פילטר (היברידי בלבד)' },
          { km: 30000,  service: 'filter',     title: 'פילטר תא נוסעים' },
          { km: 60000,  service: 'inspection', title: 'בדיקת מערכת היברידית/חשמלית' },
          { km: 100000, service: 'transmission', title: 'החלפת שמן בתיבה (DCT — היברידי)' },
        ],
      },
    ],
  },

  // ── Kia ─────────────────────────────────────────────────────────────────
  {
    make: 'Kia',
    hebrewName: 'קיה',
    models: [
      {
        model: 'Picanto',
        aliases: ['פיקנטו'],
        yearFrom: 2017,
        yearTo: 2023,
        source: 'ספר רכב Kia Picanto JA',
        schedule: [
          { km: 15000,  months: 12, service: 'oil',     title: 'החלפת שמן + פילטר' },
          { km: 30000,  service: 'filter',     title: 'פילטר אוויר ותא נוסעים' },
          { km: 60000,  service: 'plugs',      title: 'החלפת מצתים' },
          { km: 90000,  service: 'belt',       title: 'בדיקת רצועת תזמון',                      note: 'בחלק מהדגמים שרשרת ולא רצועה' },
          { km: 120000, service: 'transmission', title: 'החלפת שמן תיבה אוטומטית' },
        ],
      },
      {
        model: 'Sportage',
        aliases: ['ספורטאז'],
        yearFrom: 2016,
        yearTo: 2021,
        source: 'ספר רכב Kia Sportage QL',
        schedule: [
          { km: 15000,  months: 12, service: 'oil',     title: 'החלפת שמן + פילטר' },
          { km: 30000,  service: 'filter',     title: 'פילטרים' },
          { km: 40000,  service: 'fluid',      title: 'נוזל בלמים — בדיקה' },
          { km: 60000,  service: 'plugs',      title: 'החלפת מצתים' },
          { km: 100000, service: 'transmission', title: 'החלפת שמן תיבה אוטומטית' },
        ],
      },
      {
        model: 'Niro',
        aliases: ['נירו'],
        yearFrom: 2017,
        yearTo: 2022,
        source: 'ספר רכב Kia Niro DE (היברידי / חשמלי)',
        schedule: [
          { km: 15000,  months: 12, service: 'oil',     title: 'החלפת שמן + פילטר (היברידי בלבד)' },
          { km: 30000,  service: 'filter',     title: 'פילטר תא נוסעים' },
          { km: 60000,  service: 'inspection', title: 'בדיקת מערכת היברידית' },
          { km: 100000, service: 'transmission', title: 'החלפת שמן בתיבה (DCT)' },
        ],
      },
    ],
  },

  // ── Mazda ───────────────────────────────────────────────────────────────
  {
    make: 'Mazda',
    hebrewName: 'מאזדה',
    models: [
      {
        model: '3',
        aliases: ['מאזדה 3', 'mazda3'],
        yearFrom: 2014,
        yearTo: 2019,
        source: 'ספר רכב Mazda 3 BM (SkyActiv-G)',
        schedule: [
          { km: 15000,  months: 12, service: 'oil',     title: 'החלפת שמן + פילטר',           note: 'שמן 0W-20 מסוג SkyActiv' },
          { km: 30000,  service: 'filter',     title: 'פילטר אוויר + תא נוסעים' },
          { km: 60000,  service: 'plugs',      title: 'החלפת מצתי NGK Iridium' },
          { km: 80000,  service: 'transmission', title: 'החלפת שמן תיבה אוטומטית 6 הילוכים' },
          { km: 100000, service: 'inspection', title: 'בדיקת שרשרת תזמון + סופרים' },
        ],
      },
      {
        model: 'CX-5',
        aliases: ['CX5', 'cx-5'],
        yearFrom: 2017,
        yearTo: 2022,
        source: 'ספר רכב Mazda CX-5 KF',
        schedule: [
          { km: 15000,  months: 12, service: 'oil',     title: 'החלפת שמן + פילטר' },
          { km: 30000,  service: 'filter',     title: 'פילטרים' },
          { km: 60000,  service: 'plugs',      title: 'החלפת מצתים' },
          { km: 90000,  service: 'transmission', title: 'החלפת שמן תיבה' },
        ],
      },
    ],
  },

  // ── Skoda ───────────────────────────────────────────────────────────────
  {
    make: 'Skoda',
    hebrewName: 'סקודה',
    models: [
      {
        model: 'Octavia',
        aliases: ['אוקטביה'],
        yearFrom: 2014,
        yearTo: 2020,
        source: 'ספר רכב Škoda Octavia A7 (5E)',
        schedule: [
          { km: 15000,  months: 12, service: 'oil',     title: 'החלפת שמן + פילטר' },
          { km: 30000,  service: 'filter',     title: 'פילטרים' },
          { km: 60000,  service: 'plugs',      title: 'החלפת מצתים — TSI' },
          { km: 90000,  service: 'belt',       title: 'בדיקת רצועת תזמון — דגמי 1.4 TSI',         note: 'דגמי DSG חדשים יותר עם שרשרת' },
          { km: 60000,  service: 'transmission', title: 'החלפת שמן DSG (תיבה 7DSG)',              note: 'אינטרוול קצוב — סוג שמן מיוחד DSG' },
          { km: 120000, service: 'fluid',      title: 'נוזל קירור G13 — החלפה לפי הצורך' },
        ],
      },
      {
        model: 'Karoq',
        aliases: ['קארוק'],
        yearFrom: 2018,
        yearTo: 2023,
        source: 'ספר רכב Škoda Karoq NU',
        schedule: [
          { km: 15000,  months: 12, service: 'oil',     title: 'החלפת שמן + פילטר' },
          { km: 30000,  service: 'filter',     title: 'פילטרים: אוויר ותא נוסעים' },
          { km: 60000,  service: 'plugs',      title: 'החלפת מצתים' },
          { km: 60000,  service: 'transmission', title: 'החלפת שמן DSG' },
        ],
      },
    ],
  },

  // ── Suzuki ──────────────────────────────────────────────────────────────
  {
    make: 'Suzuki',
    hebrewName: 'סוזוקי',
    models: [
      {
        model: 'Swift',
        aliases: ['סוויפט'],
        yearFrom: 2017,
        yearTo: 2023,
        source: 'ספר רכב Suzuki Swift דור 4 (AZ)',
        schedule: [
          { km: 15000,  months: 12, service: 'oil',     title: 'החלפת שמן + פילטר' },
          { km: 30000,  service: 'filter',     title: 'פילטר אוויר ותא נוסעים' },
          { km: 60000,  service: 'plugs',      title: 'החלפת מצתים' },
          { km: 100000, service: 'belt',       title: 'בדיקת/החלפת רצועת תזמון',                  note: 'בחלק מהדגמים שרשרת — תלוי במנוע' },
          { km: 90000,  service: 'transmission', title: 'החלפת שמן תיבה' },
        ],
      },
      {
        model: 'Baleno',
        aliases: ['בלנו'],
        yearFrom: 2016,
        yearTo: 2022,
        source: 'ספר רכב Suzuki Baleno',
        schedule: [
          { km: 15000,  months: 12, service: 'oil',     title: 'החלפת שמן + פילטר' },
          { km: 30000,  service: 'filter',     title: 'פילטרים' },
          { km: 60000,  service: 'plugs',      title: 'החלפת מצתים' },
          { km: 90000,  service: 'transmission', title: 'החלפת שמן תיבה' },
        ],
      },
    ],
  },

  // ── Mitsubishi ──────────────────────────────────────────────────────────
  {
    make: 'Mitsubishi',
    hebrewName: 'מיצובישי',
    models: [
      {
        model: 'Outlander',
        aliases: ['אאוטלנדר', 'אוטלנדר'],
        yearFrom: 2013,
        yearTo: 2021,
        source: 'ספר רכב Mitsubishi Outlander GF/GG (כולל PHEV)',
        schedule: [
          { km: 15000,  months: 12, service: 'oil',     title: 'החלפת שמן + פילטר (גז/דיזל)' },
          { km: 30000,  service: 'filter',     title: 'פילטר אוויר + תא נוסעים' },
          { km: 60000,  service: 'plugs',      title: 'החלפת מצתים — דגמי גז 2.0/2.4' },
          { km: 90000,  service: 'transmission', title: 'החלפת שמן CVT' },
          { km: 100000, service: 'inspection', title: 'בדיקת שרשרת תזמון' },
        ],
      },
      {
        model: 'ASX',
        aliases: ['אי אס איקס', 'asx'],
        yearFrom: 2015,
        yearTo: 2022,
        source: 'ספר רכב Mitsubishi ASX',
        schedule: [
          { km: 15000,  months: 12, service: 'oil',     title: 'החלפת שמן + פילטר' },
          { km: 30000,  service: 'filter',     title: 'פילטרים' },
          { km: 60000,  service: 'plugs',      title: 'החלפת מצתים' },
          { km: 90000,  service: 'transmission', title: 'החלפת שמן CVT' },
        ],
      },
    ],
  },
];

/**
 * Lookup a schedule for the given vehicle. Returns:
 *   { matched: ModelEntry, hebrewMakeName: string }
 * or null if no data is available for this vehicle. The caller is expected
 * to hide the feature entirely when this returns null — per the explicit
 * product decision "אם אין מידע, אל תציג כלום".
 *
 * Matching is intentionally tolerant:
 *   • make / model strings are normalised (trim + toLowerCase)
 *   • model accepts both the canonical name and any of its aliases
 *   • year must fall inside [yearFrom, yearTo] inclusive
 */
export function findManufacturerSchedule(vehicle) {
  if (!vehicle) return null;
  const make = String(vehicle.manufacturer || '').trim().toLowerCase();
  const model = String(vehicle.model || '').trim().toLowerCase();
  const year = Number(vehicle.year);
  if (!make || !model || !Number.isFinite(year)) return null;

  const makeEntry = MANUFACTURER_SCHEDULES.find(m => m.make.toLowerCase() === make);
  if (!makeEntry) return null;

  const modelEntry = makeEntry.models.find(mo => {
    const candidates = [mo.model, ...(mo.aliases || [])].map(s => s.toLowerCase());
    const matchModel = candidates.some(c => model === c || model.startsWith(c) || c.startsWith(model));
    const matchYear = year >= mo.yearFrom && year <= mo.yearTo;
    return matchModel && matchYear;
  });
  if (!modelEntry) return null;

  return {
    matched: modelEntry,
    hebrewMakeName: makeEntry.hebrewName || makeEntry.make,
  };
}

/**
 * Split a schedule into "upcoming" + "past" based on the vehicle's
 * current km. Past items are returned as well so the UI can collapse
 * them under "כבר עברתי", letting the owner mark progress mentally.
 */
export function splitScheduleByCurrentKm(schedule, currentKm) {
  if (!Array.isArray(schedule)) return { upcoming: [], past: [] };
  const km = Number(currentKm);
  if (!Number.isFinite(km)) return { upcoming: [...schedule], past: [] };
  const upcoming = [];
  const past = [];
  for (const item of [...schedule].sort((a, b) => a.km - b.km)) {
    if (item.km >= km) upcoming.push(item);
    else past.push(item);
  }
  return { upcoming, past };
}
