import { describe, it, expect } from 'vitest';
import { collectVehicleHistory } from './collectVehicleHistory';
import { renderHistoryXlsx } from './renderHistoryXlsx';

const vehicle = {
  license_plate: '12-345-67',
  manufacturer: 'טויוטה',
  model: 'קורולה',
  year: 2019,
  current_km: 84000,
};

async function readBack(history) {
  const out = await renderHistoryXlsx(history);
  const mod = await import('exceljs');
  const ExcelJS = mod.default ?? mod;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await out.blob.arrayBuffer());
  return { wb, out };
}

describe('renderHistoryXlsx', () => {
  it('produces one sheet per non-empty section, and none for the empty ones', async () => {
    const { wb } = await readBack(collectVehicleHistory({
      vehicle,
      logs: [{ type: 'תיקון', title: 'מצמד', date: '2026-01-01' }],
    }));
    expect(wb.worksheets.map(w => w.name)).toEqual(['תיקונים']);
  });

  it('opens every sheet right-to-left', async () => {
    const { wb } = await readBack(collectVehicleHistory({
      vehicle, logs: [{ type: 'טיפול', title: 'שמן', date: '2026-01-01' }],
    }));
    expect(wb.worksheets[0].views?.[0]?.rightToLeft).toBe(true);
  });

  it('writes dates as real Date cells so the sheet can be sorted', async () => {
    // A string date cannot be sorted or filtered, which is the whole reason
    // someone picks Excel over the PDF.
    const { wb } = await readBack(collectVehicleHistory({
      vehicle, logs: [{ type: 'טיפול', title: 'שמן', date: '2026-03-15' }],
    }));
    const ws = wb.getWorksheet('טיפולים');
    expect(ws.getRow(7).getCell(1).value).toBeInstanceOf(Date);
  });

  it('leaves an unparseable date as text rather than inventing 1970', async () => {
    const { wb } = await readBack(collectVehicleHistory({
      vehicle, logs: [{ type: 'טיפול', title: 'שמן', date: 'לא תאריך' }],
    }));
    expect(wb.getWorksheet('טיפולים').getRow(7).getCell(1).value).toBe('לא תאריך');
  });

  // ── security ───────────────────────────────────────────────────────────
  it('neutralises formula injection in a free-text field', async () => {
    // This file is handed to strangers. Excel runs a cell beginning with
    // = + - @ as a formula, and the title is user-supplied text.
    const { wb } = await readBack(collectVehicleHistory({
      vehicle,
      logs: [
        { type: 'טיפול', title: '=1+1', date: '2026-01-03' },
        { type: 'טיפול', title: '@SUM(A1)', date: '2026-01-02' },
        { type: 'טיפול', title: '+HYPERLINK("x")', date: '2026-01-01' },
      ],
    }));
    const ws = wb.getWorksheet('טיפולים');
    for (const r of [7, 8, 9]) {
      const title = ws.getRow(r).getCell(3).value;
      expect(String(title).startsWith("'")).toBe(true);
    }
  });

  it('leaves ordinary Hebrew text untouched', async () => {
    const { wb } = await readBack(collectVehicleHistory({
      vehicle, logs: [{ type: 'טיפול', title: 'החלפת שמן', date: '2026-01-01' }],
    }));
    expect(wb.getWorksheet('טיפולים').getRow(7).getCell(3).value).toBe('החלפת שמן');
  });

  it('never writes a workbook with zero sheets, which Excel cannot open', async () => {
    const { wb } = await readBack(collectVehicleHistory({ vehicle }));
    expect(wb.worksheets.length).toBeGreaterThan(0);
  });

  it('names the file with the plate and without Hebrew, so it survives travel', async () => {
    const { out } = await readBack(collectVehicleHistory({
      vehicle, logs: [{ type: 'טיפול', title: 'שמן', date: '2026-01-01' }],
    }));
    expect(out.fileName).toMatch(/^CarReminder-12-345-67-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(/[֐-׿]/.test(out.fileName)).toBe(false);
  });

  it('handles a large history without falling over', async () => {
    const logs = Array.from({ length: 2000 }, (_, i) => ({
      type: i % 3 === 0 ? 'תיקון' : 'טיפול',
      title: 'רשומה ' + i,
      date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      cost: i,
    }));
    const { out } = await readBack(collectVehicleHistory({ vehicle, logs }));
    expect(out.blob.size).toBeGreaterThan(1000);
  }, 30000);
});
