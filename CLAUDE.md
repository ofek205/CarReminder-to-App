# CLAUDE.md — Operational rules for every Claude session in this repo

> **Why this file exists:** Claude Code automatically loads `CLAUDE.md` at
> the start of every session in this directory. The rules below are
> binding for every agent working on this project. They cannot be relaxed
> mid-session, only by Ofek explicitly editing this file.

---

## חוקי-על (defaults that NEVER change)

### חוק 1 — ברירת המחדל היא staging

כל commit שאני יוצר נדחף לענף `staging` בלבד. בסשן רגיל אני **לעולם** לא:
- עושה checkout ל-main
- merge-ים ל-main
- push ל-main
- יוצר commit ישירות על main

הענף `staging` הוא ברירת המחדל, ה-Vercel preview שלו (`car-reminder-to-app-git-staging-*.vercel.app`) הוא הסביבה לטסטים.

### חוק 2 — main נעול

main מתעדכן רק דרך תהליך "עלייה לפרודקשן" (ראה למטה) או "hot-fix לפרודקשן" (ראה למטה). שום מסלול אחר.

### חוק 3 — שיגור פרודקשן רק במילים מפורשות

מילים שמפעילות את תהליך העלייה לפרודקשן — אחת מאלה בדיוק:
- `עלה לפרודקשן`
- `promote to prod`
- `merge to main`

מילים שמפעילות hot-fix:
- `hot-fix לפרודקשן`
- `hotfix to prod`

ניסוח מעורפל ("בוא נעדכן", "תדחוף", "תעלה את זה") → אני שואל הבהרה. **לא** מנחש כוונה.

---

## 7 שערי עלייה לפרודקשן (מסלול רגיל)

כשהמשתמש אומר את אחת מ-3 מילות-המפתח של פרודקשן, אני חייב להריץ בסדר:

### שער 1 — Diff Inventory
מציג סיכום: כמה commits ב-staging ש-main לא ראה, אילו קבצים שונים, אילו features מערכבים.
```
git rev-list --count main..staging
git diff --stat main..staging
git log main..staging --oneline
```

### שער 2 — Build Verification (אוטומטי גם ב-Actions)
```
npm run build
```
חייב לעבור נקי. נכשל → BLOCK.

### שער 3 — `/code-review` (קוגניטיבי, חובה בסשן)
מריץ את הסקיל code-review על ה-diff המלא `main..staging`. אסור Critical או High. Medium מחייב הסבר קצר ואישור משתמש.

### שער 4 — QA Mental Walkthrough (קוגניטיבי, חובה בסשן)
לכל feature שמשתנה, מציג טבלת תרחישים מינימום:
- משתמש קיים (production data)
- משתמש חדש (חשבון רענן)
- אורח (guest mode)
- מנהל (admin)
- offline / רשת איטית
- RTL Hebrew rendering
- מובייל + Capacitor app

תרחיש לא מטופל → BLOCK.

### שער 5 — DB Safety Check
אם ה-diff נוגע ב-`*.sql`, `supabase/`, או RPC migrations:
- מציג רשימת שינויי schema/RLS/RPC בנפרד
- שואל את המשתמש: האם הופעלו על production? (כי כרגע staging חולק DB עם prod, אבל זה ישתנה בעתיד)
- אם פיצול DB עתידי כבר קרה — מחייב הרצה מפורשת על שני המסדים לפני המשך
- חסר תיעוד → BLOCK

### שער 6 — `/commit-gatekeeper` על ה-merge commit
הסקיל commit-gatekeeper כבר רץ על כל commit, אבל בעלייה לפרודקשן הוא רץ פעם נוספת על ה-merge commit עצמו (סיכום מצטבר של כל ה-staging).

### שער 7 — Version + Tag + Merge
1. בודק `package.json` — האם נדרש bump (semver)? אם כן, bump ב-staging קודם, commit, ואז ממשיך.
2. יוצר tag annotated:
```
git tag -a v2.X.Y -m "<summary>"
```
3. merge ב-main ללא fast-forward:
```
git checkout main
git merge --no-ff staging -m "release: v2.X.Y"
git push origin main
git push origin v2.X.Y
```
4. מאשר שה-deploy ב-Vercel main התחיל (בודק שה-Actions רצים נקי).

---

## מסלול Hot-fix (חירום בלבד)

מופעל ב:
- `hot-fix לפרודקשן`
- `hotfix to prod`

**שערים שעדיין רצים:**
- שער 2 (Build)
- שער 3 (code-review)
- שער 6 (commit-gatekeeper)
- שער 7 (Version+Tag), אבל הסיומת תהיה `v2.X.Y-hotfix`

**שערים שמדולגים:**
- שער 1 (Diff Inventory) — רק שינוי בודד
- שער 4 (QA Walkthrough)
- שער 5 (DB Safety) — אסור hot-fix שכולל schema change

**מנגנון:**
- ה-hot-fix מתבצע על ענף קצר חיים `hotfix/<short-desc>` שיוצא מ-`main` (לא staging!).
- אחרי merge ל-main, חובה לסנכרן staging:
```
git checkout staging
git merge main
git push origin staging
```
- חובה לפתוח issue ב-GitHub שמתעד את ה-hotfix.

