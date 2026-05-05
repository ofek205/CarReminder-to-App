import React from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useAccessibility } from './AccessibilityContext';
import { RotateCcw, Minus, Plus, Check } from 'lucide-react';
import { toast } from 'sonner';

const FONT_MIN = -2;
const FONT_MAX = 5;

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
  const { settings, update, resetAll, savePreferences } = useAccessibility();

  // Explicit "save and close". settings already auto-persist on every
  // change, but users asked for a clear commit action. The button closes
  // the panel with a confirmation toast so the save is visible.
  const handleSave = () => {
    savePreferences();
    onOpenChange?.(false);
    toast.success('ההעדפות נשמרו');
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-80 p-0 flex flex-col" dir="rtl">
        <SheetHeader className="px-5 pt-5 pb-4 border-b border-gray-100">
          <SheetTitle className="text-right text-gray-900">הגדרות נגישות</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">

          {/*  Vision  */}
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
              {/* dir="ltr" forces LTR within the controls so the universal
                  number-line convention applies: minus on the LEFT, plus on
                  the RIGHT, dots ascending left-to-right (-2 → +5). Without
                  this, the parent RTL flexbox flips the dots opposite to the
                  buttons — pressing + visually moves the active dot LEFT
                  while pressing − moves it RIGHT, which feels reversed.
                  touch-manipulation disables iOS WebKit's double-tap-to-zoom
                  on rapid presses so the page doesn't zoom while the user
                  cycles through font sizes. */}
              <div dir="ltr" className="flex items-center gap-2">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-9 w-9 shrink-0 rounded-xl touch-manipulation"
                  disabled={settings.fontSize <= FONT_MIN}
                  onClick={() => update('fontSize', settings.fontSize - 1)}
                  aria-label="הקטן גופן"
                >
                  <Minus className="h-3.5 w-3.5" />
                </Button>
                <div className="flex-1 flex justify-center gap-1.5 overflow-hidden">
                  {[FONT_MIN, -1, 0, 1, 2, 3, 4, FONT_MAX].map(v => (
                    <button
                      key={v}
                      onClick={() => update('fontSize', v)}
                      className={`w-5 h-5 rounded-full text-[10px] transition-colors shrink-0 touch-manipulation ${
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
                  className="h-9 w-9 shrink-0 rounded-xl touch-manipulation"
                  disabled={settings.fontSize >= FONT_MAX}
                  onClick={() => update('fontSize', settings.fontSize + 1)}
                  aria-label="הגדל גופן"
                >
                  <Plus className="h-3.5 w-3.5" />
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

          {/*  Interaction  */}
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

          {/*  General  */}
          <div>
            <SectionTitle>כללי</SectionTitle>
            <ToggleRow
              label="ביטול אנימציות"
              description="הפסקת כל תנועות ומעברים"
              settingKey="disableAnimations"
            />
          </div>
        </div>

        {/* Save + Reset */}
        <div className="px-5 pb-5 pt-3 border-t border-gray-100 space-y-2">
          <Button
            className="w-full gap-2 bg-[#2D5233] hover:bg-[#1E3D24] text-white font-bold"
            onClick={handleSave}
          >
            <Check className="h-4 w-4" />
            שמור העדפות
          </Button>
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
