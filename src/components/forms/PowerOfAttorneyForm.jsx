import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Plus, Trash2, Download, FileText, Share2, Loader2, X, Info, AlertTriangle, Eye,
} from 'lucide-react';
import { db } from '@/lib/supabaseEntities';
import { useAuth } from '@/components/shared/GuestContext';
import useAccountRole from '@/hooks/useAccountRole';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { C } from '@/lib/designTokens';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateInput } from '@/components/ui/date-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { toastError } from '@/lib/userErrorReport';
import { shareContent } from '@/lib/capacitor';
import { isValidIsraeliId, normalizeId } from '@/lib/forms/israeliId';
import PowerOfAttorneyDocument from './PowerOfAttorneyDocument';
import SignaturePad from './SignaturePad';
import { shortFingerprint, canonicalize } from '@/lib/forms/docHash';

const MY_ID_KEY = (uid) => `cr_poa_my_id:${uid || 'anon'}`;
function readSavedId(uid) {
  try { return localStorage.getItem(MY_ID_KEY(uid)) || ''; } catch { return ''; }
}
function writeSavedId(uid, id) {
  try {
    if (id) localStorage.setItem(MY_ID_KEY(uid), id);
    else localStorage.removeItem(MY_ID_KEY(uid));
  } catch { /* quota / private mode — non-fatal */ }
}

// Small ת.ז field: numeric, max 9 digits. `error` (red) blocks; `warning`
// (amber) is advisory only — see the ת.ז policy note in the component.
function IdField({ label, value, onChange, error, warning, required = true }) {
  return (
    <div>
      <Label className="text-right block mb-1.5 text-sm">
        {label}{required && <span className="mr-1" style={{ color: C.error }}>*</span>}
      </Label>
      <Input
        dir="ltr"
        inputMode="numeric"
        maxLength={9}
        value={value}
        onChange={(e) => onChange(normalizeId(e.target.value))}
        className="text-left tabular-nums"
      />
      {error
        ? <p className="text-[11px] mt-1" style={{ color: C.error }}>{error}</p>
        : warning ? <p className="text-[11px] mt-1" style={{ color: C.warn }}>{warning}</p> : null}
    </div>
  );
}

// The purpose options. Labels mirror the gov form's three checkboxes; the
// `desc` lines translate the bureaucratic terms into plain language so the
// user understands what each one authorizes (Ofek's feedback: the raw
// labels alone weren't clear).
const PURPOSE_OPTS = [
  { key: 'other', label: 'פעולה אחרת', desc: 'טסט שנתי, חידוש רישיון וכל טיפול שוטף מול משרד הרישוי — מטעם בעל הרכב. זו הבחירה המתאימה לרוב המקרים.' },
  { key: 'sale', label: 'מכירה', desc: 'ייפוי כוח למכירת הרכב, מטעם בעל הרכב הרשום.' },
  { key: 'purchase', label: 'קנייה', desc: 'ייפוי כוח לקניית הרכב, מטעם הקונה.' },
];

