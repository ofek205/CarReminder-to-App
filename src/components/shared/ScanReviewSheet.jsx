/**
 * ScanReviewSheet — confirmation layer between the AI extraction and
 * the main form.
 *
 * Why it exists:
 *   The AI gets fields wrong. License-plate digits transposed, vendor
 *   name in the wrong language, year off by a decade. Before, those
 *   silently flowed into the main form and got saved. Now the user
 *   sees them in a clean review, can fix anything off, and only then
 *   confirms.
 *
 * Behaviour:
 *   • Full-screen-ish modal (max-w-md on desktop, full width on mobile)
 *   • Sticky header with "back" + title
 *   • Each extracted field rendered as its own card:
 *       - filled fields → white card + green Sparkles + edit pencil
 *       - missing fields → amber tint + warning icon + placeholder text
 *   • Inline editing: tap the pencil → input expands → blur saves
 *   • Sticky footer with two CTAs: confirm-and-continue or discard
 *
 * Shape of the `schema` prop:
 *   Array of field defs, in display order:
 *     [{ key, label, type?, dir?, placeholder? }]
 *   type      'text' | 'number' | 'date'   default 'text'
 *   dir       'ltr' | 'rtl' | 'auto'        default 'auto'
 *   placeholder shown when the field is empty
 *
 * Props:
 *   open       — controls visibility
 *   file       — same File for the thumbnail strip
 *   extracted  — Record<string, value> the keys from `schema` you got
 *                from the AI. Missing keys = field not detected.
 *   schema     — see above
 *   onConfirm  — fired with the final values map
 *   onSkip     — fired when user picks "edit everything manually"
 *   onBack     — fired when user taps the back arrow
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { DateInput } from '@/components/ui/date-input';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import {
  ArrowRight, Sparkles, AlertTriangle, Pencil, Check, FileText,
} from 'lucide-react';
import { C } from '@/lib/designTokens';

export default function ScanReviewSheet({
  open,
  file,
  extracted = {},
  schema    = [],
  onConfirm,
  onSkip,
  onBack,
}) {
  const isImage = !!file && file.type?.startsWith('image/');
  const [thumb, setThumb] = useState(null);
  const [values, setValues] = useState({});
  const [editingKey, setEditingKey] = useState(null);

  // Generate thumbnail on open.
  useEffect(() => {
    if (!file || !isImage) { setThumb(null); return; }
    const reader = new FileReader();
    reader.onload = () => setThumb(reader.result);
    reader.readAsDataURL(file);
    return () => reader.abort();
  }, [file, isImage]);

  // Reset local values whenever the sheet opens with a new extraction.
  useEffect(() => {
    if (!open) return;
    const initial = {};
    for (const f of schema) {
      const raw = extracted[f.key];
      initial[f.key] = raw == null ? '' : String(raw);
    }
    setValues(initial);
    setEditingKey(null);
  }, [open, extracted, schema]);

  // Counts for the header summary.
  const summary = useMemo(() => {
    let filled = 0;
    let missing = 0;
    for (const f of schema) {
      if (values[f.key] && String(values[f.key]).trim().length) filled += 1;
      else missing += 1;
    }
    return { filled, missing, total: schema.length };
  }, [schema, values]);

  const handleChange = (key, v) => setValues((p) => ({ ...p, [key]: v }));
  const handleConfirm = () => onConfirm?.(values);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onBack?.(); }}>
      <DialogContent
        dir="rtl"
        className="max-w-md w-[calc(100vw-16px)] sm:w-full p-0 overflow-hidden rounded-3xl"
        style={{ background: C.gray50 }}
      >
        <VisuallyHidden.Root>
          <DialogTitle>אישור הפרטים שזוהו</DialogTitle>
          <DialogDescription>סקור ועדכן את הפרטים שה-AI חילץ מהמסמך לפני שהם נכנסים לטופס</DialogDescription>
        </VisuallyHidden.Root>

        {/* Sticky header */}
        <div className="flex items-center justify-between px-4 py-3 bg-white border-b" style={{ borderColor: C.gray200 }}>
          <button onClick={() => onBack?.()} className="flex items-center gap-1.5 text-sm font-bold" style={{ color: C.primary }}>
            <ArrowRight className="w-4 h-4" />
            חזרה
          </button>
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-4 h-4" style={{ color: C.warn }} />
            <h2 className="text-sm font-bold" style={{ color: C.gray800 }}>אישור הפרטים שזוהו</h2>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="px-4 py-4 space-y-3 overflow-y-auto" style={{ maxHeight: 'calc(85vh - 200px)' }}>
          {/* File strip */}
          {file && (
            <div className="flex items-center gap-2.5 p-2.5 rounded-2xl bg-white"
              style={{ border: `1.5px solid ${C.gray200}` }}>
              <div className="w-12 h-12 rounded-lg overflow-hidden flex items-center justify-center shrink-0"
                style={{ background: isImage ? C.gray100 : C.warnSubtle }}>
                {thumb
                  ? <img src={thumb} alt="" className="w-full h-full object-cover" />
                  : <FileText className="w-5 h-5" style={{ color: C.warn }} />}
              </div>
              <div className="flex-1 min-w-0 text-right">
                <p className="text-[12px] font-bold truncate" style={{ color: C.gray800 }} dir="ltr">
                  {file.name}
                </p>
                <p className="text-[10px]" style={{ color: C.gray500 }}>
                  {summary.filled} מתוך {summary.total} שדות זוהו
                </p>
              </div>
            </div>
          )}

          {/* Summary chip — visible only if at least one field missing */}
          {summary.missing > 0 && (
            <div className="flex items-center gap-2 p-2.5 rounded-xl"
              style={{ background: C.warnSubtle, border: `1.5px solid ${C.warnBorder}` }}>
              <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: C.warn }} />
              <p className="text-[11px] font-medium leading-snug" style={{ color: '#78350F' }}>
                {summary.missing === 1
                  ? 'שדה אחד לא זוהה — מלא אותו ידנית'
                  : `${summary.missing} שדות לא זוהו — מלא אותם ידנית`}
              </p>
            </div>
          )}

          {/* Fields */}
          {schema.map((f) => {
            const v = values[f.key] || '';
            const filled = String(v).trim().length > 0;
            const isEditing = editingKey === f.key;
            return (
              <FieldCard
                key={f.key}
                field={f}
                value={v}
                filled={filled}
                editing={isEditing}
                onStartEdit={() => setEditingKey(f.key)}
                onStopEdit={() => setEditingKey(null)}
                onChange={(nv) => handleChange(f.key, nv)}
              />
            );
          })}
        </div>

        {/* Sticky footer */}
        <div className="px-4 pt-3 pb-4 bg-white border-t space-y-2.5" style={{ borderColor: C.gray200 }}>
          <button
            onClick={handleConfirm}
            className="w-full h-12 rounded-full flex items-center justify-center gap-2 font-bold text-[14px] transition-all active:scale-[0.98]"
            style={{ background: C.grad, color: '#fff', boxShadow: `0 4px 16px ${C.primary}40` }}
          >
            <Check className="w-4 h-4" />
            אישור והמשך לטופס
          </button>
          <button
            onClick={() => onSkip?.()}
            className="w-full h-11 rounded-full font-bold text-[13px] transition-all active:scale-[0.98]"
            style={{ background: '#fff', color: C.gray500, border: `1.5px solid ${C.gray200}` }}
          >
            ערוך הכל ידנית
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FieldCard({ field, value, filled, editing, onStartEdit, onStopEdit, onChange }) {
  const cardBg     = filled ? '#fff' : C.warnSubtle;
  const cardBorder = filled ? C.gray200 : C.warnBorder;
  const Icon       = filled ? Sparkles : AlertTriangle;
  const iconColor  = filled ? C.primary : C.warn;

  // Date fields are handled by the shared <DateInput> below — never a
  // bare <input type="date"> (its full-screen native Android picker is
  // what we're eliminating). So this only covers number vs text.
  const inputType = field.type === 'number' ? 'number' : 'text';
  const inputDir  = field.dir || 'auto';

  return (
    <div
      className="rounded-2xl p-3 transition-all"
      style={{
        background: cardBg,
        border: `1.5px solid ${editing ? C.primary : cardBorder}`,
        boxShadow: editing ? `0 0 0 3px ${C.primary}10` : 'none',
      }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[11px] font-bold" style={{ color: C.gray500 }}>{field.label}</p>
        <div className="flex items-center gap-1.5">
          <Icon className="w-3.5 h-3.5" style={{ color: iconColor }} />
          {!editing && (
            <button
              onClick={onStartEdit}
              aria-label={`ערוך ${field.label}`}
              className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-black/5"
              style={{ color: C.gray500 }}
            >
              <Pencil className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {field.type === 'date' ? (
        // Date fields ALWAYS render the shared DateInput (typable
        // DD/MM/YYYY + in-app calendar popover on Android/Web, native
        // wheel on iOS) instead of the bare <input type="date"> whose
        // full-screen green Android picker we're replacing. It's its own
        // display + editor, so no view/edit toggle is needed here.
        <DateInput
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder || 'DD/MM/YYYY'}
        />
      ) : editing ? (
        <input
          type={inputType}
          dir={inputDir}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onStopEdit}
          onKeyDown={(e) => { if (e.key === 'Enter') onStopEdit(); }}
          autoFocus
          placeholder={field.placeholder || ''}
          className="w-full bg-transparent outline-none text-[14px] font-medium"
          style={{ color: C.gray800 }}
        />
      ) : (
        <p
          dir={inputDir}
          className="text-[14px] font-medium min-h-[20px]"
          style={{ color: filled ? C.gray800 : C.warn }}
        >
          {filled ? value : (field.placeholder || 'לא זוהה — מלא ידנית')}
        </p>
      )}
    </div>
  );
}
