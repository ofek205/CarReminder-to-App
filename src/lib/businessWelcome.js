// Single source of truth for the "what your business account unlocks" feature
// list. Used in two places so they never drift:
//   1. The business-welcome email (src/pages/AdminBusinessRequests.jsx,
//      sent when an admin approves the workspace request).
//   2. The "request sent" confirmation modal (src/pages/CreateBusinessWorkspace.jsx,
//      shown right after the user submits the request).
//
// Benefit-led, pain-killing copy (not feature-led). Each entry: [title, desc].
// Order is intentional: setup → daily use → the equipment-breadth differentiator
// as the climax (#6). No em-dashes per house style.
export const BUSINESS_WELCOME_FEATURES = [
  ['כל הצי בלחיצה אחת', 'ייבא את כל הרכבים מאקסל או טבלה בבת אחת. לא צריך להזין אחד-אחד.'],
  ['ייפוי כוח לטסט, בלחיצה', 'הפק טופס ייפוי כוח ושלח מישהו לעשות טסט במקומך. בלי טפסים ידניים.'],
  ['חשבונית? צלם, וזהו', 'סריקת חשבוניות בצילום ודוחות כספיים מלאים. עלויות הצי ברורות בלי הקלדה.'],
  ['לכל נהג אפליקציה משלו', 'כל נהג נכנס ורואה רק את הרכבים והמשימות שלו. אתה שולט, הוא מבצע.'],
  ['תזכורות והתראות חכמות', 'טיפולים, טסט, חידוש ביטוח, ריקולים ופגי-תוקף מסמכים. אתה הראשון לדעת.'],
  ['כל הכלים, לא רק מכוניות', 'חיבור למשרד התחבורה למשאיות, טרקטורים, צמ"ה ואפילו גנרטורים. הכל מסונכרן.'],
];

// Brand tokens shared by both surfaces, so the email and the modal match.
export const BUSINESS_WELCOME_THEME = {
  heroBg:   '#16321E',  // deep forest green hero
  gold:     '#B5872E',  // accent on numbers (on white)
  goldSoft: '#D9B85C',  // accent on the dark hero
  title:    '#1C3620',
  body:     '#4B5563',
  hairline: '#EEF1EE',
  cta:      '#2D5233',
};
