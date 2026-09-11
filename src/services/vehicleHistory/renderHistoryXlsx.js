/**
 * renderHistoryXlsx — turns a collectVehicleHistory() result into an .xlsx
 * workbook, one sheet per section.
 *
 * Follows the pattern already proven in src/pages/Reports.jsx (lazy
 * `import('exceljs')`, build, `writeBuffer()`), with two things that export
 * gets right and Reports does not:
 *
 *   1. `views: [{ rightToLeft: true }]`. Without it Excel opens a Hebrew
 *      sheet left-to-right, column A on the left, and every header reads
 *      backwards against the data under it.
 *   2. Real date cells rather than strings. A string date cannot be sorted
 *      or filtered, which is the entire reason someone asked for Excel
 *      rather than the PDF.
 *
 * Returns the blob rather than saving it. Saving is the caller's job so the
 * one place that knows about native-vs-web (and the share sheet that follows)
 * stays in one place.
 */

import { historyFileStem } from './collectVehicleHistory';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';


/**
 * Neutralise spreadsheet formula injection.
 *
 * This file is built to be handed to a stranger — a garage, a buyer, an
 * insurer — and Excel treats a cell whose text begins with = + - @ or a
 * control character as a formula, not as text. A service titled `=1+1` is
 * harmless; the same field is also where an attacker (or an imported row)
 * can put something that runs on the recipient's machine. Prefixing with an
 * apostrophe is the standard mitigation: Excel stores it as text and does
 * not display the apostrophe, so the reader sees exactly what was typed.
 *
 * Only strings are touched. Numbers and Dates must stay typed, or sorting
 * and filtering — the whole reason to choose Excel over the PDF — break.
 */
function sanitizeCell(value) {
  if (typeof value !== 'string') return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
/** ExcelJS writes a real date cell only for a Date object. Anything
 *  unparseable is passed through as-is rather than becoming 1970 or an
 *  Invalid Date, both of which look like data and are not. */
function dateCell(value) {
  if (!value) return '';
  const t = Date.parse(value);
  return Number.isNaN(t) ? value : new Date(t);
}

const SERVICE_COLUMNS = [
  { header: 'תאריך',    key: 'date',        width: 12, date: true },
  { header: 'סוג',      key: 'type',        width: 14 },
  { header: 'תיאור',    key: 'title',       width: 34 },
  { header: 'ק"מ',      key: 'km',          width: 10 },
  { header: 'מוסך',     key: 'garage',      width: 22 },
  { header: 'בוצע על ידי', key: 'performedBy', width: 18 },
  { header: 'עלות (₪)', key: 'cost',        width: 12 },
  { header: 'הערות',    key: 'notes',       width: 40 },
];

const ACCIDENT_COLUMNS = [
  { header: 'תאריך',        key: 'date',         width: 12, date: true },
  { header: 'מיקום',        key: 'location',     width: 28 },
  { header: 'סטטוס',        key: 'status',       width: 14 },
  { header: 'נהג נוסף',     key: 'otherName',    width: 20 },
  { header: 'רישוי נוסף',   key: 'otherPlate',   width: 14 },
  { header: 'חברת ביטוח',   key: 'otherInsurer', width: 22 },
];

/** The identity block that heads every sheet. Four labelled rows and a blank
 *  one, so a sheet that gets separated from its siblings still says which
 *  vehicle it belongs to. */
function writeIdentity(ws, identity) {
  if (!identity) return;
  const pairs = [
    ['מספר רישוי', identity.plate],
    ['רכב', [identity.manufacturer, identity.model, identity.year].filter(Boolean).join(' ')],
    // Double-quoted: the Hebrew word carries an apostrophe, which would
    // close a single-quoted string mid-word.
    ["קילומטראז' נוכחי", identity.currentKm ?? ''],
    ['תאריך הפקה', identity.exportedAt],
  ];
  for (const [label, value] of pairs) {
    const row = ws.addRow([label, sanitizeCell(value)]);
    row.getCell(1).font = { bold: true };
  }
  ws.addRow([]);
}

function writeTable(ws, columns, rows) {
  const header = ws.addRow(columns.map(c => sanitizeCell(c.header)));
  header.font = { bold: true };
  for (const row of rows) {
    ws.addRow(columns.map(c => (c.date ? dateCell(row[c.key]) : sanitizeCell(row[c.key] ?? ''))));
  }
  columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });
}

function addSection(wb, title, columns, rows, identity) {
  const ws = wb.addWorksheet(title);
  // Must be set before rows are added for Excel to honour it on open.
  ws.views = [{ rightToLeft: true }];
  writeIdentity(ws, identity);
  writeTable(ws, columns, rows);
  return ws;
}

/**
 * @param {object} history  a collectVehicleHistory() result
 * @returns {Promise<{ blob: Blob, fileName: string, mimeType: string }>}
 */
export async function renderHistoryXlsx(history) {
  // exceljs is CommonJS. Vite's interop hangs the namespace off the module
  // object directly, Node's ESM loader puts it under `.default`. Reports.jsx
  // only ever runs in a browser so it gets away with the former; accepting
  // both means this module can be unit-tested outside a bundler, which is
  // exactly how the "not a constructor" failure surfaced.
  const mod = await import('exceljs');
  const ExcelJS = mod.default ?? mod;
  const wb = new ExcelJS.Workbook();
  const { identity, services, repairs, accidents } = history;

  // A sheet is added only when it has rows. An empty "תאונות" tab reads as
  // "we could not load your accidents" rather than "you have none".
  if (services.length)  addSection(wb, 'טיפולים',  SERVICE_COLUMNS,  services,  identity);
  if (repairs.length)   addSection(wb, 'תיקונים',  SERVICE_COLUMNS,  repairs,   identity);
  if (accidents.length) addSection(wb, 'תאונות',   ACCIDENT_COLUMNS, accidents, identity);

  // Excel refuses to open a workbook containing no worksheets. The button
  // is hidden when there is no history so this should be unreachable, but a
  // file that cannot be opened is a worse failure than an empty sheet, and
  // the guard costs nothing.
  if (wb.worksheets.length === 0) addSection(wb, 'היסטוריה', SERVICE_COLUMNS, [], identity);

  const buffer = await wb.xlsx.writeBuffer();
  return {
    blob: new Blob([buffer], { type: XLSX_MIME }),
    fileName: `${historyFileStem(identity)}.xlsx`,
    mimeType: XLSX_MIME,
  };
}
