import React, { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { BookOpen, ChevronLeft, ChevronDown, ChevronUp, Plus, Wrench, Droplet, Zap, Cog, Filter as FilterIcon, Eye } from 'lucide-react';
import { findManufacturerSchedule, splitScheduleByCurrentKm } from '@/data/manufacturerSchedules';
import { C } from '@/lib/designTokens';

/**
 * ManufacturerScheduleCard
 * ------------------------
 * Entry-card + bottom-sheet that surfaces the OEM maintenance schedule
 * for the user's vehicle. Renders nothing when:
 *   • the vehicle is a vessel (we don't curate marine schedules in v1)
 *   • the vehicle is a car/motorcycle but make+model+year don't match
 *     our curated data set
 *
 * That "render nothing" branch is intentional and required by the
 * product decision: «אם אין מידע, אל תציג כלום» — we'd rather hide the
 * surface than draw attention to a gap, which would erode trust.
 *
 * States the component handles:
 *   • happy        — schedule found + current km known → upcoming + past
 *   • no current km — schedule found but km is null → upcoming-only list,
 *                     no past collapsing, no progress indicator
 *   • dialog       — closed by default; user taps the entry card to open
 *
 * Theming uses inline tokens already present in MaintenanceSection (T)
 * so the card inherits the per-vehicle accent (green/marine/earth).
 */
export default function ManufacturerScheduleCard({ vehicle, theme, onAddReminder }) {
  const [open, setOpen] = useState(false);
  const [showPast, setShowPast] = useState(false);

  const lookup = useMemo(() => findManufacturerSchedule(vehicle), [vehicle]);
  const split = useMemo(
    () => (lookup ? splitScheduleByCurrentKm(lookup.matched.schedule, vehicle?.current_km) : null),
    [lookup, vehicle?.current_km],
  );

  // Hidden branch: no data → render nothing. This is the most important
  // contract of the component — see the file-level comment.
  if (!lookup) return null;

  const T = theme;
  const hasKm = Number.isFinite(Number(vehicle?.current_km));

  return (
    <>
      {/* Entry card — placed inside MaintenanceSection above the recent-
          activity list. Tap target spans the full row; the chevron is a
          visual cue, not the only hit area. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full text-right rounded-2xl p-3 flex items-center gap-3 active:scale-[0.98] transition-transform"
        style={{
          background: '#fff',
          border: `1.5px solid ${T?.border || '#E5E0D8'}`,
        }}
      >
        <div
          className="shrink-0 rounded-xl p-2 flex items-center justify-center"
          style={{ background: T?.primary || C.primary, color: '#fff' }}
          aria-hidden="true"
        >
          <BookOpen className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold" style={{ color: T?.text || C.text }}>
              טיפולים לפי ספר הרכב
            </span>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md" style={{ background: T?.primary || C.primary, color: '#fff' }}>
              חדש
            </span>
          </div>
          <div className="text-xs mt-0.5" style={{ color: T?.muted || C.gray500 }}>
            לוח טיפולים מומלץ של היצרן — {lookup.hebrewMakeName} {lookup.matched.model}
          </div>
        </div>
        <ChevronLeft className="w-5 h-5 shrink-0" style={{ color: T?.muted || C.gray500 }} aria-hidden="true" />
      </button>

      {/* Schedule dialog. We use Dialog (not Sheet) because the existing
          MaintenanceSection already uses Dialog for its log forms, which
          keeps the modal stack consistent on mobile — one dialog vocab,
          not two. */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-right">
              ספר טיפולים — {lookup.hebrewMakeName} {lookup.matched.model}
            </DialogTitle>
            <div className="text-xs text-right" style={{ color: T?.muted || C.gray500 }}>
              שנתון {lookup.matched.yearFrom}-{lookup.matched.yearTo}
              {hasKm && (
                <> · ק"מ נוכחי <b>{Number(vehicle.current_km).toLocaleString('he-IL')}</b></>
              )}
            </div>
          </DialogHeader>

          {/* Upcoming milestones — the actionable list. Sorted ascending by km. */}
          {split.upcoming.length === 0 ? (
            <div className="rounded-xl bg-gray-50 p-4 text-center text-sm text-gray-600">
              עברת את כל אבני הדרך המתועדות ב-v1.
              <br />
              המשך להחזיק במשטר טיפולים תקופתיים — כל 15K ק"מ או שנה.
            </div>
          ) : (
            <div className="space-y-2">
              {split.upcoming.map((item, idx) => (
                <MilestoneRow
                  key={`up-${idx}-${item.km}`}
                  item={item}
                  isNext={idx === 0}
                  T={T}
                  hasKm={hasKm}
                  currentKm={vehicle?.current_km}
                  source={lookup.matched.source}
                  onAddReminder={onAddReminder}
                />
              ))}
            </div>
          )}

          {/* Past milestones — collapsed by default. Helps the user mentally
              tick off what they've already done without dominating the view. */}
          {split.past.length > 0 && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowPast(v => !v)}
                className="w-full text-right text-xs flex items-center justify-between py-2 px-1"
                style={{ color: T?.muted || C.gray500 }}
              >
                <span>כבר עברתי ({split.past.length})</span>
                {showPast ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {showPast && (
                <div className="space-y-2 opacity-70">
                  {split.past.map((item, idx) => (
                    <MilestoneRow
                      key={`past-${idx}-${item.km}`}
                      item={item}
                      isNext={false}
                      T={T}
                      hasKm={hasKm}
                      currentKm={vehicle?.current_km}
                      source={lookup.matched.source}
                      onAddReminder={onAddReminder}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Legal disclaimer. Designer note: wrapped in a soft grey
              "trust block" (vs naked grey text) so it reads as an
              intentional honesty statement rather than fine print to
              skip. The exact copy here was vetted to balance liability
              cover with usability — do NOT edit this paragraph without
              product+legal review. */}
          <div className="mt-3 rounded-lg p-2.5" style={{ background: '#F5F5F4' }}>
            <p className="text-[12px] leading-relaxed text-right" style={{ color: '#57534E' }}>
              <b>המידע להתרשמות בלבד.</b> לוח הטיפולים מבוסס על המלצות יצרן פומביות שנאספו ונבדקו על ידינו,
              אך עשויות להיות אי-דיוקים, שינויים לפי דגם/שנתון/מנוע, או הנחיות מעודכנות יותר. <b>תמיד יש לבדוק
              את ספר הרכב המקורי ולהתייעץ עם מוסך מורשה.</b> האחריות לתחזוקת הרכב היא של בעל הרכב בלבד.
              CarReminder אינה אחראית לנזק שייגרם מהסתמכות על המידע כאן.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * MilestoneRow
 * ------------
 * One row of the schedule list. Renders the km marker, service icon,
 * Hebrew title + optional note, source attribution, and the
 * "הוסף תזכורת" call-to-action which seeds the existing MaintenanceDialog
 * with the milestone's km value via onAddReminder.
 */
function MilestoneRow({ item, isNext, T, hasKm, currentKm, source, onAddReminder }) {
  const Icon = serviceIcon(item.service);
  const kmFmt = item.km.toLocaleString('he-IL');
  const remaining = hasKm ? item.km - Number(currentKm) : null;
  const remainingText = remaining != null && remaining > 0
    ? `עוד ${remaining.toLocaleString('he-IL')} ק"מ`
    : null;

  return (
    <div
      className="rounded-xl p-3 flex flex-col gap-2"
      style={{
        background: isNext ? (T?.light || '#F0FDF4') : C.grayBg,
        border: `1px solid ${isNext ? (T?.primary || C.primary) : C.gray200}`,
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="shrink-0 rounded-lg p-2 flex items-center justify-center"
          style={{
            background: isNext ? (T?.primary || C.primary) : C.gray200,
            color: isNext ? '#fff' : C.gray500,
          }}
          aria-hidden="true"
        >
          <Icon className="w-4 h-4" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold" style={{ color: T?.text || C.text }}>
              {kmFmt} ק"מ
            </span>
            {item.months && (
              <span className="text-xs" style={{ color: T?.muted || C.gray500 }}>או {item.months} חודשים</span>
            )}
            {remainingText && (
              <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-md" style={{ background: T?.primary || C.primary, color: '#fff' }}>
                {remainingText}
              </span>
            )}
          </div>
          <div className="text-sm mt-0.5 font-medium" style={{ color: T?.text || C.text }}>
            {item.title}
          </div>
          {item.note && (
            <div className="text-xs mt-0.5" style={{ color: T?.muted || C.gray500 }}>{item.note}</div>
          )}
          <div className="text-[10px] mt-1" style={{ color: T?.muted ? `${T.muted}99` : C.gray400 }}>מקור: {source}</div>
        </div>
      </div>

      {onAddReminder && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onAddReminder(item)}
          className="self-end h-9 text-xs"
        >
          <Plus className="w-3.5 h-3.5 me-1" />
          הוסף תזכורת
        </Button>
      )}
    </div>
  );
}

function serviceIcon(code) {
  switch (code) {
    case 'oil':          return Droplet;
    case 'plugs':        return Zap;
    case 'belt':         return Cog;
    case 'brakes':       return Wrench;
    case 'fluid':        return Droplet;
    case 'filter':       return FilterIcon;
    case 'transmission': return Cog;
    case 'inspection':   return Eye;
    default:             return Wrench;
  }
}
