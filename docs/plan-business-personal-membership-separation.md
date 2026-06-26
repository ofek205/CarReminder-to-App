# תוכנית הנדסית — הפרדה מלאה אישי/עסקי (membership + ownership)

> פירוק tech-lead של [האפיון](spec-business-personal-membership-separation.md), 2026-06-26. מאומת מול הקוד החי (RLS, RPCs, AccountSettings, delete_my_account, unified-account-invite, phase1-foundation).

## 1. תקציר טכני

הפיצ'ר הוא **~80% איחוד, ניקוי והקשחה על תשתית קיימת** — לא בנייה מאפס. שלושה צירים:

1. **`accounts.owner_user_id` = מקור-אמת יחיד לבעלות** (כבר קיים מ-phase1). `account_members.role='בעלים'` הופך לנגזרת מסונכרנת. מתקנים את `delete_my_account` שיקרא ממנו.
2. **כל כתיבה ל-`account_members` עוברת ל-SECURITY DEFINER RPC**, ומהדקים RLS. זה סוגר שני חורים + מוסיף ניקוי `driver_assignments` ואטומיות.
3. **איחוד 4 משטחי כתיבה לאחד** + retire של `add_workspace_member_by_email` (המסלול שמוסיף `פעיל` מיד בלי אישור).

**שני ממצאי אבטחה (מעבר לאפיון), שניהם Critical:**
- **IDOR ב-`members_insert`:** ה-policy הוא `WITH CHECK (user_id = auth.uid())` בלבד — בלי הגבלת `account_id`/`role`/`status`. משתמש יכול להכניס את עצמו ל**כל חשבון** עם `role='בעלים'`, `status='פעיל'` ולקבל בעלות על צי של מישהו אחר. `members_select`/`vehicles_select` משתמשים ב-`user_account_ids()` שמבוסס על `account_members` → גישה מלאה מיידית.
- **`members_update` ללא `WITH CHECK`:** בעלים יכול לקבע חבר נוסף ל-`בעלים` (שובר את האינווריאנט "בעלים אחד"), ואין חסם על הסלמה ל-`בעלים` בנתיב הגנרי.

**מלכוד תאימות:** `Dashboard.jsx:986` עושה `db.account_members.create(...)` ישיר (bootstrap לגיטימי של חברות אישית). הידוק `members_insert` חייב לשמר את ה-bootstrap (לנתב ל-`ensure_user_account` RPC) — אחרת נשבר רישום משתמש חדש בפרודקשן.

## 2. גישה מוצעת (וחלופות שנשקלו)

| החלטה | הגישה הנבחרת | חלופה שנדחתה |
|---|---|---|
| מקור-אמת לבעלות | `accounts.owner_user_id` (חד-ערכי, כבר קיים) + סנכרון role דרך RPC | UNIQUE partial index על `role='בעלים'` — מיותר, owner_user_id כבר אוכף יחידות מבנית |
| כתיבות חברות | RPC-only (SECURITY DEFINER) + הידוק RLS | `WITH CHECK` בלבד — לא נותן אטומיות עם `driver_assignments` ולא חוסם כתיבה ישירה עוקפת-לוגיקה |
| הזמנת נהג | להרחיב את `invite_account_member_by_email` לקבל `'driver'` (pending+accept) | לשמר `add_workspace_member_by_email` — עוקף את שלב האישור, סותר ע2 |
| היקוף per-vehicle לחבר | להסיר מהמשטח העסקי, `p_vehicle_ids=NULL` (עמודה נשארת) | להסיר את העמודה — blast radius מיותר |

## 3. רכיבים מושפעים

### DB / SQL (migrations חדשים, idempotent)
- **`accounts`**: backfill `owner_user_id` מ-`role='בעלים'` היכן ש-NULL; אכיפת NOT NULL אחרי backfill; (אופציונלי) trigger שמסנכרן `role='בעלים'` ↔ `owner_user_id`.
- **`account_members`**: הקשחת RLS `members_insert`/`members_update`/`members_delete` + `WITH CHECK`; (אופציונלי) עמודת `invited_at` ל-TTL.
- **RPCs חדשים** (כולם SECURITY DEFINER, `withTimeout`-friendly): `transfer_ownership`, `change_member_role`, `remove_member`, `leave_account`, `cancel_pending_invite`.
- **RPCs מתוקנים**: `invite_account_member_by_email` (+`p_account_id`, להתיר `'driver'`, להסיר `LIMIT 1`), `delete_my_account` (לקרוא `owner_user_id`, לחסום כש-yש חברים).
- **retire**: `add_workspace_member_by_email`.
- **cron**: `expire_pending_invites()` יומי (14 ימים).