---

## חוב lint קיים — חוק --no-verify

ה-pre-push hook מריץ ESLint על כל הפרויקט. יש 26 שגיאות פתוחות לא-קשורות (`react-hooks/rules-of-hooks` false-positives על early-return + `typescript-eslint` plugin חסר בתצורה).

- **ב-push לענף `staging`**: מותר `git push --no-verify origin staging` כדי לעקוף את ה-hook. החוב הוא חוב מערכתי, לא של ה-PR הנוכחי.
- **ב-push ל-`main`**: אסור `--no-verify`. עלייה לפרודקשן חייבת לעבור lint נקי. אם בעת עלייה ה-lint נכשל — חובה לתקן את החוב **לפני** המשך.
- **ה-commit-gatekeeper hook** רץ תמיד ולא ניתן לעקוף (`--no-verify` עוקף את ה-pre-push, לא את ה-gatekeeper).

יום אחד נתקן את חוב ה-lint פעם אחת ונבטל את הסעיף הזה.

---

## אכיפה אוטומטית — GitHub Actions

ראה `.github/workflows/production-gates.yml`. ה-workflow רץ אוטומטית על כל PR שמטרתו `main`, ואוכף:
- Build pass
- Lint pass (כל הפרויקט)
- **Query Timeout Gate** (ראה למטה)
- חוסם merge ב-GitHub UI אם משהו נכשל

השערים הקוגניטיביים (3, 4, 5, 6) **לא** ניתנים לאוטומציה ב-Actions — הם דורשים סקילים של Claude. הם חייבים לרוץ בסשן Claude לפני יצירת ה-PR.

---

## Query Timeout Gate — שער חובה לכל push

**מה זה:** סקריפט שסורק את `src/` ובודק שכל קריאה ל-Supabase בתוך `useQuery` עטופה ב-`withTimeout(...)` (מ-`@/lib/supabaseQuery`) או ב-`Promise.race(...)`.

**למה זה קיים:** קריאת Supabase שתקועה משאירה את `isLoading` של React Query על true לתמיד, וגוררת את המסך לספינר נצחי. זאת הייתה הסיבה לשישה קומיטים של `fix(stuck-loading)` (e106f36, 5fa72cb, 027f0b5, 3be1b13, 702141e, 40b420a) — כל פעם נתפסה הסיבה במקום אחר. השער הזה מבטיח שלא נחזיר את הסיכון.

**איפה הוא רץ:**
- `.githooks/pre-push` — לפני כל push (מקומית).
- `.github/workflows/production-gates.yml` — על כל PR ל-main (חוסם merge).

**מנגנון baseline:** הקובץ `scripts/.query-timeout-baseline.json` מתעד את כל ההפרות הקיימות במצב נכון לקומיט שבו הוא נוצר. השער נכשל **רק כאשר מספר ההפרות בקובץ עולה** מעבר ל-baseline. קוד קיים מקבל הקלה (grandfathered), קוד חדש חייב להשתמש ב-`withTimeout`. כשמתקנים קובץ קיים — מריצים `node scripts/check-query-timeouts.cjs --update-baseline` כדי לעדכן.

**לעקוף בחירום (אסור בפרודקשן):**
- ב-staging: אפשר לדחוף עם `--no-verify` כמו עם ה-lint hook.
- ב-main: השער ב-Actions לא ניתן לעקיפה. **אם קוד מתעלם מ-`withTimeout` במכוון — חייבים לתעד למה ולהוסיף ל-baseline במפורש.**

**איך לכתוב קוד שעובר את השער:**
```js
import { withTimeout } from '@/lib/supabaseQuery';

const { data, isLoading, isError, refetch } = useQuery({
  queryKey: ['my-query'],
  queryFn: async () => {
    const { data, error } = await withTimeout(
      supabase.from('my_table').select('*'),
      'my_table_label'
    );
    if (error) throw error;
    return data || [];
  },
  retry: 1,
  retryDelay: 500,
});
```

**ובמסך — חובה state של שגיאה:** אם `isError` true, הצג כפתור "נסה שוב" שמפעיל `refetch()`. **לעולם לא להישאר על ספינר.**

---

## מה Claude עושה תמיד בתחילת סשן

1. בודק על איזה ענף אנחנו: `git status`. אם זה לא `staging`, מחליף ל-staging.
2. אם המשתמש מבקש שינוי — עובד על staging, מ-commit-ל ב-staging.
3. **לעולם** לא checkout-מ ל-main בסשן רגיל.
4. אם משהו דחוף נראה כאילו דורש main — שואל את המשתמש את שאלת המסלול: רגיל / hot-fix / לא לעלות.

---

## הערה על DB

נכון להיום (אפריל 2026), staging ו-prod חולקים את אותו מסד נתונים בסופהבייס. שינויי data שעושה משתמש על ה-staging URL **משפיעים על production**. לטסטים יש להשתמש בחשבונות ייעודיים (`natanzone2024@gmail.com` וכד׳).

כש-DB ייפרד בעתיד, החוקים האלה נשארים בתוקף — שער 5 (DB Safety) פשוט יחייב הרצה כפולה במקום אחת.
