/**
 * Excel export for /MyExpenses — produces a 3-sheet xlsx file:
 *
 *   1. "הוצאות"            — full row list (date, vehicle, category, …)
 *   2. "סיכום לפי קטגוריה" — totals per category
 *   3. "סיכום לפי רכב"     — totals per vehicle (always rendered; in
 *                              single-vehicle mode it's just one row)
 *
 * Reads through fn_list_vehicle_expenses with a generous limit so the
 * whole filtered set lands in one call (PostgREST can return 10k rows
 * comfortably). For users with truly unbounded history we'd switch to
 * server-side cursor pagination, but the private-account use case is
 * dozens to low hundreds of rows per year.
 */
import { listVehicleExpenses } from './readExpenses';
import { getCategory } from './categories';

/** Format a date YYYY-MM-DD → DD/MM/YYYY (locale-friendly Hebrew). */
function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

const SOURCE_LABEL = {
  expense:     'הוצאה ידנית',
  ai_scan:     'נסרק מ-AI',
  maintenance: 'טיפול',
  repair:      'תיקון',
};

/**
 * Build a friendly file-name prefix from a period object.
 *   { type: 'year', year: 2026 }                → 'הוצאות-2026'
 *   { type: 'month', year: 2026, month: 5 }      → 'הוצאות-05-2026'
 *   { type: 'range', from: '...', to: '...' }    → 'הוצאות-2026-01-01_2026-04-30'
 */
function periodFilename(period) {
  if (!period) return 'הוצאות';
  if (period.type === 'year')  return `הוצאות-${period.year}`;
  if (period.type === 'month') return `הוצאות-${String(period.month).padStart(2, '0')}-${period.year}`;
  if (period.type === 'range') return `הוצאות-${period.from}_${period.to}`;
  return 'הוצאות';
}

/** A best-effort "vehicle label" — matches the picker text the user sees. */
function vehicleLabel(v) {
  if (!v) return 'רכב';
  return v.name
    || v.nickname
    || [v.manufacturer, v.model].filter(Boolean).join(' ')
    || v.license_plate
    || 'רכב';
}

/**
 * Run the export end-to-end. Fetches the data with the same filters the
 * UI is using, builds the workbook, and triggers a browser download.
 *
 * @param {object} args
 * @param {string}    args.accountId   required
 * @param {?string}   args.vehicleId   null = aggregate
 * @param {object}    args.period      same shape as PeriodFilter outputs
 * @param {string[]}  args.categories  optional category filter
 * @param {{from: string, to: string}} args.range  resolved range
 * @param {Array<{id, nickname?, manufacturer?, model?, license_plate?, vehicle_type?}>} args.vehicles
 *                  used to resolve vehicle names in the rows sheet when
 *                  the row has only vehicle_id.
 *
 * @returns {Promise<{ rowCount: number, filename: string }>}
 */
