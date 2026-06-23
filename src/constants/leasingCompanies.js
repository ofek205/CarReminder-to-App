// Major Israeli leasing / long-term-rental companies, used by the vehicle
// leasing-company picker. The picker also offers an "אחר" (other) option
// that lets the user type any company not listed here.
//
// Kept as a plain constant (not a DB table) for the first version — the
// list changes rarely and "אחר" covers anything missing. If it needs to
// become editable from the admin UI later, migrate to a table then.
export const LEASING_COMPANIES = [
  'אלבר',
  'שלמה SIXT',
  'אלדן',
  'קל אוטו',
  'הרץ',
  'בדג׳ט',
  'אופרייט',
  'ליס פלן',
  'UMI',
  'קרסו',
];

// Known spelling variants → the canonical name in LEASING_COMPANIES above.
// Free-text leasing values (mostly from bulk-import files: "שלמה סיקסט",
// "sixt", "אלבר בע\"מ") get snapped to the canonical spelling so the fleet
// filter groups them as ONE company instead of several near-duplicate
// buckets. Anything not matched is kept exactly as typed (a genuine "other"
// company the user can still filter by).
export const LEASING_ALIASES = {
  'אלבר':      ['albar', 'אלבר השכרת רכב'],
  'שלמה SIXT': ['שלמה סיקסט', 'שלמה סיקס', 'סיקסט', 'sixt', 'shlomo sixt', 'שלמה רכב'],
  'אלדן':      ['eldan', 'אלדן השכרת רכב'],
  'קל אוטו':   ['avis', 'קל-אוטו', 'קל אוטו avis', 'kal auto'],
  'הרץ':       ['hertz'],
  'בדג׳ט':     ["בדג'ט", 'בדגט', 'budget'],
  'אופרייט':   ['operate', 'אופרייט ליסינג', 'אופרט'],
  'ליס פלן':   ['ליספלן', 'ליס פלאן', 'leaseplan', 'lease plan'],
  'UMI':       ['יו אם איי', 'יו.אם.איי', 'יוניברסל מוטורס', 'universal motors', 'umi'],
  'קרסו':      ['carasso', 'קרסו מוטורס'],
};

// Normalize a company string for matching: lowercase, drop spaces and
// punctuation, then strip the common "בע\"מ" / "ltd" company suffixes.
function normKey(s) {
  let v = String(s).toLowerCase().replace(/[\s\-.,'"״׳()]/g, '');
  v = v.replace(/בעמ$/, '');          // trailing בע"מ
  v = v.replace(/(ltd|inc|llc)$/, ''); // trailing ltd/inc/llc
  return v;
}

// normalized-variant → canonical name. Built once at module load.
const _aliasIndex = (() => {
  const m = {};
  for (const canon of LEASING_COMPANIES) m[normKey(canon)] = canon;
  for (const [canon, aliases] of Object.entries(LEASING_ALIASES)) {
    for (const a of aliases) m[normKey(a)] = canon;
  }
  return m;
})();

// Snap a free-text leasing-company value to its canonical spelling.
// Unknown values are returned trimmed-as-is (kept as a real "other").
export function canonicalizeLeasingCompany(raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  return _aliasIndex[normKey(v)] || v;
}

// MoT ownership (baalut) values that indicate the vehicle is leased/rented,
// so the form can auto-highlight the leasing-company field. The registry
// uses a few wordings; match on substring to be resilient.
export function isLeasingOwnership(ownership) {
  if (!ownership) return false;
  const s = String(ownership);
  return s.includes('ליסינג') || s.includes('השכרה') || s.includes('החכרה');
}
