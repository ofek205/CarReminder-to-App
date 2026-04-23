/**
 * Popup catalog — admin-managed popup system.
 *
 * All the "pickable" values (categories, themes, sizes, triggers, etc) live
 * here so both the admin editor and the runtime agree on the vocabulary.
 *
 * Adding a new value is a 3-step change:
 *   1. Add to the constant here.
 *   2. Update the matching CHECK constraint in supabase-admin-popups.sql.
 *   3. Make sure the renderer / engine handle it (or at least fall back
 *      gracefully). See PopupRenderer / PopupEngine.
 */

import {
  Sparkles, Bell, Gift, Star, Heart, AlertTriangle, Info, CheckCircle,
  Wrench, Car, Ship, Calendar, Users, TrendingUp, Zap, Rocket, MessageCircle,
} from 'lucide-react';

//  Categories
export const CATEGORIES = [
  { value: 'engagement',   label: 'Engagement', hint: 'מעורבות משתמשים — דירוגים, סקרים, תזכורות חוויה' },
  { value: 'marketing',    label: 'Marketing',  hint: 'שיווק, מבצעים, הטבות' },
  { value: 'campaign',     label: 'Campaign',   hint: 'קמפיין מתוחם בזמן' },
  { value: 'announcement', label: 'Announcement', hint: 'הכרזה — פיצ\'ר חדש, עדכון מערכת' },
];

//  Statuses
export const STATUSES = [
  { value: 'draft',    label: 'טיוטה',   color: '#6B7280', bg: '#F3F4F6' },
  { value: 'active',   label: 'פעיל',    color: '#059669', bg: '#D1FAE5' },
  { value: 'paused',   label: 'מושהה',   color: '#D97706', bg: '#FEF3C7' },
  { value: 'archived', label: 'בארכיון', color: '#9CA3AF', bg: '#F9FAFB' },
];

//  Design themes
// Each theme defines the visual palette for the popup. The renderer maps
// these tokens to CSS. Keep the palette focused — more variants is more
// inconsistency in the product.
export const THEMES = [
  {
    value: 'brand',
    label: 'Brand (ירוק)',
    primary: '#2D5233',
    bg: 'linear-gradient(165deg, #1C3620 0%, #2D5233 45%, #4A8C5C 100%)',
    textOnBg: '#FFFFFF',
    accent: '#FFBF00',
  },
  {
    value: 'info',
    label: 'Info (כחול)',
    primary: '#2563EB',
    bg: 'linear-gradient(165deg, #1E3A8A 0%, #2563EB 100%)',
    textOnBg: '#FFFFFF',
    accent: '#93C5FD',
  },
  {
    value: 'success',
    label: 'Success (ירוק-בהיר)',
    primary: '#10B981',
    bg: 'linear-gradient(165deg, #065F46 0%, #10B981 100%)',
    textOnBg: '#FFFFFF',
    accent: '#A7F3D0',
  },
  {
    value: 'warning',
    label: 'Warning (כתום)',
    primary: '#D97706',
    bg: 'linear-gradient(165deg, #92400E 0%, #D97706 100%)',
    textOnBg: '#FFFFFF',
    accent: '#FDE68A',
  },
  {
    value: 'promo',
    label: 'Promo (סגול-ורוד)',
    primary: '#9333EA',
    bg: 'linear-gradient(165deg, #6B21A8 0%, #9333EA 50%, #EC4899 100%)',
    textOnBg: '#FFFFFF',
    accent: '#F9A8D4',
  },
];

export const themeByValue = (value) => THEMES.find(t => t.value === value) || THEMES[0];

//  Sizes
// Each size controls the layout frame (center modal vs banner vs toast).
export const SIZES = [
  { value: 'center',       label: 'חלון מרכזי',   hint: 'דיאלוג קלאסי במרכז המסך' },
  { value: 'bottom-sheet', label: 'Sheet תחתון', hint: 'נפתח מלמטה, חזק במובייל' },
  { value: 'top-banner',   label: 'באנר עליון',  hint: 'רצועה צרה בראש המסך' },
  { value: 'corner-toast', label: 'Toast פינה',  hint: 'קטן, לא חוסם — מתאים לדסקטופ' },
];

