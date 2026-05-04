// SVG paths for each stop_type, drawn into the 38px circular DivIcon
// MapCore renders. White stroke on the route's color, viewBox 24×24.
//
// Picked to read at small marker size:
//   pickup           — package being lifted (box + arrow)
//   delivery         — truck silhouette
//   meeting          — two people
//   inspection       — clipboard with check
//   vehicle_service  — wrench
//   other / unset    — neutral hollow dot (FALLBACK_ICON below)
//
// We never render a sequence-number marker on the map any more — that
// proved confusing because numbers and "type" felt like two competing
// signals. Every marker now gets an icon: a specific one when
// stop_type is known, or a small neutral dot when it isn't.

const FALLBACK_ICON = `<circle cx="12" cy="12" r="4"/>`;

export const STOP_TYPE_ICON_SVG = {
  pickup:
    `<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>`,
  delivery:
    `<path d="M5 18H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v11h6"/><path d="M14 9h4l3 3v6h-4"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>`,
  meeting:
    `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,
  inspection:
    `<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 12 2 2 4-4"/><rect width="8" height="4" x="8" y="2" rx="1"/>`,
  vehicle_service:
    `<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>`,
  // 'other' stays as null in this map so popup labels can detect the
  // explicit choice. The function below converts both null and missing
  // to the neutral fallback icon.
  other: null,
};

export function iconSvgForStopType(stopType) {
  if (!stopType) return FALLBACK_ICON;
  return STOP_TYPE_ICON_SVG[stopType] || FALLBACK_ICON;
}

export const STOP_TYPE_LABEL = {
  pickup:          'איסוף',
  delivery:        'מסירה',
  meeting:         'פגישה',
  inspection:      'בדיקה',
  vehicle_service: 'טיפול ברכב',
  other:           'אחר',
};
