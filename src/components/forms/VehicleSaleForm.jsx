import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Info, Loader2, Eye } from 'lucide-react';
import { db } from '@/lib/supabaseEntities';
import { useAuth } from '@/components/shared/GuestContext';
import useAccountRole from '@/hooks/useAccountRole';
import { C } from '@/lib/designTokens';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateInput } from '@/components/ui/date-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { isValidIsraeliId, normalizeId } from '@/lib/forms/israeliId';
import { numberToHebrewWords } from '@/lib/forms/hebrewNumber';
import { readSavedId, writeSavedId } from '@/lib/forms/savedId';
import FormPreviewModal from './FormPreviewModal';
import VehicleSaleDocument from './VehicleSaleDocument';
import SignaturePad from './SignaturePad';
import { shortFingerprint, canonicalize } from '@/lib/forms/docHash';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
const onlyDigits = (v) => String(v).replace(/\D/g, '');

function SectionCard({ title, hint, children }) {
  return (
    <div className="rounded-3xl border p-4" style={{ borderColor: C.border, background: C.card }}>
      <p className="text-sm font-bold mb-1" style={{ color: C.text }}>{title}</p>
      {hint && <p className="text-[12px] mb-3" style={{ color: C.muted }}>{hint}</p>}
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, required, children, error, warning }) {
  return (
    <div>
      <Label className="text-right block mb-1.5 text-sm">
        {label}{required && <span className="mr-1" style={{ color: C.error }}>*</span>}
      </Label>
      {children}
      {error
        ? <p className="text-[11px] mt-1" style={{ color: C.error }}>{error}</p>
        : warning ? <p className="text-[11px] mt-1" style={{ color: C.warn }}>{warning}</p> : null}
    </div>
  );
}