//  Triggers — when does the popup fire
export const TRIGGERS = [
  { value: 'on_login',      label: 'בהתחברות',       description: 'בטעינה הראשונה אחרי כניסה לחשבון' },
  { value: 'on_page_view',  label: 'בכניסה לעמוד',   description: 'כשהמשתמש מגיע לעמוד ספציפי' },
  { value: 'after_delay',   label: 'אחרי השהיה',     description: 'N שניות אחרי כניסה לאפליקציה' },
  { value: 'manual',        label: 'ידני בלבד',       description: 'לא נורה אוטומטית — רק דרך "הצג עכשיו"' },
];

// Pages the admin can target with on_page_view. Locked picklist instead of
// free text so typos don't silently disable a popup.
export const TARGETABLE_PAGES = [
  { value: '/Dashboard',      label: 'לוח בית' },
  { value: '/Vehicles',       label: 'רכבים' },
  { value: '/Documents',      label: 'מסמכים' },
  { value: '/AiAssistant',    label: 'מומחה AI' },
  { value: '/Community',      label: 'קהילה' },
  { value: '/FindGarage',     label: 'מצא מוסך' },
  { value: '/Notifications',  label: 'התראות' },
  { value: '/UserProfile',    label: 'פרופיל' },
  { value: '/AddVehicle',     label: 'הוספת רכב' },
];

//  Conditions
export const SEGMENTS = [
  { value: 'all',        label: 'כולם' },
  { value: 'car',        label: 'רכבים' },
  { value: 'motorcycle', label: 'אופנועים' },
  { value: 'truck',      label: 'משאיות' },
  { value: 'vessel',     label: 'כלי שייט' },
  { value: 'offroad',    label: 'כלי שטח' },
];

export const USER_TYPES = [
  { value: 'all',           label: 'כולם' },
  { value: 'authenticated', label: 'משתמשים רשומים' },
  { value: 'guest',         label: 'אורחים' },
];

export const HAS_VEHICLE_OPTIONS = [
  { value: null,  label: 'לא משנה' },
  { value: true,  label: 'יש רכב רשום' },
  { value: false, label: 'אין רכב רשום' },
];

//  Frequency
export const FREQUENCIES = [
  { value: 'once',          label: 'פעם אחת בלבד',        hint: 'למשתמש הזה, לעולם לא שוב' },
  { value: 'every_session', label: 'בכל סשן',            hint: 'פעם בכל פתיחה של האפליקציה' },
  { value: 'custom',        label: 'מותאם אישית',        hint: 'כל X ימים / עד N צפיות סה"כ' },
];

//  CTA actions — what happens when the primary button is clicked
export const CTA_ACTIONS = [
  { value: 'dismiss',   label: 'סגור בלבד',  needsTarget: false },
  { value: 'navigate',  label: 'נווט למסך',  needsTarget: true, targetLabel: 'יעד (נתיב)' },
  { value: 'external',  label: 'קישור חיצוני', needsTarget: true, targetLabel: 'URL מלא' },
];

//  Icons — locked picklist to keep the visual vocabulary tight
export const ICON_OPTIONS = [
  { value: 'Sparkles',     label: '✨ Sparkles',    icon: Sparkles },
  { value: 'Bell',         label: '🔔 Bell',        icon: Bell },
  { value: 'Gift',         label: '🎁 Gift',        icon: Gift },
  { value: 'Star',         label: '⭐ Star',        icon: Star },
  { value: 'Heart',        label: '💚 Heart',       icon: Heart },
  { value: 'AlertTriangle',label: '⚠️ Alert',       icon: AlertTriangle },
  { value: 'Info',         label: 'ℹ️ Info',         icon: Info },
  { value: 'CheckCircle',  label: '✅ Check',       icon: CheckCircle },
  { value: 'Wrench',       label: '🔧 Wrench',      icon: Wrench },
  { value: 'Car',          label: '🚗 Car',         icon: Car },
  { value: 'Ship',         label: '⛵ Ship',        icon: Ship },
  { value: 'Calendar',     label: '📅 Calendar',    icon: Calendar },
  { value: 'Users',        label: '👥 Users',       icon: Users },
  { value: 'TrendingUp',   label: '📈 Trending',    icon: TrendingUp },
  { value: 'Zap',          label: '⚡ Zap',          icon: Zap },
  { value: 'Rocket',       label: '🚀 Rocket',      icon: Rocket },
  { value: 'MessageCircle',label: '💬 Message',     icon: MessageCircle },
];

export const iconByValue = (value) => {
  const found = ICON_OPTIONS.find(i => i.value === value);
  return found ? found.icon : Sparkles;
};

//  Global engine throttle — at most one popup per this window
export const GLOBAL_THROTTLE_MINUTES = 15;
