/**
 * Demo vehicle data for guest users.
 * This data is shown to new guests to demonstrate the app's capabilities.
 * It is never written to the database and is fully isolated from real user data.
 */

export const DEMO_VEHICLE_ID = 'demo_vehicle_001';

export const DEMO_VEHICLE = {
  id: DEMO_VEHICLE_ID,
  _isDemo: true,
  vehicle_type: 'רכב',
  manufacturer: 'טויוטה',
  model: 'קורולה',
  year: 2016,
  nickname: 'הקורולה שלי',
  license_plate: '12-345-67',
  license_plate_normalized: '1234567',
  test_due_date: '2026-08-01',        // ~4 months ahead → status: ok
  insurance_due_date: '2026-09-15',   // ~6 months ahead → status: ok
  insurance_company: 'הראל',
  current_km: 148200,
  notes: 'רכב במצב טוב, משמש לנסיעות יומיות',
  vehicle_photo: '/demo-corolla.jpg',
  created_date: '2024-01-15T10:00:00.000Z',
};

/** Treatments – completed and upcoming */
export const DEMO_TREATMENTS = [
  {
    id: 'demo_treat_001',
    vehicle_id: DEMO_VEHICLE_ID,
    _type: 'maintenance',
    title: 'החלפת שמן',
    date: '2025-06-01',
    cost: 320,
    status: 'completed',
    notes: 'הוחלפו שמן מנוע ופילטר שמן',
  },
  {
    id: 'demo_treat_002',
    vehicle_id: DEMO_VEHICLE_ID,
    _type: 'repair',
    title: 'החלפת רפידות בלמים',
    date: '2025-01-15',
    cost: 850,
    status: 'completed',
    notes: 'הוחלפו רפידות בלמים קדמיים',
  },
  {
    id: 'demo_treat_003',
    vehicle_id: DEMO_VEHICLE_ID,
    _type: 'maintenance',
    title: 'טיפול שנתי',
    date: '2025-03-10',
    cost: 650,
    status: 'completed',
    notes: 'טיפול תקופתי מלא',
  },
  {
    id: 'demo_treat_004',
    vehicle_id: DEMO_VEHICLE_ID,
    _type: 'maintenance',
    title: 'החלפת שמן הבאה',
    date: '2026-09-01',
    cost: 350,
    status: 'upcoming',
    notes: 'החלפת שמן מתוכננת',
  },
  {
    id: 'demo_treat_005',
    vehicle_id: DEMO_VEHICLE_ID,
    _type: 'maintenance',
    title: 'בדיקת צמיגים',
    date: '2026-07-15',
    cost: 0,
    status: 'upcoming',
    notes: 'בדיקת לחץ ומצב צמיגים',
  },
];

/** Reminders */
export const DEMO_REMINDERS = [
  {
    id: 'demo_reminder_001',
    vehicle_id: DEMO_VEHICLE_ID,
    title: 'חידוש ביטוח',
    date: '2026-09-15',
    type: 'insurance',
  },
  {
    id: 'demo_reminder_002',
    vehicle_id: DEMO_VEHICLE_ID,
    title: 'טסט רכב',
    date: '2026-08-01',
    type: 'test',
  },
  {
    id: 'demo_reminder_003',
    vehicle_id: DEMO_VEHICLE_ID,
    title: 'החלפת שמן',
    date: '2026-09-01',
    type: 'maintenance',
  },
];

/** Documents */
export const DEMO_DOCUMENTS = [
  {
    id: 'demo_doc_001',
    title: 'פוליסת ביטוח',
    document_type: 'ביטוח',
    expiry_date: '2026-09-15',
    file_type: 'pdf',
    _isDemo: true,
  },
  {
    id: 'demo_doc_002',
    title: 'רישיון רכב',
    document_type: 'רישיון רכב',
    expiry_date: '2027-01-31',
    file_type: 'pdf',
    _isDemo: true,
  },
  {
    id: 'demo_doc_003',
    title: 'קבלת טיפול',
    document_type: 'קבלה',
    file_type: 'image',
    _isDemo: true,
  },
];