export default function VehicleSaleForm() {
  const { user } = useAuth();
  const { accountId } = useAccountRole();

  const {
    data: vehicles = [],
    isLoading: vehiclesLoading,
    isError: vehiclesError,
    refetch: refetchVehicles,
  } = useQuery({
    queryKey: ['sale-vehicles', accountId],
    // db.vehicles.filter already applies withTimeout internally and returns
    // the rows array (throwing on error) — call it directly.
    queryFn: () => db.vehicles.filter({ account_id: accountId }, { light: true }),
    enabled: !!accountId,
    retry: 1,
    retryDelay: 500,
  });

  const [vehicleId, setVehicleId] = useState('');
  const [vehicle, setVehicle] = useState({ type: '', manufacturer: '', model: '', plate: '', year: '' });
  const [seller, setSeller] = useState({ name: '', id: '', address: '', phone: '' });
  const [buyer, setBuyer] = useState({ name: '', id: '', address: '', phone: '' });
  const [price, setPrice] = useState({ total: '', totalWords: '', down: '', downWords: '', balanceDate: '' });
  const [condition, setCondition] = useState({ km: '', ownership: '', hands: '', hadAccident: false });
  const [date, setDate] = useState(todayISO());
  const [saveMyId, setSaveMyId] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showSample, setShowSample] = useState(false);
  const [signatures, setSignatures] = useState({ seller: null, buyer: null });
  const [signingParty, setSigningParty] = useState(null);
  const [signConsent, setSignConsent] = useState(false);

  // Prefill the seller (the user is selling their own vehicle by default).
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (prefilledRef.current || !user) return;
    const savedId = readSavedId(user.id);
    setSeller((s) => ({ ...s, name: user.full_name || '', id: savedId }));
    if (savedId) setSaveMyId(true);
    prefilledRef.current = true;
  }, [user]);

  const onPickVehicle = (id) => {
    setVehicleId(id);
    const v = vehicles.find((x) => x.id === id);
    if (!v) return;
    setVehicle({
      type: v.vehicle_type || '',
      manufacturer: v.manufacturer || '',
      model: v.model || '',
      plate: v.license_plate || '',
      year: v.year ? String(v.year) : '',
    });
    setCondition((c) => ({
      ...c,
      km: v.current_km ? String(v.current_km) : c.km,
      ownership: v.ownership || c.ownership,
      hands: v.ownership_hand ? String(v.ownership_hand) : c.hands,
    }));
  };

  // Derived balance + auto words.
  const totalN = Number(onlyDigits(price.total)) || 0;
  const downN = Number(onlyDigits(price.down)) || 0;
  const balance = Math.max(0, totalN - downN);
  const balanceWords = numberToHebrewWords(balance);
  // Safety warnings (non-blocking): same ID on both parties, down > total.
  const samePartyId = !!(normalizeId(seller.id) && normalizeId(seller.id) === normalizeId(buyer.id));
  const downExceeds = totalN > 0 && downN > totalN;

  const setTotal = (raw) => {
    const v = onlyDigits(raw);
    setPrice((p) => ({ ...p, total: v, totalWords: numberToHebrewWords(v) }));
  };
  const setDown = (raw) => {
    const v = onlyDigits(raw);
    setPrice((p) => ({ ...p, down: v, downWords: numberToHebrewWords(v) }));
  };

  // ת.ז policy: empty (required) ID blocks; a filled-in ID that fails the
  // checksum only WARNS (self-fill document — flag a likely typo without
  // blocking generation).
  const idEmpty = (raw) => normalizeId(raw).length === 0;
  const idBlockError = (raw, required) =>
    (required && submitAttempted && idEmpty(raw)) ? 'יש להזין מספר ת.ז' : '';
  const idWarn = (raw) => {
    const d = normalizeId(raw);
    if (d.length === 0) return '';
    if (d.length < 9) return 'מספר ת.ז קצר מ-9 ספרות — בדוק';
    if (!isValidIsraeliId(d)) return 'מספר ת.ז אינו תקין — בדוק את הספרות';
    return '';
  };

  const problems = useMemo(() => {
    const p = [];
    if (!vehicle.plate.trim()) p.push('מספר רישוי');
    if (!seller.name.trim()) p.push('שם המוכר');
    if (idEmpty(seller.id)) p.push('ת.ז המוכר');
    if (!buyer.name.trim()) p.push('שם הקונה');
    if (idEmpty(buyer.id)) p.push('ת.ז הקונה');
    if (!(totalN > 0)) p.push('מחיר הרכב');
    if (!date) p.push('תאריך החוזה');
    return p;
  }, [vehicle.plate, seller.name, seller.id, buyer.name, buyer.id, totalN, date]);
  const valid = problems.length === 0;

  const docData = useMemo(() => ({
    vehicle,
    seller,
    buyer,
    price: { ...price, balance, balanceWords },
    condition,
    date,
    signatures,
  }), [vehicle, seller, buyer, price, balance, balanceWords, condition, date, signatures]);

  // Capture an electronic signature for a party. We stamp the moment of
  // signing + a content fingerprint (hash over the document minus the
  // signatures) so the signature is tied to exactly what was on the page.
  const captureSignature = async (dataUrl) => {
    const party = signingParty;
    if (!party) return;
    const who = party === 'seller' ? seller : buyer;
    let hash = '';
    try { hash = await shortFingerprint(canonicalize(docData)); } catch { /* fingerprint is best-effort */ }
    setSignatures((s) => ({
      ...s,
      [party]: { dataUrl, name: who.name, id: who.id, ts: new Date().toISOString(), hash },
    }));
    setSigningParty(null);
  };

  const handleSubmit = () => {
    if (!valid) {
      setSubmitAttempted(true);
      toast.error('חסר למילוי: ' + problems.join(', '));
      return;
    }
    if (user) writeSavedId(user.id, saveMyId && isValidIsraeliId(seller.id) ? normalizeId(seller.id) : '');
    setShowPreview(true);
  };

  const hasVehicles = vehicles.length > 0;

  return (
    <div className="pb-28">
      <p className="text-[12px] mb-3 rounded-2xl p-3" style={{ background: C.light, color: C.primary }}>
        ברירת מחדל: אתה המוכר. הפרטים שלך ושל הרכב מולאו מראש — ניתן לערוך הכל.
      </p>

      <button type="button" onClick={() => setShowSample(true)}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-bold" style={{ color: C.primary }}>
        <Eye className="h-4 w-4" /> צפה בדוגמה ריקה של הטופס
      </button>

      <div className="space-y-4">
        {/* Vehicle */}
        <SectionCard title="הרכב" hint="בחר רכב מהחשבון למילוי אוטומטי, או הזן ידנית.">
          {vehiclesLoading ? (
            <div className="flex items-center gap-2 text-sm" style={{ color: C.muted }}>
              <Loader2 className="h-4 w-4 animate-spin" /> טוען רכבים…
            </div>
          ) : vehiclesError ? (
            <div className="rounded-2xl p-3 text-sm flex items-center justify-between" style={{ background: C.errorBg, color: C.errorDark }}>
              <span>שגיאה בטעינת הרכבים</span>
              <button type="button" onClick={() => refetchVehicles()} className="font-bold underline">נסה שוב</button>
            </div>
          ) : hasVehicles ? (
            <Select value={vehicleId} onValueChange={onPickVehicle}>
              <SelectTrigger dir="rtl"><SelectValue placeholder="בחר רכב למילוי אוטומטי" /></SelectTrigger>
              <SelectContent>
                {vehicles.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {(v.nickname || `${v.manufacturer || ''} ${v.model || ''}`).trim() || 'רכב'}{v.license_plate ? ` · ${v.license_plate}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <Field label="מספר רישוי" required error={submitAttempted && !vehicle.plate.trim() ? 'שדה חובה' : ''}>
              <Input dir="ltr" inputMode="numeric" value={vehicle.plate}
                onChange={(e) => setVehicle((v) => ({ ...v, plate: e.target.value }))}
                className="text-left tabular-nums" />
            </Field>
            <Field label="שנת ייצור">
              <Input dir="ltr" inputMode="numeric" maxLength={4} value={vehicle.year}
                onChange={(e) => setVehicle((v) => ({ ...v, year: onlyDigits(e.target.value) }))}
                className="text-left tabular-nums" />
            </Field>
            <Field label="תוצרת">
              <Input dir="rtl" value={vehicle.manufacturer} onChange={(e) => setVehicle((v) => ({ ...v, manufacturer: e.target.value }))} />
            </Field>
            <Field label="דגם">
              <Input dir="rtl" value={vehicle.model} onChange={(e) => setVehicle((v) => ({ ...v, model: e.target.value }))} />
            </Field>
            <Field label="סוג הרכב">
              <Input dir="rtl" value={vehicle.type} onChange={(e) => setVehicle((v) => ({ ...v, type: e.target.value }))} />
            </Field>
          </div>
        </SectionCard>

        {/* Seller */}
        <SectionCard title="המוכר" hint="הפרטים שלך — מולאו מראש.">
          <Field label="שם מלא" required error={submitAttempted && !seller.name.trim() ? 'יש להזין שם' : ''}>
            <Input dir="rtl" value={seller.name} onChange={(e) => setSeller((s) => ({ ...s, name: e.target.value }))} />
          </Field>
          <Field label="ת.ז" required error={idBlockError(seller.id, true)} warning={idWarn(seller.id)}>
            <Input dir="ltr" inputMode="numeric" maxLength={9} value={seller.id}
              onChange={(e) => setSeller((s) => ({ ...s, id: normalizeId(e.target.value) }))} className="text-left tabular-nums" />
          </Field>
          <label className="flex items-center gap-2 text-[12px] cursor-pointer" style={{ color: C.text }}>
            <input type="checkbox" checked={saveMyId} onChange={(e) => setSaveMyId(e.target.checked)} />
            שמור את ה-ת.ז שלי במכשיר לפעם הבאה
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Field label="כתובת"><Input dir="rtl" value={seller.address} onChange={(e) => setSeller((s) => ({ ...s, address: e.target.value }))} /></Field>
            <Field label="טלפון"><Input dir="ltr" inputMode="tel" value={seller.phone} onChange={(e) => setSeller((s) => ({ ...s, phone: e.target.value }))} className="text-left" /></Field>
          </div>
        </SectionCard>

        {/* Buyer */}
        <SectionCard title="הקונה" hint="פרטי רוכש הרכב.">
          <Field label="שם מלא" required error={submitAttempted && !buyer.name.trim() ? 'יש להזין שם' : ''}>
            <Input dir="rtl" value={buyer.name} onChange={(e) => setBuyer((b) => ({ ...b, name: e.target.value }))} />
          </Field>
          <Field label="ת.ז" required error={idBlockError(buyer.id, true)} warning={idWarn(buyer.id) || (samePartyId ? 'ת.ז המוכר והקונה זהים — בדוק' : '')}>
            <Input dir="ltr" inputMode="numeric" maxLength={9} value={buyer.id}
              onChange={(e) => setBuyer((b) => ({ ...b, id: normalizeId(e.target.value) }))} className="text-left tabular-nums" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="כתובת"><Input dir="rtl" value={buyer.address} onChange={(e) => setBuyer((b) => ({ ...b, address: e.target.value }))} /></Field>
            <Field label="טלפון"><Input dir="ltr" inputMode="tel" value={buyer.phone} onChange={(e) => setBuyer((b) => ({ ...b, phone: e.target.value }))} className="text-left" /></Field>
          </div>
        </SectionCard>

        {/* Price & payment */}
        <SectionCard title="מחיר ותשלום" hint="הסכום במילים מתמלא אוטומטית — ניתן לתקן.">
          <Field label="מחיר כולל (₪)" required error={submitAttempted && !(totalN > 0) ? 'יש להזין מחיר' : ''}>
            <Input dir="ltr" inputMode="numeric" value={price.total} onChange={(e) => setTotal(e.target.value)} className="text-left tabular-nums" />
          </Field>
          <Field label="מחיר במילים">
            <Input dir="rtl" value={price.totalWords} onChange={(e) => setPrice((p) => ({ ...p, totalWords: e.target.value }))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="מקדמה בחתימה (₪)">
              <Input dir="ltr" inputMode="numeric" value={price.down} onChange={(e) => setDown(e.target.value)} className="text-left tabular-nums" />
            </Field>
            <Field label="תאריך תשלום היתרה">
              <DateInput value={price.balanceDate} onChange={(e) => setPrice((p) => ({ ...p, balanceDate: e.target.value }))} />
            </Field>
          </div>
          <div className="rounded-2xl px-3 py-2 text-[12px]" style={{ background: C.gray50, color: C.text }}>
            יתרה לתשלום: <strong>{balance.toLocaleString('en-US')} ₪</strong>
            {balanceWords ? ` (${balanceWords} ש״ח)` : ''}
          </div>
          {downExceeds && (
            <p className="text-[11px]" style={{ color: C.warn }}>המקדמה גדולה מהמחיר הכולל — בדוק את הסכומים</p>
          )}
        </SectionCard>

        {/* Condition */}
        <SectionCard title="מצב הרכב" hint="מולא מנתוני הרכב — ניתן לעדכן.">
          <div className="grid grid-cols-2 gap-3">
            <Field label="קילומטראז' (ק״מ)">
              <Input dir="ltr" inputMode="numeric" value={condition.km} onChange={(e) => setCondition((c) => ({ ...c, km: onlyDigits(e.target.value) }))} className="text-left tabular-nums" />
            </Field>
            <Field label="מספר ידיים">
              <Input dir="ltr" inputMode="numeric" maxLength={2} value={condition.hands} onChange={(e) => setCondition((c) => ({ ...c, hands: onlyDigits(e.target.value) }))} className="text-left tabular-nums" />
            </Field>
          </div>
          <Field label="סוג בעלות">
            <Input dir="rtl" value={condition.ownership} onChange={(e) => setCondition((c) => ({ ...c, ownership: e.target.value }))} />
          </Field>
          <label className="flex items-center gap-2 text-[13px] cursor-pointer" style={{ color: C.text }}>
            <input type="checkbox" checked={condition.hadAccident} onChange={(e) => setCondition((c) => ({ ...c, hadAccident: e.target.checked }))} />
            הרכב היה מעורב בתאונה שגרמה לירידת ערך
          </label>
        </SectionCard>

        {/* Contract date */}
        <SectionCard title="תאריך החוזה" hint="">
          <Field label="תאריך" required error={submitAttempted && !date ? 'יש לבחור תאריך' : ''}>
            <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </SectionCard>

        {/* Digital signature (optional) */}
        <SectionCard title="חתימה דיגיטלית (אופציונלי)"
          hint="חתימה אלקטרונית רגילה — מתאימה להסכם בין הצדדים. אינה חתימה מאושרת/ממשלתית.">
          <label className="flex items-start gap-2 text-[12px] cursor-pointer" style={{ color: C.text }}>
            <input type="checkbox" checked={signConsent} onChange={(e) => setSignConsent(e.target.checked)} className="mt-0.5" />
            אני מאשר/ת שחתימה אלקטרונית שאוסיף מהווה את חתימתי המחייבת על המסמך.
          </label>
          {[{ key: 'seller', label: 'חתימת המוכר', who: seller }, { key: 'buyer', label: 'חתימת הקונה', who: buyer }].map((p) => (
            <div key={p.key} className="flex items-center justify-between gap-3 rounded-2xl border p-3" style={{ borderColor: C.border }}>
              <div className="min-w-0">
                <p className="text-sm font-bold" style={{ color: C.text }}>{p.label}</p>
                <p className="text-[11px] truncate" style={{ color: C.muted }}>{p.who.name.trim() || '— יש למלא שם —'}</p>
              </div>
              {signatures[p.key] ? (
                <div className="flex items-center gap-2 shrink-0">
                  <img src={signatures[p.key].dataUrl} alt="חתימה" style={{ height: '32px' }} />
                  <button type="button" onClick={() => setSigningParty(p.key)} disabled={!signConsent}
                    className="text-[12px] font-bold disabled:opacity-50" style={{ color: C.primary }}>החלף</button>
                </div>
              ) : (
                <button type="button" onClick={() => setSigningParty(p.key)} disabled={!signConsent || !p.who.name.trim()}
                  className="h-9 px-4 rounded-xl font-bold text-white text-sm disabled:opacity-50 shrink-0" style={{ background: C.primary }}>
                  חתום
                </button>
              )}
            </div>
          ))}
        </SectionCard>
      </div>

      {/* Sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t p-3"
        style={{ background: C.card, borderColor: C.border, paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))' }}>
        <div className="max-w-2xl mx-auto">
          {problems.length > 0 && (
            <p className="text-[11px] text-center mb-2 flex items-center justify-center gap-1.5 flex-wrap"
              style={{ color: submitAttempted ? C.error : C.muted }}>
              <Info className="h-3.5 w-3.5 shrink-0" /> חסר למילוי: {problems.join(' · ')}
            </p>
          )}
          <button type="button" onClick={handleSubmit}
            className="w-full h-12 rounded-2xl font-bold text-white text-base transition-opacity active:opacity-90"
            style={{ background: C.primary }}>
            תצוגה מקדימה והפקה
          </button>
        </div>
      </div>

      {showPreview && (
        <FormPreviewModal
          fileBase={`זכרון-דברים-${vehicle.plate || ''}`}
          disclaimer="מסמך זה הוא המלצה בלבד. בדוק את הסעיפים, התאם לצורך, הדפס וחתום ביד."
          shareTitle="העברת בעלות רכב – זכרון דברים"
          shareText={`זכרון דברים להעברת בעלות רכב ${vehicle.plate || ''} — הופק ב-CarReminder.`}
          onClose={() => setShowPreview(false)}
        >
          <VehicleSaleDocument data={docData} />
        </FormPreviewModal>
      )}

      {showSample && (
        <FormPreviewModal
          title="דוגמה לטופס"
          subtitle="כך נראה הטופס — מלא את הפרטים והפק את המסמך שלך"
          fileBase="דוגמה-זכרון-דברים"
          disclaimer="זוהי דוגמה ריקה. מלא את הפרטים בטופס כדי להפיק מסמך מלא."
          shareTitle="דוגמה — זכרון דברים"
          shareText="דוגמה לטופס זכרון דברים — CarReminder."
          onClose={() => setShowSample(false)}
        >
          <VehicleSaleDocument data={{}} />
        </FormPreviewModal>
      )}

      {signingParty && (
        <SignaturePad
          title={signingParty === 'seller' ? 'חתימת המוכר' : 'חתימת הקונה'}
          onSave={captureSignature}
          onClose={() => setSigningParty(null)}
        />
      )}
    </div>
  );
}