export async function exportExpensesXlsx({
  accountId,
  vehicleId,
  period,
  categories,
  range,
  vehicles = [],
}) {
  if (!accountId) throw new Error('exportExpensesXlsx: accountId required');
  if (!range?.from || !range?.to) throw new Error('exportExpensesXlsx: range required');

  // Lazy-load xlsx so the bundle doesn't pay for the dependency on the
  // first MyExpenses paint (only when the user actually exports).
  const XLSX = await import('xlsx');

  // Pull the full filtered set in one big page. 5000 is well above the
  // realistic ceiling for a private account; if a user genuinely has
  // more, the export still works — they just get the first 5000.
  const result = await listVehicleExpenses({
    accountId,
    vehicleId,
    from:       range.from,
    to:         range.to,
    categories: Array.isArray(categories) && categories.length ? categories : null,
    page:       0,
    pageSize:   5000,
  });

  const rows   = result.rows || [];
  const totals = result.totals || {};

  // Build a vehicle_id → label map. Prefer the by_vehicle entry from
  // totals (already has nickname / manufacturer / plate from the join),
  // then fall back to the page-level `vehicles` prop, then to a generic
  // 'רכב' label.
  const vehicleMap = new Map();
  Object.entries(totals.by_vehicle || {}).forEach(([id, info]) => {
    vehicleMap.set(id, info);
  });
  vehicles.forEach(v => {
    if (!vehicleMap.has(v.id)) {
      vehicleMap.set(v.id, {
        name: vehicleLabel(v),
        license_plate: v.license_plate,
        vehicle_type: v.vehicle_type,
      });
    }
  });

  // ── Sheet 1: rows ───────────────────────────────────────────────────
  const sheet1 = rows.map(r => {
    const cat = getCategory(r.category);
    const v   = vehicleMap.get(r.vehicle_id) || {};
    return {
      'תאריך':           fmtDate(r.expense_date),
      'רכב':             vehicleLabel(v),
      'מספר רישוי':      v.license_plate || '',
      'קטגוריה':         cat.label,
      'כותרת':           r.title  || '',
      'ספק':             r.vendor || '',
      'סכום (₪)':        Number(r.amount) || 0,
      'מקור':            SOURCE_LABEL[r.source_type] || r.source_type,
      'הערה':            r.note   || '',
      'יש חשבונית':      r.receipt_url ? 'כן' : 'לא',
    };
  });

  // Add a totals footer row to sheet 1 (visual cue + a row the user
  // can reference in their own pivot tables).
  if (sheet1.length > 0) {
    sheet1.push({
      'תאריך':      '',
      'רכב':        '',
      'מספר רישוי': '',
      'קטגוריה':    '',
      'כותרת':      '',
      'ספק':        'סה״כ',
      'סכום (₪)':   Number(totals.total) || 0,
      'מקור':       '',
      'הערה':       `${totals.count || 0} הוצאות`,
      'יש חשבונית': '',
    });
  }

  const ws1 = XLSX.utils.json_to_sheet(sheet1, { skipHeader: false });
  ws1['!cols'] = [
    { wch: 12 },  // תאריך
    { wch: 22 },  // רכב
    { wch: 12 },  // מספר רישוי
    { wch: 14 },  // קטגוריה
    { wch: 22 },  // כותרת
    { wch: 22 },  // ספק
    { wch: 12 },  // סכום
    { wch: 14 },  // מקור
    { wch: 36 },  // הערה
    { wch: 11 },  // יש חשבונית
  ];

  // ── Sheet 2: by category ────────────────────────────────────────────
  const totalAmount = Number(totals.total) || 0;
  const byCategoryRows = Object.entries(totals.by_category || {})
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map(([code, sum]) => {
      const cat = getCategory(code);
      const amt = Number(sum) || 0;
      const pct = totalAmount > 0 ? (amt / totalAmount) * 100 : 0;
      return {
        'קטגוריה': `${cat.emoji} ${cat.label}`,
        'סכום (₪)': amt,
        'אחוז':     `${pct.toFixed(1)}%`,
      };
    });
  if (byCategoryRows.length > 0) {
    byCategoryRows.push({
      'קטגוריה':  'סה״כ',
      'סכום (₪)': totalAmount,
      'אחוז':     '100.0%',
    });
  }
  const ws2 = XLSX.utils.json_to_sheet(byCategoryRows, { skipHeader: false });
  ws2['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 10 }];

  // ── Sheet 3: by vehicle ─────────────────────────────────────────────
  const byVehicleRows = Object.entries(totals.by_vehicle || {})
    .sort((a, b) => Number(b[1]?.total || 0) - Number(a[1]?.total || 0))
    .map(([vid, info]) => {
      const amt = Number(info?.total) || 0;
      const pct = totalAmount > 0 ? (amt / totalAmount) * 100 : 0;
      return {
        'רכב':            info?.name || vehicleLabel(vehicleMap.get(vid)),
        'מספר רישוי':     info?.license_plate || '',
        'מספר הוצאות':    Number(info?.count) || 0,
        'סכום (₪)':       amt,
        'אחוז':           `${pct.toFixed(1)}%`,
      };
    });
  if (byVehicleRows.length > 0) {
    byVehicleRows.push({
      'רכב':           'סה״כ',
      'מספר רישוי':    '',
      'מספר הוצאות':   Number(totals.count) || 0,
      'סכום (₪)':      totalAmount,
      'אחוז':          '100.0%',
    });
  }
  const ws3 = XLSX.utils.json_to_sheet(byVehicleRows, { skipHeader: false });
  ws3['!cols'] = [{ wch: 26 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }];

  // ── Workbook → download ─────────────────────────────────────────────
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, 'הוצאות');
  XLSX.utils.book_append_sheet(wb, ws2, 'סיכום לפי קטגוריה');
  XLSX.utils.book_append_sheet(wb, ws3, 'סיכום לפי רכב');

  const filename = `${periodFilename(period)}.xlsx`;
  XLSX.writeFile(wb, filename);

  return { rowCount: rows.length, filename };
}