### Frontend
- `src/lib/permissions.js` — תוויות `ROLE_INFO` → **בעלים / מנהל / צופה** (מפתחות DB ללא שינוי).
- `src/components/sharing/InviteAccountMemberDialog.jsx` — להסיר בורר-רכבים, להעביר `p_account_id`, לעדכן תוויות.
- `src/pages/AccountSettings.jsx` — `changeRole`/`removeMember` → RPC; חסימת ניהול חברים עסקי כשהמרחב עסקי.
- `src/pages/Drivers.jsx` — `AddMemberDialog` → RPC המאוחד (pending); להסיר את ה-Select שמערבב driver/שותף/מנהל; להשאיר external + assign.
- `src/components/sharing/ShareVehicleDialog.jsx` — להסיר את טאב "account".
- **משטח חדש**: ניהול חברי צוות עסקי (הזמנה + שינוי תפקיד + הסרה + ביטול ממתינה + כניסה להעברת בעלות).
- **זרימה חדשה**: העברת בעלות ב-`BusinessSettings`.
- `src/pages/DeleteAccount.jsx` / `UserProfile.jsx` — guard "העבר בעלות תחילה".
- `NotificationBell.jsx` / `JoinInvite.jsx` — לאמת טיפול ב-`account_invite_offered/accepted/declined` + הצגת שם חשבון מלא.

## 4. תלויות

- `owner_user_id` מאומת קיים (`phase1:77,117,149`). **לאמת על DB חי:** האם NOT NULL כבר? יש שורות drift (owner_user_id ≠ חבר בעלים פעיל)?
- `Dashboard.jsx:986` create ישיר — לאפיין ולנתב לפני הידוק `members_insert`.
- `pg_cron` קיים (reminders :07, orphan-monitor) — בסיס ל-cron התפוגה.
- `app_notifications` + bell handlers קיימים (ה-RPCs כבר כותבים שלושת הטיפוסים).

## 5. סיכונים

| סיכון | סבירות | השפעה | מיטיגציה |
|---|---|---|---|
| **DB משותף staging↔prod**: הידוק RLS לפני שקליינט-RPC חי ב-prod ישבור `changeRole`/`removeMember`/bootstrap בפרודקשן | ודאי אם לא נשמר סדר | חמורה | **סדר נוקשה: RPC additive → קליינט ל-prod → ואז הידוק RLS** (גל 3 רק אחרי שגל 2 חי) |
| `owner_user_id` NULL/drift על שורות קיימות | בינונית | NOT NULL ייכשל / בעלות שגויה | backfill + דוח חריגות לפני אכיפת NOT NULL |
| IDOR self-insert פתוח כרגע | קיים עכשיו | חמורה | עדיפות-על לגל ההקשחה, בלי לשבור bootstrap |
| מירוץ העברת בעלות → 0/2 בעלים | נמוכה | חמורה | `FOR UPDATE` + assert `status='פעיל'` ברגע commit |
| נהג שהוסר ממשיך לקבל מיילים/לפעול | קיים (ג9) | בינונית-חמורה | ביטול `driver_assignments` באותה טרנזקציה ב-`remove_member` |
| caller נסתר ל-`add_workspace_member_by_email` | נמוכה | בינונית | grep מלא לפני retire; להשאיר shim שמחזיר שגיאה בתקופת מעבר |

## 6. פירוק משימות (גלים מסודרים, גודל, תלויות)

