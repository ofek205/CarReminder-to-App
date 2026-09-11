/**
 * ExportHistorySheet — pick a format, get a file, send it on.
 *
 * Two taps and no form. The sheet exists only to make the format choice
 * instant; everything else happens without asking.
 */
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { FileText, Table2, Loader2, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { C } from '@/lib/designTokens';
import { collectVehicleHistory, historyFileStem } from '@/services/vehicleHistory/collectVehicleHistory';
import { deliverFile } from '@/services/vehicleHistory/deliverFile';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/supabaseQuery';
import useAccountRole from '@/hooks/useAccountRole';

export default function ExportHistorySheet({ open, onOpenChange, vehicle, logs = [] }) {
  const { accountId } = useAccountRole();
  const [busy, setBusy] = useState(null);       // 'pdf' | 'xlsx' | null
  const [slow, setSlow] = useState(false);      // true once the wait is worth acknowledging
  const [offline, setOffline] = useState(!navigator.onLine);
  const docRef = useRef(null);

  // Filtered by vehicle SERVER-side. The Accidents page fetches account-wide
  // and sharing its cache was tempting, but that list is capped: a capped
  // account-wide list narrowed afterwards can drop this vehicle's older
  // accidents with nobody noticing, in a file made to be handed to a buyer.
  // Correctness beats the shared cache.
  const { data: accidents = [] } = useQuery({
    queryKey: ['accidents-for-vehicle', vehicle?.id],
    enabled: !!open && !!accountId && !!vehicle?.id,
    queryFn: async () => {
      const { data, error } = await withTimeout(
        supabase.from('accidents')
          .select('id,date,location,status,other_driver_name,other_driver_plate,other_driver_insurance_company')
          .eq('account_id', accountId)
          .eq('vehicle_id', vehicle.id)
          .order('date', { ascending: false }),
        'accidents_for_export',
      );
      if (error) throw error;
      return data || [];
    },
  });

  const history = useMemo(
    () => collectVehicleHistory({ vehicle, logs, accidents }),
    [vehicle, logs, accidents],
  );

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // Start pulling the heavy libraries the moment the sheet opens, while the
  // user is still reading the two options. `copywriter` flagged that words
  // were being asked to paper over a real wait: first use lazy-loads ~940KB
  // for Excel and the jsPDF/html2canvas pair for PDF. Prefetching moves that
  // wait to BEFORE the tap instead of after it, so most of the time it is
  // already finished by the time a format is chosen. Failures are ignored on
  // purpose — this is an optimisation, and the real import still runs later.
  useEffect(() => {
    if (!open) return;
    import('exceljs').catch(() => {});
    import('@/lib/pdfExport').catch(() => {});
  }, [open]);

  // "Preparing" becomes "just a moment" only after the wait is long enough to
  // notice. Saying it immediately would make a fast export feel slow.
  useEffect(() => {
    if (!busy) { setSlow(false); return undefined; }
    const t = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(t);
  }, [busy]);

  async function runExport(kind) {
    if (busy) return;
    setBusy(kind);
    try {
      if (kind === 'xlsx') {
        const { renderHistoryXlsx } = await import('@/services/vehicleHistory/renderHistoryXlsx');
        const { blob, fileName } = await renderHistoryXlsx(history);
        const how = await deliverFile({ blob, fileName, dialogTitle: 'שליחת היסטוריית הרכב' });
        if (how === 'saved') toast.success('הקובץ נשמר במכשיר, בתיקיית המסמכים');
        else if (how === 'downloaded') toast.success('הקובץ ירד');
      } else {
        const { exportElementToPdf } = await import('@/lib/pdfExport');
        // exportElementToPdf handles saving and the native share sheet
        // itself, so the PDF path deliberately does NOT go through
        // deliverFile. Reusing it is worth the small asymmetry: it already
        // solves Hebrew and RTL by rasterising real DOM, which is the part
        // that is genuinely hard to get right.
        const ok = await exportElementToPdf(docRef.current, historyFileStem(history.identity));
        if (!ok) toast.error('יצירת הקובץ נכשלה. נסה שוב.');
      }
      onOpenChange?.(false);
    } catch (err) {
      console.error('history export failed:', err);
      const permissionish = /permission|denied|quota/i.test(String(err?.message || ''));
      toast.error(permissionish
        ? 'לא הצלחנו לשמור את הקובץ. בדוק שלאפליקציה יש הרשאת אחסון בהגדרות המכשיר.'
        : 'יצירת הקובץ נכשלה. נסה שוב.');
    } finally {
      setBusy(null);
    }
  }

  const Option = ({ kind, icon: Icon, label, hint }) => (
    <button
      type="button"
      onClick={() => runExport(kind)}
      disabled={!!busy}
      className="w-full flex items-center gap-3 p-4 rounded-2xl text-right transition-all active:scale-[0.99] disabled:opacity-60"
      style={{ background: '#fff', border: `1.5px solid ${C.border}` }}
    >
      <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: C.light, color: C.primary }}>
        {busy === kind ? <Loader2 className="w-5 h-5 animate-spin" /> : <Icon className="w-5 h-5" />}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] font-bold" style={{ color: C.text }}>{label}</span>
        <span className="block text-[12px]" style={{ color: C.muted }}>
          {busy === kind ? (slow ? 'עוד רגע, מכין את הקובץ' : 'מכין את הקובץ...') : hint}
        </span>
      </span>
    </button>
  );

  return (
    <>
      <Sheet open={open} onOpenChange={(v) => { if (!busy) onOpenChange?.(v); }}>
        <SheetContent side="bottom" dir="rtl" className="rounded-t-3xl">
          <SheetHeader className="text-right">
            <SheetTitle className="text-right">ייצוא היסטוריית הרכב</SheetTitle>
            <p className="text-[13px]" style={{ color: C.muted }}>
              טיפולים, תיקונים ותאונות, כולל עלויות ופרטי הרכב
            </p>
          </SheetHeader>

          <div className="mt-4 space-y-2.5 pb-2">
            <Option kind="pdf"  icon={FileText} label="PDF"   hint="לצפייה ולשליחה בוואטסאפ" />
            <Option kind="xlsx" icon={Table2}   label="Excel" hint="לעיבוד וסינון של הנתונים" />
          </div>

          {offline && (
            <p className="flex items-start gap-2 text-[12px] pb-4" style={{ color: C.muted }}>
              <WifiOff className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              אפשר להכין את הקובץ גם בלי חיבור. קבצים מצורפים לא ייכללו.
            </p>
          )}
        </SheetContent>
      </Sheet>

      {/* The PDF is produced by rasterising real DOM (see pdfExport.js), which
          is what makes Hebrew and RTL work without embedding a font. The node
          must be laid out for real, so it is positioned off-screen rather
          than hidden with display:none, which would give html2canvas nothing
          to measure. */}
      {/* Mounted only while the sheet is open. Left permanent it built a
          full table of every log on every visit to every vehicle page,
          for a document nobody had asked for yet. */}
      {open && (
      <div style={{ position: 'fixed', left: '-10000px', top: 0, width: '794px' }} aria-hidden="true">
        <div ref={docRef} dir="rtl" style={{ background: '#fff', padding: 24, fontFamily: 'inherit' }}>
          <HistoryDocument history={history} />
        </div>
      </div>
      )}
    </>
  );
}