/** Demo accidents */
export const DEMO_ACCIDENTS = [
  {
    id: 'demo_accident_001',
    _isDemo: true,
    vehicle_id: DEMO_VEHICLE_ID,
    date: '2025-11-12',
    location: 'צומת עזריאלי, תל אביב',
    description: 'פגיעה אחורית בפקק תנועה. הרכב שמאחור לא בלם בזמן ופגע בפגוש האחורי. נגרם שריטות ושקע קל בפגוש. אין נפגעים.',
    status: 'סגור',
    other_driver_name: 'יוסי כהן',
    other_driver_phone: '050-1234567',
    other_driver_plate: '78-912-34',
    other_driver_manufacturer: 'יונדאי',
    other_driver_model: 'i30',
    other_driver_year: '2019',
    other_driver_insurance_company: 'מגדל',
    other_driver_insurance_company_other: '',
    other_driver_insurance_photo: '',
    photos: [
      'https://images.pexels.com/photos/1230677/pexels-photo-1230677.jpeg?auto=compress&cs=tinysrgb&w=400',
      'https://images.pexels.com/photos/1230677/pexels-photo-1230677.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop',
    ],
    created_date: '2025-11-12T14:30:00.000Z',
  },
  {
    id: 'demo_accident_002',
    _isDemo: true,
    vehicle_id: DEMO_VEHICLE_ID,
    date: '2026-02-20',
    location: 'רחוב אבן גבירול 42, תל אביב',
    description: 'שריטה בחניון קניון. רכב שחנה לידי פתח דלת ופגע בצד ימין של הרכב. שריטה באורך 30 ס"מ בדלת אחורית ימין.',
    status: 'בטיפול',
    other_driver_name: 'דנה לוי',
    other_driver_phone: '052-9876543',
    other_driver_plate: '56-432-10',
    other_driver_manufacturer: 'קיה',
    other_driver_model: 'ספורטאז\'',
    other_driver_year: '2021',
    other_driver_insurance_company: 'הפניקס',
    other_driver_insurance_company_other: '',
    other_driver_insurance_photo: '',
    photos: [
      'https://images.pexels.com/photos/1230677/pexels-photo-1230677.jpeg?auto=compress&cs=tinysrgb&w=500&h=350&fit=crop',
    ],
    created_date: '2026-02-20T09:15:00.000Z',
  },
];

