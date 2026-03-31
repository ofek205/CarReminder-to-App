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

// Legacy exports kept for backward compat with DemoVehicleDetail
export const DEMO_MAINTENANCE_LOGS = DEMO_TREATMENTS.filter(t => t._type === 'maintenance');
export const DEMO_REPAIR_LOGS = DEMO_TREATMENTS.filter(t => t._type === 'repair');
