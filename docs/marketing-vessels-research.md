# מחקר יכולות כלי שיט, 9 בספטמבר 2026

העמוד /website/vessels הורחב לפי מימוש קיים בקוד. בדיקה סטטית בלבד, ללא שינוי נתוני משתמשים או אימות שירותי שרת בחשבון אמיתי.

| יכולת | מקור |
| --- | --- |
| כושר שיט, חידוש מסמך וקישור ממשלתי | src/components/vehicle/VehicleInfoSection.jsx |
| ביטוח, פירוטכניקה, כמה מטפים, אסדת הצלה ומוכנות לבדיקה | src/components/vehicle/VehicleInfoSection.jsx; src/pages/EditVehicle.jsx |
| שעות מנוע ורישום שעות בטיפול | src/pages/EditVehicle.jsx; src/components/vehicle/MaintenanceDialog.jsx |
| מספנה ותאריך ביקור | src/pages/EditVehicle.jsx |
| בדיקות מנוע, לפני יציאה וסיום | src/pages/Checklist.jsx; src/lib/checklistTemplates.js; src/pages/VehicleDetail.jsx |
| תקלות, עדיפות, סטטוס ותאריך יעד | src/components/vehicle/VesselIssueDialog.jsx; src/components/vehicle/VesselIssuesSection.jsx |
| סריקת רישום, תוקף, שם, אורך ומנוע | src/components/vehicle/VesselScanWizard.jsx |
| תזכורות תוקף ציוד | src/components/shared/ReminderEngine.js |

לא הובטחה קריאה אוטומטית של מונה שעות, אישור כשירות או חידוש אוטומטי. לא הובטחה התראה נפרדת לכל מטף: תצוגת המידע תומכת בכמה מטפים, אך מנוע התזכורות שנבדק קורא שדה תוקף יחיד למטף.

נוספו מקורות ממשלתיים לחידוש ולבדיקת כושר שיט. לא נקבעו מרווחי חידוש אחידים או רשימת חובה לכל סוג כלי. עמוד הממשלה הישיר החזיר 403, ותוכן השירות אותר באמצעות תוצאות החיפוש הרשמיות.
