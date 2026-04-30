import React from 'react';
import { C } from '@/lib/designTokens';
import { ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function TermsOfService() {
  const navigate = useNavigate();
  return (
    <div dir="rtl" className="max-w-2xl mx-auto py-6 px-4">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 mb-4 text-sm font-bold" style={{ color: C.primary }}>
        <ArrowRight className="w-4 h-4" /> חזרה
      </button>
      <h1 className="text-2xl font-bold mb-6">תנאי שימוש - CarReminder</h1>
      <p className="text-xs mb-4" style={{ color: '#9CA3AF' }}>עודכן לאחרונה: אפריל 2026</p>

      <div className="space-y-5 text-sm leading-relaxed" style={{ color: '#374151' }}>
        <section>
          <h2 className="text-base font-bold mb-2">1. קבלת התנאים</h2>
          <p>השימוש באפליקציית CarReminder מהווה הסכמה לתנאים אלה. אם אינך מסכים - אנא הפסק להשתמש באפליקציה.</p>
        </section>

        <section>
          <h2 className="text-base font-bold mb-2">2. תיאור השירות</h2>
          <p>CarReminder היא אפליקציה לניהול כלי תחבורה (רכבים, אופנועים, כלי שייט, כלי שטח). השירות כולל:</p>
          <ul className="list-disc mr-5 mt-2 space-y-1">
            <li>תזכורות לטסט, ביטוח וטיפולים</li>
            <li>ניהול מסמכים ותמונות</li>
            <li>מעקב אחר קילומטראז' ושעות מנוע</li>
            <li>מפרט טכני מרשם הרכב</li>
            <li>קהילה ופורום שאלות</li>
            <li>תגובות AI אוטומטיות (ברוך המוסכניק לרכב, יוסי מומחה כלי שייט)</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold mb-2">3. רישום ואחריות</h2>
          <ul className="list-disc mr-5 space-y-1">
            <li>המשתמש אחראי לדיוק המידע שהוא מזין</li>
            <li>יש לשמור על סיסמה חזקה ולא לשתף אותה</li>
            <li>CarReminder אינה מחליפה ייעוץ מקצועי של מוסך או טכנאי</li>
            <li>תגובות AI הן הצעות בלבד - לא תחליף לאבחון מקצועי</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold mb-2">4. תוכן קהילה</h2>
          <ul className="list-disc mr-5 space-y-1">
            <li>המשתמש אחראי לתוכן שהוא מפרסם</li>
            <li>אסור לפרסם תוכן פוגעני, מאיים, גזעני, מיני או בלתי חוקי</li>
            <li>CarReminder רשאית להסיר תוכן שמפר תנאים אלה</li>
            <li>משתמשים יכולים לדווח על תוכן פוגעני ולחסום משתמשים</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold mb-2">5. הגבלת אחריות</h2>
          <p>CarReminder מסופקת "כמות שהיא" (AS IS). אנו לא אחראים על:</p>
          <ul className="list-disc mr-5 mt-2 space-y-1">
            <li>אי-דיוקים במידע ממשרד התחבורה</li>
            <li>תגובות AI שעלולות להיות לא מדויקות</li>
            <li>נזק שנגרם מאי-חידוש טסט/ביטוח בזמן</li>
            <li>תקלות טכניות או אובדן נתונים</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold mb-2">6. מחיקת חשבון</h2>
          <p>ניתן למחוק את החשבון ואת כל הנתונים בכל עת דרך "מחיקת חשבון" בהגדרות. המחיקה היא סופית ולא ניתנת לשחזור.</p>
        </section>

        <section>
          <h2 className="text-base font-bold mb-2">7. שינויים בתנאים</h2>
          <p>CarReminder רשאית לעדכן תנאים אלה. שימוש מתמשך לאחר עדכון מהווה הסכמה לתנאים המעודכנים.</p>
        </section>

        <section>
          <h2 className="text-base font-bold mb-2">8. צור קשר</h2>
          <p>לשאלות: <strong>support@car-reminder.app</strong></p>
        </section>
      </div>
    </div>
  );
}
