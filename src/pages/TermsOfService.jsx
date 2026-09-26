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
      <p className="text-xs mb-4" style={{ color: C.gray400 }}>עודכן לאחרונה: ספטמבר 2026</p>

      <div className="space-y-5 text-sm leading-relaxed" style={{ color: C.gray700 }}>
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
          <h2 className="text-base font-bold mb-2">6. גישת צוות התמיכה לחשבון</h2>
          <p>לצורך מתן תמיכה, פתרון תקלות וסיוע בהקמת נתונים, צוות מורשה של CarReminder רשאי לגשת לחשבונך ולצפות או לערוך בו נתונים (כגון כלי תחבורה ומסמכים) מטעמך. גישה כזו:</p>
          <ul className="list-disc mr-5 mt-2 space-y-1">
            <li>מוגבלת בזמן ומשמשת אך ורק למטרות תפעול ותמיכה</li>
            <li>מתועדת ביומן פנימי (מי ניגש, מתי ולאיזה חשבון)</li>
            <li>אינה כוללת צפייה בסיסמתך</li>
          </ul>
          <p className="mt-2">המשך השימוש בשירות מהווה הסכמה לכך. אם אינך מעוניין בגישת תמיכה לחשבונך, ניתן לפנות אלינו.</p>
        </section>

        {/*
          ⚠️ NO STORE OR PLATFORM IS NAMED IN THIS SECTION, ON PURPOSE. This
          page opens inside the iPhone app from the links under the purchase
          button, and Guideline 2.3.10 forbids naming another mobile platform
          in an iOS app. "חנות האפליקציות של הטלפון" covers both stores with
          one legal text instead of two that could drift apart.

          ⚠️ EVERY SENTENCE DESCRIBES WHAT THE CODE DOES TODAY: cancellation
          takes effect at the end of the paid period, nothing is deleted when a
          subscription ends (revoke_iap_entitlement drops to free), one account
          is never offered a second store's purchase (isStoreManaged). Change
          the behaviour and this section changes with it.

          Wording approved by Ofek on 2026-09-26. Legal text: reword only with
          his approval, not as a copy edit.
        */}
        <section>
          <h2 className="text-base font-bold mb-2">7. מסלולים, מנויים ותשלום</h2>
          <div className="space-y-2">
            <p><strong>7.1 המסלולים.</strong> השימוש הבסיסי באפליקציה אינו כרוך בתשלום. בנוסף למסלול החינמי קיימים מסלולים בתשלום, שמרחיבים את המגבלות של החשבון, כגון מספר כלי התחבורה והמסמכים שאפשר לשמור. מה שכלול בכל מסלול, והמחיר שלו, מוצגים במסך המסלולים שבאפליקציה לפני הרכישה.</p>
            <p><strong>7.2 רכישה דרך חנות האפליקציות.</strong> מנוי נרכש בתוך האפליקציה בלבד, דרך חנות האפליקציות של הטלפון. התשלום מבוצע ומעובד על ידי החנות ובהתאם לתנאים שלה, ופרטי אמצעי התשלום אינם מגיעים אלינו. המחיר שמוצג בחלון התשלום של החנות הוא המחיר שייגבה.</p>
            <p><strong>7.3 חידוש אוטומטי.</strong> המנוי חודשי ומתחדש אוטומטית בכל חודש, באותו מחיר, עד שהוא מבוטל. החיוב הראשון מתבצע באישור הרכישה, וכל חידוש מחויב לחשבון החנות שלך בסמוך לסוף התקופה. כדי שהחידוש הבא לא יחויב, יש לבטל לפחות 24 שעות לפני סוף התקופה הנוכחית.</p>
            <p><strong>7.4 ביטול.</strong> אפשר לבטל בכל עת, בהגדרות המנויים של חנות האפליקציות בטלפון שבו נרכש המנוי. באפליקציה יש גם קיצור דרך לשם, במסך "המסלול והחיוב". ביטול נכנס לתוקף בסוף התקופה ששולמה, ועד אז המסלול נשאר פעיל. מחיקת האפליקציה מהטלפון, או מחיקת החשבון באפליקציה, אינן מבטלות את המנוי בחנות.</p>
            <p><strong>7.5 החזרים.</strong> בקשה להחזר כספי מוגשת לחנות שבה בוצעה הרכישה ומטופלת לפי המדיניות שלה. אין בסעיף זה כדי לגרוע מזכויות שעומדות לך לפי חוק הגנת הצרכן.</p>
            <p><strong>7.6 מעבר בין מסלולים.</strong> מעבר בין מסלולים כפוף לאפשרויות של החנות. כשהחנות מאפשרת זאת, מעבר למסלול יקר יותר מתחיל מיד, ומעבר למסלול זול יותר מתחיל בחידוש הבא. אם המעבר אינו אפשרי מתוך החנות, מבטלים את המנוי הקיים ובוחרים מסלול חדש בסוף התקופה ששולמה.</p>
            <p><strong>7.7 סיום המנוי.</strong> כשמנוי מסתיים, מכל סיבה שהיא, החשבון עובר למסלול החינמי. שום מידע לא נמחק והתזכורות ממשיכות: כלי התחבורה והמסמכים שכבר בחשבון נשארים בו, ורק הוספה מעבר למגבלות המסלול החינמי לא תתאפשר.</p>
            <p><strong>7.8 מנוי אחד לחשבון.</strong> מנוי שייך לחשבון באפליקציה שבו נרכש, ואינו משותף עם בני משפחה דרך שיתוף משפחתי של החנות. לחשבון שיש לו מנוי פעיל בחנות אחת לא נציע מנוי נוסף בחנות אחרת. אם בכל זאת נרכשו שני מנויים לאותו חשבון, יש לבטל אחד מהם בחנות שבה נרכש ולפנות אלינו.</p>
            <p><strong>7.9 שינויים במחירים ובמסלולים.</strong> אנו רשאים לשנות מחירים ואת מה שכלול במסלולים. שינוי מחיר יחול רק מהחידוש שאחרי ההודעה עליו, והחנות תבקש את הסכמתך כשהדין או החנות מחייבים זאת. שינוי שמצמצם מסלול בתשלום יחול מתקופת החיוב הבאה, ונודיע עליו מראש.</p>
          </div>
        </section>

        <section>
          <h2 className="text-base font-bold mb-2">8. מחיקת חשבון</h2>
          <p>ניתן למחוק את החשבון ואת כל הנתונים בכל עת דרך "מחיקת חשבון" בהגדרות. המחיקה היא סופית ולא ניתנת לשחזור.</p>
          <p className="mt-2">מחיקת החשבון אינה מבטלת מנוי בתשלום. יש לבטל אותו קודם בחנות שבה נרכש, כמפורט בסעיף 7.4.</p>
        </section>

        <section>
          <h2 className="text-base font-bold mb-2">9. שינויים בתנאים</h2>
          <p>CarReminder רשאית לעדכן תנאים אלה. שימוש מתמשך לאחר עדכון מהווה הסכמה לתנאים המעודכנים.</p>
        </section>

        <section>
          <h2 className="text-base font-bold mb-2">10. צור קשר</h2>
          <p>לשאלות: <strong>support@car-reminder.app</strong></p>
        </section>
      </div>
    </div>
  );
}
