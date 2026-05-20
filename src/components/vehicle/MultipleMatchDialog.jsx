import React, { useEffect } from 'react';
import { Car, Construction, Info } from 'lucide-react';

/**
 * MultipleMatchDialog
 *
 * Surfaced when a license-plate lookup returns the same digits in TWO
 * different MoT registries (a namespace collision — e.g. plate 229080
 * = 1965 Triumph Herald in `rechev_le_pail_without-degem` AND 2024
 * SCHMIDT street sweeper in CME). The user picks the one they actually
 * own; the caller wires the chosen `match.fields` into its form.
 *
 * Props:
 *   - open:      boolean — whether the dialog should render
 *   - plate:     string  — license-plate digits, displayed in the title
 *   - matches:   array of { source, fields } from lookupVehicleByPlate's
 *                _multipleMatches structure (fields must include
 *                _detectedType / _detectedTypeLabel)
 *   - onChoose:  (index) => void — fired when the user picks a card
 *   - onCancel:  () => void     — fired on backdrop click / ESC / cancel link
 *   - questionCopy: string — context-specific question shown in the body.
 *                           Defaults to "איזה מהם הרכב שלך?" — pass
 *                           "איזה מהם הרכב שמעורב בתאונה?" from AddAccident etc.
 *   - cancelCopy:   string — context-specific cancel-link text. Defaults
 *                            to the standard "אף אחד מאלה לא הרכב שלי".
 *   - titleId:   string — unique id for aria-labelledby (must be unique
 *                         per dialog instance on the page)
 *
 * Behaviour:
 *   - Backdrop click → onCancel
 *   - ESC key → onCancel (registered only while open; cleaned up on close)
 *   - Each card is the full tap target (mobile-friendly), with focus
 *     ring for keyboard a11y and active scale for tactile feedback.
 *   - Category color coding: green for car/collector, amber for CME,
 *     icon (lucide Car or Construction) mirrors the category badge color.
 *
 * Visual register: INFO (sky-blue header icon), deliberately NOT a
 * warning. This is a clarification — "we found two, pick one" — not an
 * error.
 */
export default function MultipleMatchDialog({
  open,
  plate,
  matches,
  onChoose,
  onCancel,
  questionCopy = 'איזה מהם הרכב שלך?',
  cancelCopy = 'אף אחד מאלה לא הרכב שלי',
  titleId = 'multimatch-title',
}) {
  // ESC closes the dialog. Effect runs only while open so we don't
  // permanently attach a window listener.
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => {
      if (e.key === 'Escape') onCancel?.();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  if (!open || !matches || matches.length === 0) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel?.(); }}
    >
      <div className="bg-white rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto"
          style={{ background: '#DBEAFE' }}
        >
          <Info className="w-7 h-7" style={{ color: '#1E40AF' }} />
        </div>
        <div className="text-center space-y-2">
          <h2 id={titleId} className="text-lg font-bold" style={{ color: '#1C2E20' }}>
            נמצאו 2 רכבים עם אותה לוחית
          </h2>
          <p className="text-sm leading-relaxed" style={{ color: '#6B7280' }}>
            המספר{' '}
            <span
              dir="ltr"
              className="inline-block px-2 py-0.5 rounded-md font-mono font-bold align-middle"
              style={{ background: '#F4F7F3', color: '#2D5233' }}
            >
              {plate}
            </span>
            {' '}רשום במשרד התחבורה כשני רכבים שונים. {questionCopy}
          </p>
        </div>
        <div className="space-y-2.5">
          {matches.map((m, idx) => {
            const isCme = m.fields?._detectedType === 'cme';
            const tint = isCme
              ? { bg: '#FEF3C7', text: '#92400E' }
              : { bg: '#E8F2EA', text: '#1C3620' };
            const Icon = isCme ? Construction : Car;
            const titleParts = [m.fields?.manufacturer, m.fields?.model].filter(Boolean).join(' ').trim();
            const metaParts = [m.fields?.year, m.fields?.fuel_type || m.fields?.country_of_origin].filter(Boolean).join(' · ');
            const ariaLabel = `בחר ${titleParts || 'רכב'}${m.fields?.year ? ` ${m.fields.year}` : ''}, ${m.fields?._detectedTypeLabel || ''}`.trim();
            return (
              <button
                key={idx}
                type="button"
                onClick={() => onChoose(idx)}
                aria-label={ariaLabel}
                className="w-full text-right p-4 rounded-2xl transition-all active:scale-[0.98] hover:bg-[#F4F7F3] focus:outline-none focus:ring-2 focus:ring-green-700"
                style={{ background: '#fff', border: '1.5px solid #E5E7EB' }}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center"
                    style={{ background: tint.bg }}
                  >
                    <Icon className="w-5 h-5" style={{ color: tint.text }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm truncate" style={{ color: '#1C2E20' }}>
                      {titleParts || 'פרטי רכב חסרים'}
                    </div>
                    {metaParts && (
                      <div className="text-xs mt-0.5" style={{ color: '#6B7280' }}>
                        {metaParts}
                      </div>
                    )}
                    <span
                      className="inline-block mt-1.5 px-2 py-0.5 rounded-lg text-[11px] font-bold"
                      style={{ background: tint.bg, color: tint.text }}
                    >
                      {m.fields?._detectedTypeLabel || 'רכב'}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="w-full py-2 text-xs font-medium transition-colors"
          style={{ color: '#DC2626' }}
        >
          {cancelCopy}
        </button>
      </div>
    </div>
  );
}
