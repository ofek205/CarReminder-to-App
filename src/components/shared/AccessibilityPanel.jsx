import React from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useAccessibility } from './AccessibilityContext';
import { RotateCcw, Minus, Plus } from 'lucide-react';

const FONT_MIN = -2;
const FONT_MAX = 3;

function SectionTitle({ children }) {
  return (
    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
      {children}
    </p>
  );
}

function ToggleRow({ label, description, settingKey }) {
  const { settings, update } = useAccessibility();
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex-1 min-w-0">
        <Label className="text-sm font-medium text-gray-800 cursor-pointer">{label}</Label>
        {description && (
          <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        )}
      </div>
      <Switch
        checked={!!settings[settingKey]}
        onCheckedChange={val => update(settingKey, val)}
        aria-label={label}
      />
    </div>
  );
}

export default function AccessibilityPanel({ open, onOpenChange }) {
  const { settings, update, resetAll } = useAccessibility();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-80 p-0 flex flex-col" dir="rtl">
        <SheetHeader className="px-5 pt-5 pb-4 border-b border-gray-100">
          <SheetTitle className="text-right text-gray-900">הגדרות נגישות</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">

          {/* ── Vision ─────────────────────────────────────────── */}
          <div>
            <SectionTitle>ראייה</SectionTitle>

            {/* Font size */}
            <div className="py-2">
              <Label className="text-sm font-medium text-gray-800">גודל גופן</Label>
              <p className="text-xs text-gray-500 mt-0.5 mb-3">
                {settings.fontSize === 0
                  ? 'רגיל'
                  : settings.fontSize > 0
                  ? `+${settings.fontSize} רמות`
                  : `${settings.fontSize} רמות`}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-9 w-9 shrink-0 rounded-xl"
                  disabled={settings.fontSize >= FONT_MAX}
                  onClick={() => update('fontSize', settings.fontSize + 1)}
                  aria-label="הגדל גופן"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
                <div className="flex-1 flex justify-center gap-1.5 overflow-hidden">
                  {[FONT_MIN, -1, 0, 1, 2, FONT_MAX].map(v => (
                    <button
                      key={v}
                      onClick={() => update('fontSize', v)}
                      className={`w-5 h-5 rounded-full text-[10px] transition-colors shrink-0 ${
                        settings.fontSize === v
                          ? 'bg-[#2D5233] text-white scale-110'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                      aria-label={`גודל גופן ${v}`}
                    >
                      {v === 0 ? '●' : ''}
                    </button>
                  ))}
                </div>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-9 w-9 shrink-0 rounded-xl"
                  disabled={settings.fontSize <= FONT_MIN}
                  onClick={() => update('fontSize', settings.fontSize - 1)}
                  aria-label="הקטן גופן"
                >
                  <Minus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <Separator className="my-2" />

            <ToggleRow
              label="גופן קריא"
              description="שינוי לגופן Arial עם ריווח מוגבר"
              settingKey="readableFont"
            />
            <ToggleRow
              label="ריווח שורות"
              description="הגדלת המרחק בין השורות לקריאה נוחה"
              settingKey="lineSpacing"
            />
            <ToggleRow
              label="ניגודיות גבוהה"
              description="חיזוק הניגודיות לשיפור קריאות"
              settingKey="highContrast"
            />
            <ToggleRow
              label="היפוך צבעים"
              description="מצב כהה מותאם לרגישות לאור"
              settingKey="invertColors"
            />
            <ToggleRow
              label="שחור-לבן"
              description="הסרת צבעים לתצוגה נקייה"
              settingKey="blackAndWhite"
            />
          </div>

          {/* ── Interaction ─────────────────────────────────────── */}
          <div>
            <SectionTitle>אינטראקציה</SectionTitle>
            <ToggleRow
              label="הדגשת קישורים"
              description="סימון קישורים בקו תחתי ומסגרת"
              settingKey="highlightLinks"
            />
            <ToggleRow
              label="הדגשת פוקוס"
              description="מסגרת בולטת על האלמנט הנוכחי"
              settingKey="highlightFocus"
            />
          </div>

          {/* ── General ─────────────────────────────────────────── */}
          <div>
            <SectionTitle>כללי</SectionTitle>
            <ToggleRow
              label="ביטול אנימציות"
              description="הפסקת כל תנועות ומעברים"
              settingKey="disableAnimations"
            />
          </div>
        </div>

        {/* Reset */}
        <div className="px-5 pb-5 pt-3 border-t border-gray-100">
          <Button
            variant="outline"
            className="w-full gap-2 text-gray-600 hover:text-gray-900"
            onClick={resetAll}
          >
            <RotateCcw className="h-4 w-4" />
            איפוס כל ההגדרות
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
