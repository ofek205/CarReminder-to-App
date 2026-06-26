/**
 * Forms catalog — the registry behind the "טפסים" library.
 *
 * v1 ships a single live template (power-of-attorney). The catalog is
 * deliberately data-driven so adding a future form (license renewal,
 * ownership transfer, …) is a config entry + a render component, not a
 * new page. Each entry:
 *
 *   id        — URL key (?form=<id>) and analytics label.
 *   title     — card title.
 *   subtitle  — one-line description.
 *   icon      — lucide icon name string (mapped to a component in the UI).
 *   status    — 'live' | 'soon'. 'soon' cards render disabled.
 *   accounts  — which account types it applies to ('personal' | 'business').
 */

export const FORMS_CATALOG = [
  {
    id: 'poa',
    title: 'ייפוי כוח לרישוי רכב',
    subtitle: 'הסמכת אדם לטפל בטסט או ברישוי של רכב שאינו שלו — מופק מוכן להדפסה וחתימה.',
    icon: 'FileSignature',
    status: 'live',
    accounts: ['personal', 'business'],
  },
  {
    id: 'sale_contract',
    title: 'העברת בעלות רכב – זכרון דברים',
    subtitle: 'זכרון דברים בין מוכר לקונה להעברת בעלות — פרטי הרכב, מחיר ותנאי תשלום, מוכן להדפסה וחתימה.',
    icon: 'Handshake',
    status: 'live',
    accounts: ['personal', 'business'],
  },
  // Placeholder communicates that this is a growing library, not a one-off
  // screen. Flip to status:'live' + add a render component when it lands.
  {
    id: 'license_renewal',
    title: 'בקשה לחידוש רישיון',
    subtitle: 'בקרוב',
    icon: 'FileText',
    status: 'soon',
    accounts: ['personal', 'business'],
  },
];

export function getForm(id) {
  return FORMS_CATALOG.find((f) => f.id === id) || null;
}
