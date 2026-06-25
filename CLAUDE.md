# CLAUDE.md — Operational rules for every Claude session in this repo

> **Why this file exists:** Claude Code automatically loads `CLAUDE.md` at
> the start of every session in this directory. The rules below are
> binding for every agent working on this project. They cannot be relaxed
> mid-session, only by Ofek explicitly editing this file.

---

## חוקי-על (defaults that NEVER change)

### חוק 0 — קלוד לא נוגע בעולם החיצון (כל פעולה חיצונית = ידנית של Ofek)

קלוד עובד **אך ורק בתוך תיקיית הקוד**: קורא, כותב, עורך קבצים, ומריץ אימות מקומי (`build`/`lint`) כשהסביבה מאפשרת. כל פעולה ש**יוצאת החוצה** — Ofek מבצע ידנית, לעולם לא קלוד:
- `git push` (לכל ענף) — דרך GitHub Desktop / הטרמינל של Ofek
- `gh` — PR, merge, issues — דרך github.com בדפדפן
- deploy ל-Vercel — אוטומטי על push, אין צעד ידני
- native build — Android Studio / Xcode / `gradlew` / `npx cap`

מה שקלוד **כן** מכין עד (ולא כולל) ה-push: עריכות, `git add`, `git commit` מקומי, `commit-gatekeeper`, ואימות `build` כשאפשר. ה-**Push עצמו תמיד של Ofek**.

**חריגה:** ה-`deny` קשיח — אפילו אישור בצ'אט **לא** עוקף אותו. כדי לאפשר לקלוד פעולה חיצונית חד-פעמית, Ofek מסיר זמנית את הכלל הרלוונטי מ-`permissions.deny` ב-`.claude/settings.json` (פעולה מודעת), ומחזיר אותו אחרי. זה במכוון — מאלץ צעד מפורש לכל פעולה חיצונית של קלוד.

**אכיפה טכנית:** `permissions.deny` ב-`.claude/settings.json` חוסם פיזית `git push` / `gh` / deploy / native מהרצה ע"י קלוד.

> הרקע: כשקלוד מריץ git/npm בסביבת ה-agent נוצרים חיכוכים (אין npm ל-hooks, סיכון אבטחה בחיבור חיצוני). הפרדה נקייה — קלוד מקומי, Ofek חיצוני — פותרת את שניהם.

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

## מצב lint — נקי

נכון ל-2026-05-12, `npm run lint` עובר נקי: **0 errors** (אלפי warnings בלבד, רובם אכיפת מערכת עיצוב — `no-restricted-syntax` על inline hex/rgb — שמתוכננת לשדרוג עתידי). חוב ה-lint שהיה כאן בעבר (`react-hooks/rules-of-hooks` + `typescript-eslint` חסר) **טופל**.

- **`git push origin staging`** — עובר ללא `--no-verify`. ה-pre-push hook (eslint + build + query-timeout gate) רץ מקומית ועובר.
- **`git push origin main`** — אסור `--no-verify`. ה-CI לעולם לא יעקוף.
- **`commit-gatekeeper` hook** רץ תמיד ולא ניתן לעקוף (`--no-verify` עוקף את ה-pre-push, לא את ה-gatekeeper).

אם בעתיד יחזרו שגיאות lint — לתקן לפני push, לא לעקוף. `--no-verify` נשאר זמין כ-escape hatch לחירום מקומי בלבד, ולעולם לא בעלייה לפרודקשן.

### no-undef — לקח מ-v5.4.1-hotfix1

ב-2026-05-26 נשבר הייצור בגלל שמיגרציה אוטומטית הזריקה את הזיהוי `C.token` ל-14 קבצים בלי שורת `import { C } from '@/lib/designTokens'`. הסיבה שזה חמק:

```
eslint.config.js פרש את pluginJs.configs.recommended,
ואז סיפק rules: שהחליף את כל הכללים שלו.
no-undef נמחק שקטית מההגדרה.
```

מאז no-undef מופעל מפורשות תחת `rules:`. **לעולם להשאיר אותו כ-error.** הוא קל, מהיר, ותופס את כל המחלקה של "refactor שכח להוסיף import" — באג שעולה זמן ייצורי כל פעם שאדם / סקריפט / סוכן עורך קוד.

נספח: globals של Vite (`__APP_VERSION__` וכל `__VITE_*__` עתידי) מוצהרים ב-`languageOptions.globals`.

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