/** The printable document. Plain tables on white — this is read on a phone
 *  and often printed, so it is deliberately unstyled beyond what aids
 *  scanning. */
function HistoryDocument({ history }) {
  const { identity, services, repairs, accidents } = history;
  const money = (v) => (v == null || v === '' ? '' : `${Number(v).toLocaleString('he-IL')} ₪`);

  const Table = ({ title, rows, columns }) => {
    if (!rows.length) return null;
    return (
      <section style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 6px' }}>{title} ({rows.length})</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr>
              {columns.map(c => (
                <th key={c.key} style={{ textAlign: 'right', borderBottom: '1.5px solid #333', padding: '4px 6px', whiteSpace: 'nowrap' }}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ background: i % 2 ? '#fafafa' : '#fff' }}>
                {columns.map(c => (
                  <td key={c.key} style={{ borderBottom: '1px solid #eee', padding: '4px 6px', verticalAlign: 'top' }}>
                    {c.render ? c.render(r[c.key]) : (r[c.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  };

  const serviceCols = [
    { key: 'date',  header: 'תאריך' },
    { key: 'title', header: 'תיאור' },
    { key: 'km',    header: 'ק"מ' },
    { key: 'garage', header: 'מוסך' },
    { key: 'cost',  header: 'עלות', render: money },
    { key: 'notes', header: 'הערות' },
  ];
  const accidentCols = [
    { key: 'date',       header: 'תאריך' },
    { key: 'location',   header: 'מיקום' },
    { key: 'status',     header: 'סטטוס' },
    { key: 'otherPlate', header: 'רישוי נוסף' },
  ];

  return (
    <div>
      <h1 style={{ fontSize: 19, fontWeight: 800, margin: 0 }}>היסטוריית הרכב</h1>
      {identity && (
        <div style={{ fontSize: 12, color: '#444', marginTop: 4, lineHeight: 1.6 }}>
          <div>
            <strong>מספר רישוי:</strong>{' '}
            <span dir="ltr">{identity.plate}</span>
          </div>
          <div>
            <strong>רכב:</strong>{' '}
            {[identity.manufacturer, identity.model, identity.year].filter(Boolean).join(' ')}
          </div>
          {identity.currentKm != null && (
            <div><strong>קילומטראז&#39;:</strong> <span dir="ltr">{Number(identity.currentKm).toLocaleString('he-IL')}</span></div>
          )}
          <div><strong>תאריך הפקה:</strong> <span dir="ltr">{identity.exportedAt}</span></div>
        </div>
      )}
      <Table title="טיפולים" rows={services}  columns={serviceCols} />
      <Table title="תיקונים" rows={repairs}   columns={serviceCols} />
      <Table title="תאונות"  rows={accidents} columns={accidentCols} />
    </div>
  );
}