// Three-way segmented control + a live description of the chosen purpose.
function PurposePicker({ value, onChange }) {
  const selected = PURPOSE_OPTS.find((o) => o.key === value) || PURPOSE_OPTS[0];
  return (
    <div className="space-y-2.5">
      <div className="flex gap-2" role="radiogroup" aria-label="מטרת ייפוי הכוח">
        {PURPOSE_OPTS.map((o) => {
          const on = value === o.key;
          return (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.key)}
              className="flex-1 h-11 rounded-2xl text-sm font-bold border transition-colors"
              style={{
                background: on ? C.primary : C.card,
                color: on ? '#FFFFFF' : C.text,
                borderColor: on ? C.primary : C.border,
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <div className="rounded-2xl px-3 py-2 text-[12px] leading-relaxed" style={{ background: C.light, color: C.primary }}>
        {selected.desc}
      </div>
    </div>
  );
}

function SectionCard({ title, hint, children }) {
  return (
    <div className="rounded-3xl border p-4" style={{ borderColor: C.border, background: C.card }}>
      <p className="text-sm font-bold mb-1" style={{ color: C.text }}>{title}</p>
      {hint && <p className="text-[12px] mb-3" style={{ color: C.muted }}>{hint}</p>}
      <div className="space-y-3">{children}</div>
    </div>
  );
}

export default function PowerOfAttorneyForm() {
  const { user } = useAuth();
  const { accountId } = useAccountRole();
  const { isBusiness, businessMeta } = useWorkspaceRole();
  const { activeWorkspace } = useWorkspace();

  // ── Vehicles for the picker (account-scoped, timeout-guarded) ──────
  const {
    data: vehicles = [],
    isLoading: vehiclesLoading,
    isError: vehiclesError,
    refetch: refetchVehicles,
  } = useQuery({
    queryKey: ['poa-vehicles', accountId],
    // db.vehicles.filter already applies withTimeout internally and returns
    // the rows array (throwing on error). Call it directly — wrapping it in
    // withTimeout again and destructuring { data, error } made `data`
    // undefined, so the picker always saw 0 vehicles.
    queryFn: () => db.vehicles.filter({ account_id: accountId }, { light: true }),
    enabled: !!accountId,
    retry: 1,
    retryDelay: 500,
  });

  // ── Form state ────────────────────────────────────────────────────
  const [purpose, setPurpose] = useState('other');
  const [vehicleId, setVehicleId] = useState('');
  const [manualPlate, setManualPlate] = useState('');
  // personal
  const [owners, setOwners] = useState([{ name: '', id: '' }]);
  const [validUntil, setValidUntil] = useState('');
  const [saveMyId, setSaveMyId] = useState(false);
  // shared
  const [rep, setRep] = useState({ name: '', id: '' });
  // business
  const [corpName, setCorpName] = useState('');
  const [corpNumber, setCorpNumber] = useState('');
  const [signatories, setSignatories] = useState([{ name: '' }, { name: '' }]);
  const [lawyer, setLawyer] = useState({ name: '', address: '', validUntil: '' });
  // Section 4 (lawyer certification) is optional — the official corporate
  // form requires it, so it's included by default, but the user can drop it.
  const [includeLawyer, setIncludeLawyer] = useState(true);

  const [showPreview, setShowPreview] = useState(false);
  const [showSample, setShowSample] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [signatures, setSignatures] = useState({});
  const [signingKey, setSigningKey] = useState(null);
  const [signConsent, setSignConsent] = useState(false);

  // Prefill once the identity/account data is known. Runs when the
  // building blocks change; guarded so it doesn't clobber user edits.
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (prefilledRef.current) return;
    if (isBusiness) {
      setCorpName(activeWorkspace?.account_name || activeWorkspace?.name || '');
      setCorpNumber(normalizeId(businessMeta?.business_id || ''));
      prefilledRef.current = true;
    } else if (user) {
      const savedId = readSavedId(user.id);
      setOwners([{ name: user.full_name || '', id: savedId }]);
      if (savedId) setSaveMyId(true);
      prefilledRef.current = true;
    }
  }, [isBusiness, user, activeWorkspace, businessMeta]);

  const selectedVehicle = useMemo(
    () => vehicles.find((v) => v.id === vehicleId) || null,
    [vehicles, vehicleId],
  );
  const plate = (selectedVehicle?.license_plate || manualPlate || '').trim();
  const hasVehicles = vehicles.length > 0;

  // ── Validation ──────────────────────────────────────────────────────
  // ת.ז policy: a missing (empty) ID for a required party BLOCKS export,
  // but a filled-in ID that fails the checksum only WARNS — these are
  // self-fill documents, so we flag a likely typo without preventing the
  // user from generating (e.g. a foreign ID, or an intentional draft).
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

  // A human-readable list of what still blocks export. Shown to the user
  // so the primary button is never a silent dead end. Invalid (but filled)
  // ת.ז does NOT block — it only warns.
  const problems = useMemo(() => {
    const p = [];
    if (!plate) p.push('מספר רישוי');
    if (isBusiness) {
      if (!corpName.trim()) p.push('שם התאגיד');
      if (!corpNumber.trim()) p.push('מספר התאגיד');
      if (!signatories[0]?.name.trim()) p.push('מורשה חתימה');
    } else {
      if (!owners[0]?.name.trim()) p.push('שם בעל הרכב');
      if (idEmpty(owners[0]?.id)) p.push('ת.ז של בעל הרכב');
      // An extra owner with an id typed but no name is incomplete.
      const extraIncomplete = owners.slice(1).some((o) => normalizeId(o.id) && !o.name.trim());
      if (extraIncomplete) p.push('שם בעלים נוסף');
      if (!validUntil) p.push('תאריך בתוקף עד');
    }
    if (!rep.name.trim()) p.push('שם מיופה הכוח');
    if (idEmpty(rep.id)) p.push('ת.ז של מיופה הכוח');
    return p;
  }, [plate, rep, isBusiness, corpName, corpNumber, signatories, owners, validUntil]);
  const valid = problems.length === 0;

  const docData = useMemo(() => (
    isBusiness
      ? { purpose, plate, corpName, corpNumber, signatories, representative: rep, lawyer, includeLawyer, signatures }
      : { purpose, plate, owners, representative: rep, validUntil, signatures }
  ), [isBusiness, purpose, plate, corpName, corpNumber, signatories, rep, lawyer, includeLawyer, owners, validUntil, signatures]);

  // Electronic signature: resolve the signer's identity for a slot key,
  // then stamp the signature with name/ת.ז/time + a content fingerprint.
  const signerFor = (key) => {
    if (key.startsWith('owner')) { const o = owners[+key.slice(5)] || {}; return { name: o.name || '', id: o.id || '' }; }
    if (key.startsWith('sig')) { const s = signatories[+key.slice(3)] || {}; return { name: s.name || '', id: '' }; }
    return { name: '', id: '' };
  };
  const captureSignature = async (dataUrl) => {
    const key = signingKey;
    if (!key) return;
    const who = signerFor(key);
    let hash = '';
    try { hash = await shortFingerprint(canonicalize(docData)); } catch { /* fingerprint is best-effort */ }
    setSignatures((s) => ({ ...s, [key]: { dataUrl, name: who.name, id: who.id, ts: new Date().toISOString(), hash } }));
    setSigningKey(null);
  };

  // ── Owners list helpers (personal, up to 3) ──────────────────────────
  const updateOwner = (i, patch) =>
    setOwners((arr) => arr.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  const addOwner = () => setOwners((arr) => (arr.length >= 3 ? arr : [...arr, { name: '', id: '' }]));
  const removeOwner = (i) => setOwners((arr) => arr.filter((_, idx) => idx !== i));

  const handleSubmit = () => {
    if (!valid) {
      // Don't dead-end: reveal field-level errors and say exactly what's
      // missing instead of leaving a silently-disabled button.
      setSubmitAttempted(true);
      toast.error('חסר למילוי: ' + problems.join(', '));
      return;
    }
    // Persist the user's ת.ז for next time, if they opted in (personal only,
    // device-local — never leaves the device, no DB column / PII on server).
    if (!isBusiness && user) {
      writeSavedId(user.id, saveMyId && isValidIsraeliId(owners[0].id) ? normalizeId(owners[0].id) : '');
    }
    setShowPreview(true);
  };

  return (
    <div className="pb-28">
      {/* Account-type chip */}
      <div className="flex items-center gap-2 mb-4">
        <span
          className="text-[11px] font-bold px-2.5 py-1 rounded-full"
          style={{ background: C.light, color: C.primary }}
        >
          {isBusiness ? 'חשבון עסקי · טופס תאגיד' : 'חשבון פרטי · טופס אדם פרטי'}
        </span>
      </div>

      <button type="button" onClick={() => setShowSample(true)}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-bold" style={{ color: C.primary }}>
        <Eye className="h-4 w-4" /> צפה בדוגמה ריקה של הטופס
      </button>

      <div className="space-y-4">
        {/* Purpose */}
        <SectionCard title="מטרת ייפוי הכוח" hint="לאיזו פעולה מול משרד הרישוי אתה מסמיך את מיופה הכוח?">
          <PurposePicker value={purpose} onChange={setPurpose} />
        </SectionCard>

        {/* Vehicle */}
        <SectionCard title="הרכב" hint="בחר רכב מהחשבון — מספר הרישוי ימולא אוטומטית.">
          {vehiclesLoading ? (
            <div className="flex items-center gap-2 text-sm" style={{ color: C.muted }}>
              <Loader2 className="h-4 w-4 animate-spin" /> טוען רכבים…
            </div>
          ) : vehiclesError ? (
            <div className="rounded-2xl p-3 text-sm flex items-center justify-between"
              style={{ background: C.errorBg, color: C.errorDark }}>
              <span>שגיאה בטעינת הרכבים</span>
              <button type="button" onClick={() => refetchVehicles()}
                className="font-bold underline">נסה שוב</button>
            </div>
          ) : hasVehicles ? (
            <Select value={vehicleId} onValueChange={setVehicleId}>
              <SelectTrigger dir="rtl">
                <SelectValue placeholder="בחר רכב" />
              </SelectTrigger>
              <SelectContent>
                {vehicles.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {(v.nickname || `${v.manufacturer || ''} ${v.model || ''}`).trim() || 'רכב'}
                    {v.license_plate ? ` · ${v.license_plate}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div>
              <Label className="text-right block mb-1.5 text-sm">
                מספר רישוי<span className="mr-1" style={{ color: C.error }}>*</span>
              </Label>
              <Input
                dir="ltr"
                inputMode="numeric"
                value={manualPlate}
                onChange={(e) => setManualPlate(e.target.value)}
                className="text-left tabular-nums"
              />
              <p className="text-[11px] mt-1" style={{ color: C.muted }}>
                אין רכבים בחשבון — הזן מספר רישוי ידנית.
              </p>
            </div>
          )}
          {submitAttempted && !plate && (
            <p className="text-[11px] mt-1" style={{ color: C.error }}>יש לבחור רכב או להזין מספר רישוי</p>
          )}
        </SectionCard>

        {isBusiness ? (
          <>
            {/* Corporation */}
            <SectionCard title="פרטי התאגיד" hint="ממולא מהגדרות העסק — ניתן לעריכה.">
              <div>
                <Label className="text-right block mb-1.5 text-sm">
                  שם התאגיד<span className="mr-1" style={{ color: C.error }}>*</span>
                </Label>
                <Input value={corpName} onChange={(e) => setCorpName(e.target.value)} dir="rtl" />
              </div>
              <div>
                <Label className="text-right block mb-1.5 text-sm">
                  מספר התאגיד (ח.פ){' '}<span className="mr-1" style={{ color: C.error }}>*</span>
                </Label>
                <Input value={corpNumber} onChange={(e) => setCorpNumber(normalizeId(e.target.value))}
                  dir="ltr" inputMode="numeric" maxLength={9} className="text-left tabular-nums" />
              </div>
            </SectionCard>

            {/* Signatories */}
            <SectionCard title="מורשי חתימה בשם התאגיד" hint="עד שני מורשי חתימה. החתימה עצמה נוספת ידנית לאחר ההדפסה.">
              {[0, 1].map((i) => (
                <div key={i}>
                  <Label className="text-right block mb-1.5 text-sm">
                    מורשה חתימה {i + 1}{i === 0 && <span className="mr-1" style={{ color: C.error }}>*</span>}
                  </Label>
                  <Input
                    value={signatories[i]?.name || ''}
                    onChange={(e) => setSignatories((arr) => arr.map((s, idx) => (idx === i ? { name: e.target.value } : s)))}
                    dir="rtl"
                                     />
                </div>
              ))}
            </SectionCard>
          </>
        ) : (
          /* Owners */
          <SectionCard title="בעלי הרכב" hint="נותני ייפוי הכוח (עד 3). החתימה נוספת ידנית לאחר ההדפסה.">
            {owners.map((o, i) => {
              // An extra owner becomes "required" (and validated) once the
              // user starts filling it — so a half-filled row can't slip
              // into the printed form.
              const ownerRequired = i === 0 || !!(o.name.trim() || normalizeId(o.id));
              return (
              <div key={i} className="rounded-2xl border p-3 space-y-3" style={{ borderColor: C.border }}>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-bold" style={{ color: C.muted }}>בעלים {i + 1}</span>
                  {owners.length > 1 && (
                    <button type="button" onClick={() => removeOwner(i)} aria-label="הסר בעלים"
                      className="p-1 rounded-lg" style={{ color: C.error }}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <div>
                  <Label className="text-right block mb-1.5 text-sm">
                    שם מלא{i === 0 && <span className="mr-1" style={{ color: C.error }}>*</span>}
                  </Label>
                  <Input value={o.name} onChange={(e) => updateOwner(i, { name: e.target.value })}
                    dir="rtl" />
                  {ownerRequired && submitAttempted && !o.name.trim() && (
                    <p className="text-[11px] mt-1" style={{ color: C.error }}>יש להזין שם</p>
                  )}
                </div>
                <IdField
                  label="ת.ז"
                  required={i === 0}
                  value={o.id}
                  onChange={(v) => updateOwner(i, { id: v })}
                  error={idBlockError(o.id, ownerRequired)}
                  warning={idWarn(o.id)}
                />
                {i === 0 && (
                  <label className="flex items-center gap-2 text-[12px] cursor-pointer" style={{ color: C.text }}>
                    <input type="checkbox" checked={saveMyId} onChange={(e) => setSaveMyId(e.target.checked)} />
                    שמור את ה-ת.ז שלי במכשיר לפעם הבאה
                  </label>
                )}
              </div>
              );
            })}
            {owners.length < 3 && (
              <button type="button" onClick={addOwner}
                className="flex items-center gap-1.5 text-sm font-bold" style={{ color: C.primary }}>
                <Plus className="h-4 w-4" /> הוסף בעלים
              </button>
            )}
          </SectionCard>
        )}

        {/* Representative (both variants) */}
        <SectionCard title="מיופה הכוח" hint="האדם שיטפל ברכב בשמך (למשל ייקח אותו לטסט).">
          <div>
            <Label className="text-right block mb-1.5 text-sm">
              שם מלא<span className="mr-1" style={{ color: C.error }}>*</span>
            </Label>
            <Input value={rep.name} onChange={(e) => setRep((r) => ({ ...r, name: e.target.value }))}
              dir="rtl" />
            {submitAttempted && !rep.name.trim() && (
              <p className="text-[11px] mt-1" style={{ color: C.error }}>יש להזין שם</p>
            )}
          </div>
          <IdField label="ת.ז" value={rep.id} onChange={(v) => setRep((r) => ({ ...r, id: v }))} error={idBlockError(rep.id, true)} warning={idWarn(rep.id)} />
          {!isBusiness && (
            <div>
              <Label className="text-right block mb-1.5 text-sm">
                בתוקף עד<span className="mr-1" style={{ color: C.error }}>*</span>
              </Label>
              <DateInput value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
              {submitAttempted && !validUntil && (
                <p className="text-[11px] mt-1" style={{ color: C.error }}>יש לבחור תאריך</p>
              )}
            </div>
          )}
        </SectionCard>

        {/* Lawyer (business only) — optional section 4 */}
        {isBusiness && (
          <SectionCard title="אישור עורך דין (סעיף 4)" hint="אופציונלי — אפשר לכלול את סעיף עורך הדין במסמך או להשמיט אותו.">
            <label className="flex items-center gap-2 text-[13px] cursor-pointer" style={{ color: C.text }}>
              <input type="checkbox" checked={includeLawyer} onChange={(e) => setIncludeLawyer(e.target.checked)} />
              כלול במסמך את סעיף אישור עורך הדין
            </label>
            {includeLawyer ? (
              <>
                <div className="rounded-2xl p-3 flex items-start gap-2 text-[12px]"
                  style={{ background: C.warnBg, color: C.warnDark }}>
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>הטופס הרשמי לתאגיד מחייב אישור, חתימה וחותמת של עורך דין על נכונות מורשי החתימה.</span>
                </div>
                <div>
                  <Label className="text-right block mb-1.5 text-sm">שם עורך הדין</Label>
                  <Input value={lawyer.name} onChange={(e) => setLawyer((l) => ({ ...l, name: e.target.value }))} dir="rtl" />
                </div>
                <div>
                  <Label className="text-right block mb-1.5 text-sm">כתובת המשרד</Label>
                  <Input value={lawyer.address} onChange={(e) => setLawyer((l) => ({ ...l, address: e.target.value }))} dir="rtl" />
                </div>
                <div>
                  <Label className="text-right block mb-1.5 text-sm">בתוקף עד</Label>
                  <DateInput value={lawyer.validUntil} onChange={(e) => setLawyer((l) => ({ ...l, validUntil: e.target.value }))} />
                </div>
              </>
            ) : (
              <p className="text-[12px]" style={{ color: C.muted }}>
                סעיף אישור עורך הדין לא ייכלל במסמך. שים לב: ייתכן שמשרד הרישוי ידרוש אותו בעת ההגשה.
              </p>
            )}
          </SectionCard>
        )}

        {/* Digital signature (optional) */}
        <SectionCard title="חתימה דיגיטלית (אופציונלי)"
          hint="חתימה אלקטרונית רגילה — אינה חתימה מאושרת/ממשלתית. ייתכן שמשרד הרישוי ידרוש חתימה ידנית מקורית.">
          <label className="flex items-start gap-2 text-[12px] cursor-pointer" style={{ color: C.text }}>
            <input type="checkbox" checked={signConsent} onChange={(e) => setSignConsent(e.target.checked)} className="mt-0.5" />
            אני מאשר/ת שחתימה אלקטרונית שאוסיף מהווה את חתימתי המחייבת על המסמך.
          </label>
          {(() => {
            const parties = isBusiness
              ? signatories.map((s, i) => ({ key: `sig${i}`, label: `חתימת מורשה חתימה ${i + 1}`, name: s.name }))
              : owners.map((o, i) => ({ key: `owner${i}`, label: `חתימת בעלים ${i + 1}`, name: o.name }));
            const named = parties.filter((p) => p.name.trim());
            if (named.length === 0) {
              return <p className="text-[12px]" style={{ color: C.muted }}>מלא שמות {isBusiness ? 'מורשי חתימה' : 'בעלים'} כדי לאפשר חתימה דיגיטלית.</p>;
            }
            return named.map((p) => (
              <div key={p.key} className="flex items-center justify-between gap-3 rounded-2xl border p-3" style={{ borderColor: C.border }}>
                <div className="min-w-0">
                  <p className="text-sm font-bold" style={{ color: C.text }}>{p.label}</p>
                  <p className="text-[11px] truncate" style={{ color: C.muted }}>{p.name}</p>
                </div>
                {signatures[p.key] ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <img src={signatures[p.key].dataUrl} alt="חתימה" style={{ height: '32px' }} />
                    <button type="button" onClick={() => setSigningKey(p.key)} disabled={!signConsent}
                      className="text-[12px] font-bold disabled:opacity-50" style={{ color: C.primary }}>החלף</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setSigningKey(p.key)} disabled={!signConsent}
                    className="h-9 px-4 rounded-xl font-bold text-white text-sm disabled:opacity-50 shrink-0" style={{ background: C.primary }}>חתום</button>
                )}
              </div>
            ));
          })()}
        </SectionCard>
      </div>

      {/* Sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t p-3"
        style={{
          background: C.card, borderColor: C.border,
          paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))',
        }}>
        <div className="max-w-2xl mx-auto">
          {problems.length > 0 && (
            <p className="text-[11px] text-center mb-2 flex items-center justify-center gap-1.5 flex-wrap"
              style={{ color: submitAttempted ? C.error : C.muted }}>
              <Info className="h-3.5 w-3.5 shrink-0" /> חסר למילוי: {problems.join(' · ')}
            </p>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            className="w-full h-12 rounded-2xl font-bold text-white text-base transition-opacity active:opacity-90"
            style={{ background: C.primary }}
          >
            תצוגה מקדימה והפקה
          </button>
        </div>
      </div>

      {showPreview && (
        <PreviewModal
          docData={docData}
          variant={isBusiness ? 'business' : 'personal'}
          plate={plate}
          onClose={() => setShowPreview(false)}
        />
      )}

      {showSample && (
        <PreviewModal
          docData={{}}
          variant={isBusiness ? 'business' : 'personal'}
          plate=""
          title="דוגמה לטופס"
          subtitle="כך נראה הטופס — מלא את הפרטים והפק את המסמך שלך"
          onClose={() => setShowSample(false)}
        />
      )}

      {signingKey && (
        <SignaturePad title="חתימה דיגיטלית" onSave={captureSignature} onClose={() => setSigningKey(null)} />
      )}
    </div>
  );
}

// ── Preview + export modal ────────────────────────────────────────────
// Mirrors AccidentReportModal's proven full-screen pattern: visible
// rendered document (required by html2canvas) + sticky export bar with
// safe-area padding.
function PreviewModal({ docData, variant, plate, onClose, title = 'תצוגה מקדימה', subtitle = 'בדוק את הפרטים לפני ההפקה' }) {
  const previewRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const fileBase = `יפוי-כוח-${(plate || 'רכב').replace(/[^\w֐-׿-]/g, '')}`;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const exportAs = async (kind) => {
    if (busy || !previewRef.current) return;
    setBusy(true);
    try {
      const mod = await import('@/lib/pdfExport');
      const fn = kind === 'word' ? mod.exportElementToWord : mod.exportElementToPdf;
      const ok = await fn(previewRef.current, fileBase);
      if (ok) toast.success(kind === 'word' ? 'מסמך Word נוצר' : 'מסמך PDF נוצר');
      else toastError(`שגיאה ביצירת קובץ ה-${kind === 'word' ? 'Word' : 'PDF'}`, { action: `poa_${kind}_export` });
    } catch (e) {
      toastError(`שגיאה ביצירת המסמך`, { action: `poa_${kind}_export`, err: e });
    } finally {
      setBusy(false);
    }
  };

  const handleShare = async () => {
    const ok = await shareContent({
      title: 'ייפוי כוח',
      text: `ייפוי כוח לרכב ${plate || ''} — הופק ב-CarReminder.`,
    });
    if (!ok) toastError('השיתוף בוטל', { action: 'poa_share_cancel' });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        paddingTop: 'max(12px, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))',
        paddingInline: '12px',
      }}
    >
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl my-auto max-h-[calc(100dvh-32px)] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3 shrink-0" style={{ borderColor: C.border }}>
          <div className="min-w-0">
            <p className="text-base font-bold" style={{ color: C.text }}>{title}</p>
            <p className="text-xs" style={{ color: C.muted }}>{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="סגור"
            className="w-9 h-9 rounded-full border flex items-center justify-center shrink-0"
            style={{ borderColor: C.border }}>
            <X className="h-4 w-4" style={{ color: C.muted }} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-3 sm:p-5" style={{ background: C.gray100 }}>
          <div ref={previewRef}>
            <PowerOfAttorneyDocument data={docData} variant={variant} />
          </div>
        </div>

        <div className="border-t p-3 shrink-0" style={{ borderColor: C.border, background: C.card }}>
          <p className="text-[11px] text-center mb-2" style={{ color: C.muted }}>
            המסמך מבוסס על טופס משרד התחבורה. יש לבדוק, להדפיס ולחתום ביד.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <button type="button" onClick={() => exportAs('pdf')} disabled={busy}
              className="flex-1 h-11 rounded-2xl font-bold text-white inline-flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: C.primary }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} PDF
            </button>
            <button type="button" onClick={() => exportAs('word')} disabled={busy}
              className="flex-1 h-11 rounded-2xl font-bold inline-flex items-center justify-center gap-2 border disabled:opacity-60"
              style={{ borderColor: C.primary, color: C.primary, background: C.card }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Word
            </button>
            <button type="button" onClick={handleShare}
              className="h-11 rounded-2xl font-bold inline-flex items-center justify-center gap-2 border px-4"
              style={{ borderColor: C.border, color: C.text, background: C.card }}>
              <Share2 className="h-4 w-4" /> שתף
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