### גל 1 — שלמות בעלות (backend, תואם-לאחור, לא שובר קליינט קיים)
- **T1.1 (S)** migration: backfill `accounts.owner_user_id` מ-`role='בעלים'` היכן NULL; דוח שורות drift.
- **T1.2 (S)** אכיפת NOT NULL על `owner_user_id` (אחרי שה-backfill נקי).
- **T1.3 (M)** תיקון `delete_my_account`: לקבוע בעלות מ-`owner_user_id`; ב-mode='account' לחסום (`raise must_transfer_ownership`) כשלחשבון שבבעלות יש חברים `פעיל` נוספים; להשמיד חשבון רק כשבעלים יחיד. _תלוי: T1.1_
- **T1.4 (S)** עדכון `DeleteAccount.jsx`/`UserProfile.jsx`: לתפוס `must_transfer_ownership` ולהציג CTA "העבר בעלות תחילה". _תלוי: T1.3 + (זרימת העברה — T2.1)_

### גל 2 — שכבת RPC (additive, לא מהדק RLS עדיין) + מעבר הקליינט
- **T2.1 (L)** `transfer_ownership(p_account_id, p_new_owner_user_id)`: owner-only, `FOR UPDATE`, assert יורש `status='פעיל'`, עדכון `owner_user_id` + סנכרון role (יורש→בעלים, קודם→מנהל), שתי התראות.
- **T2.2 (M)** `remove_member(p_account_id, p_member_user_id)`: owner/manager, חסימת הסרת בעלים, ביטול `driver_assignments` פעילים באותה טרנזקציה, התראה.
- **T2.3 (M)** `change_member_role(...)`: owner/manager לפי הכללים; אוסר קביעה/שינוי ל/מ-`בעלים` (זו זרימת העברה).
- **T2.4 (S)** `leave_account(p_account_id)`: self-leave; בעלים-עם-חברים → `must_transfer_first`; ניקוי הקצאות עצמי.
- **T2.5 (S)** `cancel_pending_invite(...)`: owner/manager מוחק שורת `ממתין`.
- **T2.6 (M)** תיקון `invite_account_member_by_email`: להוסיף `p_account_id` (ברירת-מחדל NULL→נתיב ישן לתקופת מעבר), authz על אותו חשבון, להתיר `'driver'` ב-whitelist, להסיר `LIMIT 1`.
- **T2.7 (S)** מעבר `AccountSettings` `changeRole`/`removeMember` → T2.3/T2.2. _תלוי: T2.2, T2.3_
- **T2.8 (S)** מעבר `Drivers` `AddMemberDialog` → T2.6 (pending) + retire ה-Select המעורבב.
- **T2.9 (S)** ניתוב `Dashboard.jsx:986` bootstrap → `ensure_user_account` RPC (הכנה להידוק insert).
- **⚠️ נקודת עצירה:** גל 2 חייב להיות **חי ב-prod** לפני גל 3.

### גל 3 — הקשחת RLS (רק אחרי שגל 2 בפרודקשן)
- **T3.1 (M)** `members_insert`: לאסור הכנסה ישירה כללית (לכפות RPC); להשאיר רק את נתיב ה-bootstrap המאובטח. **סוגר IDOR.**
- **T3.2 (S)** `members_update`: לכפות RPC / `WITH CHECK` שאוסר `role='בעלים'` בנתיב הגנרי.
- **T3.3 (S)** `members_delete`: לצמצם ל-self-leave דרך RPC בלבד.
- **T3.4 (S)** grep + retire `add_workspace_member_by_email` (shim עם שגיאה לתקופת מעבר).

### גל 4 — איחוד משטחים + טרמינולוגיה
- **T4.1 (S)** `permissions.js` ROLE_INFO → בעלים/מנהל/צופה; יישור תוויות ב-Drivers/Team/Dialogs.
- **T4.2 (S)** הסרת טאב "account" מ-`ShareVehicleDialog`.
- **T4.3 (S)** חסימת ניהול חברים עסקי במסך האישי כשהמרחב עסקי.
- **T4.4 (S)** הסרת בורר-הרכבים מ-`InviteAccountMemberDialog` במשטח העסקי (`p_vehicle_ids=NULL`).

### גל 5 — UI ניהול חברים עסקי (לפי playbook: pm→ux→designer→copywriter→frontend-design→qa)
- **T5.1 (L)** משטח ניהול חברי צוות עסקי: רשימה + תפקיד + הסרה + ממתינות + ביטול ממתינה.
- **T5.2 (M)** זרימת העברת בעלות ב-`BusinessSettings` (בורר יורש `פעיל` בלבד + אישור דו-שלבי עם שם חשבון).
- **T5.3 (S)** כל המצבים: default/loading/empty/error/offline, RTL, thumb-reach, `withTimeout` + "נסה שוב". verification ב-preview.