/** Cork board sticky notes for demo car */
export const DEMO_CORK_NOTES = [
  {
    id: 'demo_note_001',
    vehicle_id: DEMO_VEHICLE_ID,
    title: 'החלפת שמן בעוד 3,000 ק"מ',
    content: 'לתאם עם המוסך של אבי ברחוב הרצל',
    color: 'yellow',
    rotation: -2,
    due_date: '2026-09-01',
    is_done: false,
    created_date: '2026-03-01T10:00:00.000Z',
  },
  {
    id: 'demo_note_002',
    vehicle_id: DEMO_VEHICLE_ID,
    title: 'לחדש ביטוח',
    content: 'לבדוק הצעות מחיר מ-3 חברות לפחות. ביטוח נגמר בספטמבר.',
    color: 'pink',
    rotation: 1.5,
    due_date: '2026-08-15',
    is_done: false,
    created_date: '2026-03-10T14:00:00.000Z',
  },
  {
    id: 'demo_note_003',
    vehicle_id: DEMO_VEHICLE_ID,
    title: 'בדיקת לחץ צמיגים',
    content: '',
    color: 'green',
    rotation: -1,
    is_done: true,
    created_date: '2026-02-20T08:00:00.000Z',
  },
  {
    id: 'demo_note_004',
    vehicle_id: DEMO_VEHICLE_ID,
    title: 'מספר מוסך: 03-6123456',
    content: 'מוסך שלמה — רחוב התעשייה 12, חולון. שעות: 08:00-17:00',
    color: 'blue',
    rotation: 2,
    is_done: false,
    created_date: '2026-01-15T12:00:00.000Z',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// ── Demo Vessel (Yacht / Sailboat) ──────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

export const DEMO_VESSEL_ID = 'demo_vessel_001';

export const DEMO_VESSEL = {
  id: DEMO_VESSEL_ID,
  _isDemo: true,
  vehicle_type: 'מפרשית',
  manufacturer: 'Beneteau',
  model: 'Oceanis 38.1',
  year: 2020,
  nickname: 'יאכטה נוני',
  license_plate: 'IL-4821',
  current_engine_hours: 620,
  notes: 'מפרשית 38 רגל, מנוע Yanmar 30HP, עגינה במרינה הרצליה. יאכטה נוני — הסירה של המשפחה.',
  vehicle_photo: 'https://images.pexels.com/photos/273886/pexels-photo-273886.jpeg?auto=compress&cs=tinysrgb&w=600',
  test_due_date: '2026-11-15',
  insurance_due_date: '2026-10-20',
  insurance_company: 'הכשרה',
  pyrotechnics_expiry_date: '2026-12-01',
  fire_extinguisher_expiry_date: '2027-03-15',
  life_raft_expiry_date: '2027-06-01',
  engine_manufacturer: 'Yanmar',
  last_shipyard_date: '2025-09-10',
  hours_since_shipyard: 180,
  created_date: '2023-06-01T10:00:00.000Z',
};

export const DEMO_VESSEL_TREATMENTS = [
  {
    id: 'demo_vt_001', vehicle_id: DEMO_VESSEL_ID, _type: 'maintenance',
    title: 'החלפת שמן מנוע + פילטרים', date: '2025-10-15', cost: 1200, status: 'completed',
    notes: 'שמן Yanmar, פילטר שמן, פילטר דלק, פילטר אוויר',
  },
  {
    id: 'demo_vt_002', vehicle_id: DEMO_VESSEL_ID, _type: 'maintenance',
    title: 'בדיקת מערכות חשמל', date: '2025-12-01', cost: 800, status: 'completed',
    notes: 'בדיקת מערכת טעינה, סוללות, תאורת ניווט',
  },
  {
    id: 'demo_vt_003', vehicle_id: DEMO_VESSEL_ID, _type: 'repair',
    title: 'תיקון מפרש ראשי', date: '2026-01-20', cost: 2500, status: 'completed',
    notes: 'קרע בגודל 40 ס"מ ליד הלאף. תופר ותוקן במפרשייה של עמי, הרצליה.',
  },
  {
    id: 'demo_vt_004', vehicle_id: DEMO_VESSEL_ID, _type: 'maintenance',
    title: 'העלאה למספנה — ניקוי תחתית', date: '2026-10-01', cost: 4500, status: 'upcoming',
    notes: 'ניקוי, צביעת אנטיפאולינג, בדיקת הגה ופרופלר',
  },
];

export const DEMO_VESSEL_ISSUES = [
  {
    id: 'demo_vi_001', vehicle_id: DEMO_VESSEL_ID,
    title: 'נזילה קלה בברז מים ראשי',
    description: 'טפטוף איטי מהברז הראשי במטבח. צריך להחליף אטם או את הברז כולו.',
    category: 'plumbing', priority: 'medium', status: 'open',
    created_date: '2026-03-01T10:00:00.000Z',
  },
  {
    id: 'demo_vi_002', vehicle_id: DEMO_VESSEL_ID,
    title: 'נורת ניווט ירכתיים לא עובדת',
    description: 'הנורה האחורית (לבנה) כבתה. יש לבדוק נורה ונתיך.',
    category: 'electrical', priority: 'high', status: 'in-progress',
    created_date: '2026-02-15T08:00:00.000Z',
  },
  {
    id: 'demo_vi_003', vehicle_id: DEMO_VESSEL_ID,
    title: 'צביעת ג\'לקוט — שריטות בצד ימין',
    description: 'שריטות שטחיות מעגינה. לא חמור אבל כדאי לטפל לפני החורף.',
    category: 'hull', priority: 'low', status: 'open',
    created_date: '2026-01-20T14:00:00.000Z',
  },
];

export const DEMO_VESSEL_CORK_NOTES = [
  {
    id: 'demo_vnote_001', vehicle_id: DEMO_VESSEL_ID,
    title: 'להזמין מקום במרינה לקיץ',
    content: 'מרינה הרצליה — לצלצל לרונית 09-9541234. מקדמה עד סוף אפריל.',
    color: 'blue', rotation: -1.5, due_date: '2026-04-30', is_done: false,
    created_date: '2026-03-15T10:00:00.000Z',
  },
  {
    id: 'demo_vnote_002', vehicle_id: DEMO_VESSEL_ID,
    title: 'לבדוק מצב חבלים',
    content: 'חבל עוגן ראשי + שני חבלי עגינה. להחליף אם בלויים.',
    color: 'orange', rotation: 2, is_done: false,
    created_date: '2026-03-10T09:00:00.000Z',
  },
  {
    id: 'demo_vnote_003', vehicle_id: DEMO_VESSEL_ID,
    title: 'אנטיפאולינג חדש',
    content: 'לקנות צבע International Micron Extra 2 — 2.5 ליטר',
    color: 'yellow', rotation: -2.5, due_date: '2026-09-15', is_done: false,
    created_date: '2026-02-01T12:00:00.000Z',
  },
];

export const DEMO_VESSEL_DOCUMENTS = [
  { id: 'demo_vdoc_001', title: 'רישיון שייט', document_type: 'רישיון רכב', expiry_date: '2026-11-15', file_type: 'pdf', _isDemo: true },
  { id: 'demo_vdoc_002', title: 'ביטוח ימי', document_type: 'ביטוח', expiry_date: '2026-10-20', file_type: 'pdf', _isDemo: true },
  { id: 'demo_vdoc_003', title: 'אישור מספנה', document_type: 'קבלה', file_type: 'pdf', _isDemo: true },
];

// Legacy exports kept for backward compat with DemoVehicleDetail
export const DEMO_MAINTENANCE_LOGS = DEMO_TREATMENTS.filter(t => t._type === 'maintenance');
export const DEMO_REPAIR_LOGS = DEMO_TREATMENTS.filter(t => t._type === 'repair');
