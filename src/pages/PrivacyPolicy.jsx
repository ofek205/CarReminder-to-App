import React from 'react';
import { C } from '@/lib/designTokens';
import { ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function PrivacyPolicy() {
  const navigate = useNavigate();
  return (
    <div dir="rtl" className="max-w-2xl mx-auto py-6 px-4">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 mb-4 text-sm font-bold" style={{ color: C.primary }}>
        <ArrowRight className="w-4 h-4" /> חזרה
      </button>
      <h1 className="text-2xl font-bold mb-6">מדיניות פרטיות - CarReminder</h1>
      <p className="text-xs mb-4" style={{ color: '#9CA3AF' }}>עודכן לאחרונה: אפריל 2026</p>

      <div className="space-y-5 text-sm leading-relaxed" style={{ color: '#374151' }}>
        <section>
          <h2 className="text-base font-bold mb-2">1. מידע שאנו אוספים</h2>
          <p>CarReminder אוספת את המידע הבא:</p>
          <ul className="list-disc mr-5 mt-2 space-y-1">
            <li><strong>פרטים אישיים:</strong> שם מלא, כתובת אימייל, מספר טלפון, תאריך לידה</li>
            <li><strong>פרטי רכב:</strong> מספר רישוי, יצרן, דגם, שנה, קילומטראז', תאריכי טסט וביטוח</li>
            <li><strong>מסמכים:</strong> תמונות רישיון נהיגה, ביטוח ומסמכי רכב שהועלו על ידך</li>
            <li><strong>פרטי כלי שייט:</strong> מספר זיהוי, מרינה, ציוד בטיחות</li>
            <li><strong>תוכן קהילה:</strong> פוסטים, תגובות, לייקים ותגובות אמוג'י</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold mb-2">2. כיצד אנו משתמשים במידע</h2>
          <ul className="list-disc mr-5 space-y-1">
            <li>שליחת תזכורות לטסט, ביטוח וטיפולים</li>
            <li>הצגת מפרט טכני של הרכב (ממאגר משרד התחבורה)</li>
            <li>מתן תגובות AI אוטומטיות בקהילה (ברוך המוסכניק לרכב, יוסי מומחה כלי שייט)</li>
            <li>שיפור השירות והחוויה באפליקציה</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold mb-2">3. שיתוף מידע</h2>
          <p>אנו <strong>לא מוכרים</strong> את המידע שלך. מידע משותף רק:</p>
          <ul className="list-disc mr-5 mt-2 space-y-1">
            <li>עם חברי חשבון משותף (אם הזמנת אותם)</li>
            <li>עם שירותי AI (Google Gemini) לצורך תגובות אוטומטיות - ללא מידע מזהה</li>
            <li>עם data.gov.il API לצורך שליפת מפרט טכני</li>
            <li>לפי דרישת חוק</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold mb-2">4. אחסון מידע</h2>
          <p>המידע שלך מאוחסן בשרתי Supabase (AWS) עם הצפנה. גישה מוגנת באמצעות Row Level Security (RLS) - כל משתמש רואה רק את המידע שלו.</p>
        </section>

        <section>
          <h2 className="text-base font-bold mb-2">5. הזכויות שלך</h2>
          <ul className="list-disc mr-5 space-y-1">
            <li><strong>צפייה:</strong> כל המידע שלך זמין באזור האישי</li>
            <li><strong>עריכה:</strong> ניתן לערוך כל פרט בכל עת</li>
            <li><strong>מחיקת נתונים:</strong> ניתן למחוק את כל הנתונים דרך "מחיקת חשבון"</li>
            <li><strong>מחיקת חשבון:</strong> ניתן למחוק את החשבון לצמיתות</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold mb-2">6. קהילה ותוכן משתמשים</h2>
          <p>פוסטים בקהילה גלויים לכל המשתמשים. ניתן לדווח על תוכן פוגעני ולחסום משתמשים. תוכן AI נוצר אוטומטית ומסומן בתווית "AI".</p>
        </section>

        <section>
          <h2 className="text-base font-bold mb-2">7. צור קשר</h2>
          <p>לשאלות בנושא פרטיות: <strong>support@car-reminder.app</strong></p>
        </section>
      </div>
    </div>
  );
}