### גל 6 — TTL הזמנות ממתינות (ה7)
- **T6.1 (S)** `expire_pending_invites()` + schedule יומי (14 ימים) — מוחק `account_members` `ממתין` ישנות + `invites` יתומים.
- **T6.2 (S)** פעולת "בטל הזמנה ממתינה" ידנית ב-UI (T2.5).

## 7. אסטרטגיית בדיקות

- **SQL/RPC**: self-insert ל-account זר נחסם; transfer אטומי (מירוץ→בדיוק אחד מצליח, יורש שנדחה→נכשל בטוח); delete חסום עם חברים; remove מנקה `driver_assignments`.
- **QA תרחישים**: כל §7 באפיון (בעלים אחרון, יורש ממתין, חבר בשני חשבונות, decline→re-invite, share+member על אותו רכב = MAX).
- **עמידות**: כל mutation חדש עטוף `withTimeout` + state שגיאה (Query Timeout Gate).
- **UI**: verification ב-preview לכל המצבים, RTL, Capacitor.
- **חשבונות בדיקה**: `natanzone2024@gmail.com` וכד' (DB משותף עם prod).

## 8. Rollout / Migration

1. **סדר נוקשה (קריטי בגלל DB משותף):** גל 1 (תואם-לאחור) → גל 2 RPCs additive + קליינט ל-prod → **המתנה לאישור ש-prod חי** → גל 3 הקשחת RLS → גלים 4-6.
2. **כל migration idempotent** (`CREATE OR REPLACE`, `IF NOT EXISTS`, backfill בטוח לריצה חוזרת).
3. **שער DB Safety (שער 5):** staging חולק DB עם prod → כל migration רץ פעם אחת = נוגע ב-prod מיד. כל שינוי schema/RLS/RPC מתועד ומופעל ידנית ע"י Ofek לפי הסדר. הקשחת RLS לא רצה לפני שקליינט גל 2 חי.
4. **Rollback**: כל RPC חדש בטל ב-`DROP FUNCTION`; הקשחת RLS הפיכה ע"י שחזור ה-policy הקודם; backfill owner_user_id אינו הרסני.
5. **Feature flag** למשטח העסקי החדש (גל 5) אם רוצים הדרגתיות.

## 9. סטטוס מימוש (2026-06-26)

**נבנה (לא מורץ ב-DB, לא commit):**
- ✅ גל 1 — `supabase-ownership-integrity-2026-06-26.sql` + `DeleteAccount.jsx` (guard `must_transfer_ownership`).
- ✅ גל 2 (backend) — `supabase-membership-rpcs-2026-06-26.sql` (6 RPCs: transfer_ownership, remove_member, change_member_role, leave_account, cancel_pending_invite, invite fix).
- ✅ גל 2 (T2.7) — `AccountSettings.jsx` changeRole/removeMember → RPCs.
- ✅ גל 4 (T4.1 טרמינולוגיה) — `permissions.js` + `AccountSettings.jsx` + `InviteAccountMemberDialog.jsx` → תוויות בעלים/מנהל/צופה (הקשר חשבון). שיתוף-רכב (ShareVehicleDialog/VehicleAccessModal/AccountSettings:413) **לא שונה** — אוצר-מילים נפרד, החלטת copy פתוחה.

**שינויי סדר:**
- T2.8 (Drivers → הזמנה עם אישור) → הועבר לגלי UI (4/5), דרך playbook (משנה flow).
- T2.9 (bootstrap) → הועבר לגל 3; `Dashboard.jsx:986` הוא נתיב תביעת Base44 (`migration_email_map`) → ייעטף ב-RPC `claim_migrated_account` בעת הקשחת `members_insert`.
- T3.4 (retire `add_workspace_member_by_email`) → תלוי ב-T2.8 (מעבר Drivers) — לא לפני.

**הסדר להמשך:** להריץ migrations 1→2 ב-DB → commit + push קוד גלים 1/2/4 → לאמת בפרודקשן → ואז גל 3 (RLS) → גלים 4(שאר)/5 UI דרך playbook → גל 6.
