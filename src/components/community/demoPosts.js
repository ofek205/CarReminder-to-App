/**
 * Demo posts for the Community feed.
 * Shown to all users (guest + auth) to make the forum feel alive.
 * Real posts from Supabase are merged on top.
 */

export const DEMO_POSTS_VEHICLE = [
  {
    id: 'demo_vp_1', _isDemo: true,
    user_id: 'demo_user_1',
    author_name: 'דני כהן',
    domain: 'vehicle',
    body: 'יש לי טויוטה קורולה 2018 עם 120,000 ק"מ. בזמן האחרון אני שומע רעש מהבלמים כשאני בולם בחזקה. האם זה נורמלי או שצריך להחליף רפידות?',
    image_url: null,
    linked_vehicle_id: null,
    created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
  },
  {
    id: 'demo_vp_2', _isDemo: true,
    user_id: 'demo_user_2',
    author_name: 'מיכל לוי',
    domain: 'vehicle',
    body: 'שלום לכולם! 🙋‍♀️ אני צריכה עזרה — יש לי יונדאי טוסון 2021 והמזגן מפסיק לקרר אחרי כ-20 דקות נסיעה. בעל המוסך אמר שצריך למלא גז, אבל זה כבר הפעם השלישית בשנה. מישהו חווה משהו דומה?',
    image_url: null,
    linked_vehicle_id: null,
    created_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'demo_vp_3', _isDemo: true,
    user_id: 'demo_user_3',
    author_name: 'אבי ישראלי',
    domain: 'vehicle',
    body: 'עשיתי טסט אתמול ונפלתי על פליטת גזים. הרכב מאזדה 3 2016. המוסכניק אומר שצריך להחליף קטליזטור — עלות 3,500 ₪. זה נשמע סביר?',
    image_url: null,
    linked_vehicle_id: null,
    created_at: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'demo_vp_4', _isDemo: true,
    user_id: 'demo_user_4',
    author_name: 'שרה גולדשטיין',
    domain: 'vehicle',
    body: 'נורית Check Engine נדלקה לי בקיה ריו 2019. הרכב נוסע רגיל, אין שינוי בביצועים. האם אפשר להמשיך לנסוע או שצריך לעצור מיד?',
    image_url: null,
    linked_vehicle_id: null,
    created_at: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'demo_vp_5', _isDemo: true,
    user_id: 'demo_user_5',
    author_name: 'רון אברהם',
    domain: 'vehicle',
    body: 'אני מחפש המלצה לביטוח מקיף לסקודה אוקטביה 2022. מישהו יכול להמליץ על חברת ביטוח עם שירות טוב ומחיר סביר? כרגע אני בהראל ומשלם 4,200 ₪ לשנה.',
    image_url: null,
    linked_vehicle_id: null,
    created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

export const DEMO_POSTS_VESSEL = [
  {
    id: 'demo_vs_1', _isDemo: true,
    user_id: 'demo_user_6',
    author_name: 'גיל ימי',
    domain: 'vessel',
    body: 'יש לי Beneteau Oceanis 38.1 והמנוע Yanmar מתקשה להתניע בבקרים. אחרי 2-3 ניסיונות הוא תופס. האם זו בעיית מצבר או משהו יותר רציני?',
    image_url: null,
    linked_vehicle_id: null,
    created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'demo_vs_2', _isDemo: true,
    user_id: 'demo_user_7',
    author_name: 'נועה שייט',
    domain: 'vessel',
    body: 'מתי עשיתם אנטי-פאולינג אחרון? אני חושבת לעשות את התחתית לפני העונה. יש המלצה על חומר טוב שמחזיק מעמד?',
    image_url: null,
    linked_vehicle_id: null,
    created_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'demo_vs_3', _isDemo: true,
    user_id: 'demo_user_8',
    author_name: 'עמית קפטן',
    domain: 'vessel',
    body: 'שלום! מחפש מרינה בהרצליה עם מקום פנוי לסירה 32 רגל. מישהו יודע מה המצב שם? כמה עולה חודש עגינה?',
    image_url: null,
    linked_vehicle_id: null,
    created_at: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'demo_vs_4', _isDemo: true,
    user_id: 'demo_user_9',
    author_name: 'יוסי מפרש',
    domain: 'vessel',
    body: 'הפירוטכניקה שלי פגה בעוד חודש. איפה הכי זול לקנות סט חדש? ראיתי ב-Sea Shop באשדוד אבל רציתי לבדוק אם יש עוד אופציות.',
    image_url: null,
    linked_vehicle_id: null,
    created_at: new Date(Date.now() - 1.5 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'demo_vs_5', _isDemo: true,
    user_id: 'demo_user_10',
    author_name: 'דנה אנקור',
    domain: 'vessel',
    body: 'מישהו מכיר טכנאי חשמל ימי טוב באזור חיפה? יש לי בעיה עם מערכת הנווט — המסך כבה לפעמים באמצע הפלגה.',
    image_url: null,
    linked_vehicle_id: null,
    created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

export const DEMO_COMMENTS = {
  'demo_vp_1': [
    { id: 'demo_vc_1', post_id: 'demo_vp_1', user_id: 'demo_ai', author_name: '🔧 יוסי המוסכניק', body: 'רעש בבלימה חזקה בדרך כלל מעיד על רפידות שחוקות. ב-120K ק"מ זה הגיוני מאוד. אני ממליץ לבדוק את עובי הרפידות — אם הן מתחת ל-3 מ"מ, הגיע הזמן להחליף. עלות ממוצעת: 400-800 ₪ לציר. אל תדחה את זה — בלמים זה בטיחות.', is_ai: true, created_at: new Date(Date.now() - 1.9 * 60 * 60 * 1000).toISOString() },
    { id: 'demo_vc_2', post_id: 'demo_vp_1', user_id: 'demo_user_11', author_name: 'מוטי מכונאי', body: 'היה לי בדיוק אותו דבר בקורולה שלי. החלפתי רפידות ודיסקים וזה נפתר מיד. הלכתי למוסך שני ושילמתי 650 ₪ הכל כולל.', is_ai: false, created_at: new Date(Date.now() - 1.5 * 60 * 60 * 1000).toISOString() },
  ],
  'demo_vp_2': [
    { id: 'demo_vc_3', post_id: 'demo_vp_2', user_id: 'demo_ai', author_name: '🔧 יוסי המוסכניק', body: 'אם ממלאים גז מזגן 3 פעמים בשנה — יש נזילה. צריך לעשות בדיקת לחץ עם צבע UV כדי לאתר את מקום הנזילה. ברוב המקרים זה O-ring או צנרת שנשחקה. תיקון הנזילה עצמה עולה 300-600 ₪ + מילוי גז 250 ₪.', is_ai: true, created_at: new Date(Date.now() - 4.5 * 60 * 60 * 1000).toISOString() },
  ],
  'demo_vp_3': [
    { id: 'demo_vc_4', post_id: 'demo_vp_3', user_id: 'demo_ai', author_name: '🔧 יוסי המוסכניק', body: '3,500 ₪ לקטליזטור במאזדה 3 זה מחיר סביר אם מדובר בקטליזטור מקורי. אפשר למצוא תחליפי (aftermarket) ב-1,500-2,500 ₪. שאל את המוסך אם זה מקורי או תואם. חשוב: בלי קטליזטור תקין לא תעבור טסט.', is_ai: true, created_at: new Date(Date.now() - 7.5 * 60 * 60 * 1000).toISOString() },
  ],
  'demo_vs_1': [
    { id: 'demo_vc_5', post_id: 'demo_vs_1', user_id: 'demo_ai', author_name: '⚓ יוסי מומחה כלי שייט', body: 'התנעה קשה בבוקר ב-Yanmar לרוב מצביעה על אחד מהבאים: 1) מצבר חלש — בדוק מתח (צריך להיות מעל 12.4V) 2) פילטר דלק סתום 3) אוויר במערכת הדלק. תתחיל ממצבר — זה הכי פשוט וזול לבדוק.', is_ai: true, created_at: new Date(Date.now() - 2.5 * 60 * 60 * 1000).toISOString() },
  ],
};
