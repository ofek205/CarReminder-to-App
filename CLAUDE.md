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

**אכיפה טכנית:** `permissions.deny` ב-`.claude/settings.json` חוסם פיזית — בשתי הצורות, `Bash(...)` ו-`PowerShell(...)`:

`git push` · `gh` · `git remote add/set-url` · `npx cap` · `vercel` / `npx vercel` · `npm publish` · `gradlew` · `xcodebuild`

> **הערה 2026-09-01 — למה זה נראה שבור וכן היה שבור, אבל לא כאן:**
>
> הסעיף הזה תמיד היה **נכון לגבי הריפו**. אבל על המכונה של Ofek התגלה דגל `skip-worktree` על `.claude/settings.json` — היחיד בכל הריפו. git התעלם לחלוטין מהקובץ בעץ העבודה, כך ש-`pull` מעולם לא עדכן אותו והוא נשאר קפוא על גרסה ישנה **שבה כללי ה-`git push` וה-`gh` לא היו קיימים**. כלומר האכיפה הייתה אמיתית ב-HEAD ולא-קיימת בפועל, ואף אחד לא יכול היה לראות את הפער. הדגל הוסר.
>
> בנוסף, `.claude/settings.local.json` היה מקומט ל-git עם ~80 כללים — 27 מהם מצביעים על מכונה אחרת — וביניהם `Bash(node -e ":*)` ו-`Bash(powershell -Command ":*)`. אלה היתרי הרצה שרירותית שעקפו את **כל** רשימת ה-deny: `node -e "require('child_process').execSync('git push')"` תואם allow ולא תואם שום deny. הקובץ נוקה לתשעה כללים, הורד מ-git, ונוסף ל-`.gitignore` — הרשאות ספציפיות למכונה אינן שייכות לריפו.
>
> **הלקח שכדאי לזכור:** `skip-worktree` על קובץ תצורה משותף יוצר פער שקט בין מה שהריפו אוכף לבין מה שרץ. אם צריך עקיפה מקומית — `settings.local.json`, לעולם לא דגל על הקובץ המשותף.

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

**חלוקת עבודה:** קלוד מכין הכל עד ל-push. ה-push, ה-merge וה-tag על הרימוט הם של Ofek — כפי שחוק 0 דורש, וכפי ש-`permissions.deny` אוכף פיזית.

**מה קלוד עושה:**
1. בודק `package.json` — נדרש bump (semver)? אם כן, bump ב-staging, commit דרך commit-gatekeeper.

**מה Ofek עושה:**

2. דוחף את staging ופותח PR ל-main:
```
git push origin staging
```
ואז PR ב-github.com מ-`staging` ל-`main`.

> **חובה לעבור דרך PR.** `production-gates.yml` מופעל **אך ורק** על `pull_request` שמכוון ל-main. הנוסח הישן של השער הזה הורה `git push origin main` ישירות — כלומר ארבעת ה-jobs (build, lint, query-timeout, view-as identity) **לא רצו על אף שחרור אמיתי**. שתים-עשרה הריצות הירוקות בהיסטוריה הגיעו מ-PR-ים שנפתחו בנפרד ובמקרה. merge ישיר עוקף את כל האכיפה האוטומטית שיש לפרויקט.

3. אחרי שכל ארבעת ה-jobs ירוקים — merge דרך ה-UI של GitHub (Create a merge commit, לא squash).
4. tag על ה-merge commit:
```
git checkout main && git pull
git tag -a v6.X.Y -m "<summary>"
git push origin v6.X.Y
```
5. מאשר שה-deploy ב-Vercel main התחיל.
6. **מסנכרן את staging חזרה:**
```
git checkout staging && git merge main && git push origin staging
```
> בלי הצעד הזה staging נשאר מאחור. נכון ל-2026-09-01 staging פיגר 13 קומיטים אחרי origin/main — ובתוכם דווקא ה-workflows של אנדרואיד, כך ששיגור מ-staging שיחזר באג שכבר תוקן ב-main.

---

## מסלול Hot-fix (חירום בלבד)

מופעל ב:
- `hot-fix לפרודקשן`
- `hotfix to prod`

**שערים שעדיין רצים:**
- שער 2 (Build)
- שער 3 (code-review)
- שער 6 (commit-gatekeeper)
- שער 7 (Version+Tag), אבל הסיומת תהיה `v6.X.Y-hotfix`

**שערים שמדולגים:**
- שער 1 (Diff Inventory) — רק שינוי בודד
- שער 4 (QA Walkthrough)
- שער 5 (DB Safety) — אסור hot-fix שכולל schema change

**מנגנון — ומי עושה מה:**

ה-hot-fix מתבצע על ענף קצר חיים `hotfix/<short-desc>` שיוצא מ-`main` (לא staging!). **זה החריג היחיד לכלל „לעולם לא לגעת ב-main”, והוא של Ofek בלבד** — קלוד לא עושה checkout ל-main גם כאן.

- **Ofek:** `git fetch && git checkout -b hotfix/<desc> origin/main`, ואז מוסר את הענף לקלוד.
- **קלוד:** עורך על אותו ענף, מריץ build + code-review + commit-gatekeeper, ומקמט מקומית.
- **Ofek:** דוחף, פותח PR ל-main, ממתין לשערי ה-CI, ממזג, מתייג, **ומסנכרן staging**:
```
git checkout staging && git merge main && git push origin staging
```
- **Ofek:** פותח issue ב-GitHub שמתעד את ה-hotfix. `gh` חסום לקלוד לפי חוק 0, אז זה תמיד ידני דרך github.com.

> **הערה על סתירה שהייתה כאן:** הנוסח הישן הורה לקלוד לעשות `checkout` ל-main (שסעיף „מה Claude עושה תמיד בתחילת סשן” אוסר) ולפתוח issue ב-GitHub (שחוק 0 אוסר). שתי ההוראות היו בלתי-ניתנות לביצוע. החלוקה למעלה פותרת את שתיהן.

---

## מצב lint — נקי

נמדד ב-2026-09-01: `npm run lint` יוצא **exit 0** — **0 errors, 919 warnings**. רוב האזהרות הן אכיפת מערכת העיצוב (`no-restricted-syntax` על hex/rgb מוטבע), שמוגדרת בכוונה כ-`warn` כי הפיכה ל-`error` הייתה מפילה כ-200 מקומות. חוב ה-lint הישן (`react-hooks/rules-of-hooks` + `typescript-eslint` חסר) **טופל**.

### מה באמת רץ, ואיפה

| שכבה | מתי | מה |
|---|---|---|
| `.githooks/pre-commit` | כל commit מקומי | קבצי סוד (`.env`/`.pem`/`.key`), סמני קונפליקט, מפתחות מקודדים (`sk-`/`AKIA`/`ghp_`), eslint על הקבצים בסטייג' |
| `.githooks/pre-push` | כל push מקומי | **חמש** בדיקות: אזהרת main, `npm run lint`, `npm run build`, שער query-timeout, שער זהות view-as |
| `.claude/hooks/commit-gate.cjs` | commit/push של קלוד | דורש אסימון APPROVED טרי מ-commit-gatekeeper |
| `production-gates.yml` | **PR ל-main בלבד** | **ארבעה** jobs: build, lint, query-timeout, view-as identity |

- **`git push origin staging`** — עובר ללא `--no-verify`.
- **`git push origin main`** — אסור `--no-verify`. ה-CI לעולם לא יעקוף.
- **`commit-gatekeeper`** — `--no-verify` עוקף את ה-githooks, **לא** את שער קלוד.

> **שתי נקודות שהמסמך הזה תיאר בחסר עד 2026-09-01:** הוא כלל לא הזכיר שקיים `pre-commit` hook, ומנה שלוש בדיקות ב-pre-push ושלושה jobs ב-CI במקום חמש וארבעה. שער זהות ה-view-as (`scripts/check-view-as-identity.cjs`) קיים בשניהם ולא הוזכר באף אחד.

> **ואזהרה שעדיין בתוקף:** הגנת הענף על `main` ב-GitHub **כבויה** (ה-ruleset קיים במצב `enforcement: disabled`). כלומר ארבעת ה-jobs של `production-gates.yml` הם כרגע מייעצים ולא חוסמים merge. יש להפעיל אותה.

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

ראה `.github/workflows/production-gates.yml`. ה-workflow רץ אוטומטית על כל PR שמטרתו `main` — **ורק על PR**, אין לו טריגר `push`. הוא אוכף ארבעה jobs:
- Build pass (עם `VITE_SUPABASE_*` אמיתיים מוזרקים)
- Lint pass (כל הפרויקט)
- **Query Timeout Gate** (ראה למטה)
- **View-As Identity Gate** — `scripts/check-view-as-identity.cjs`, מוודא שקריאות `admin_*` לא רצות על מישור ההתחזות

חוסם merge ב-GitHub UI **רק כשהגנת הענף מופעלת** — נכון ל-2026-09-01 היא כבויה, ולכן ארבעת ה-jobs מייעצים בלבד.

השערים הקוגניטיביים (3, 4, 5, 6) **לא** ניתנים לאוטומציה ב-Actions — הם דורשים סקילים של Claude. הם חייבים לרוץ בסשן Claude לפני יצירת ה-PR.

> **שער 5 (DB Safety) הוא החור הגדול ביותר.** `scripts/check-sql-hazards.cjs` נכתב בדיוק בשבילו — והוא לא מקומט, לא מחובר לשום hook או workflow, וה-docblock שלו *מצהיר* שהוא מחובר ל-pre-push ול-CI. שתי ההצהרות שקריות. בהרצה הוא מוצא **236 סכנות ב-80 קבצים**, כי אין לו baseline. לפני שמחברים אותו חובה להריץ `--update-baseline` פעם אחת, אחרת הוא יחסום כל push מיידית.

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

## Playbook — שינויי UI

שרשרת הסקילים לכל עבודת פרונט. `.claude/hooks/design-nudge.cjs` מזכיר אותה אוטומטית כשפרומפט או עריכה נוגעים בחזית.

```
pm  →  ux  →  designer  →  copywriter  →  frontend-design  →  qa
```

| שלב | אחראי על | לא אחראי על |
|---|---|---|
| `pm` | למה בונים, למי, ומה מחוץ ל-scope | איך זה נראה |
| `ux` | flow, כל המצבים, wireframe, מיקרו-אינטראקציות | פלטה, טיפוגרפיה |
| `designer` | כיוון אסתטי, היררכיה, מערכת ויזואלית | הניסוח, הקוד |
| `copywriter` | כל מילה שהמשתמש רואה, בעברית | פריסה |
| `frontend-design` | המימוש בפועל + אימות ב-preview | החלטות שנקבעו למעלה |
| `qa` | תרחישים, מקרי קצה, GO / NO-GO | תיקון הבאגים שמצא |

### כללי הדילוג

דילוג מותר **רק** באחד משלושת המקרים האלה:

1. **תיקון מיקרו** — typo, padding בודד, צבע יחיד, יישור. ישר ל-`frontend-design`.
2. **שינוי copy בלבד** — הטקסט משתנה, המבנה לא. `copywriter` → `frontend-design`.
3. **באג ב-flow קיים** — ההתנהגות המיועדת ידועה ומתועדת, היא פשוט לא עובדת. `debug` → `frontend-design`.

**כל השאר עובר את השרשרת המלאה.** שינוי layout, קומפוננטה חדשה, או state חדש בלי `ux` ו-`designer` — זה BLOCK עצמי, גם אם הבקשה נשמעת קטנה.

### חובה בכל שינוי UI, בלי יוצא מן הכלל

- **כל המצבים:** default, loading, empty, error, offline. „לא הגענו לזה” = לא סיימת.
- **עברית RTL** — כולל מספרים, תאריכים, ואייקונים כיווניים.
- **mobile-first** בטווח האגודל. זו PWA שרוב השימוש בה בטלפון.
- **אימות ב-preview** לפני שמכריזים על סיום. לא „אמור לעבוד”.
- **אף פעם לא ספינר נצחי** — ראה שער ה-Query Timeout למטה.

> **הערה:** עד 2026-09-01 הסעיף הזה לא היה קיים. שני ה-hooks הורו „זכור Playbook ב-CLAUDE.md”, וחיפוש בקובץ אחרי `Playbook` החזיר אפס תוצאות. ההגדרה היחידה חיה ב-`designer/SKILL.md` והייתה בת חמישה שלבים בלבד (בלי `qa`), בעוד ש-`docs/plan-business-personal-membership-separation.md` ו-`docs/spec-vehicle-cap-and-personal-to-business-transfer.md` ציטטו את גרסת ששת השלבים כאילו הייתה מקור סמכות. כללי הדילוג לא היו כתובים בשום מקום. הגרסה כאן — ששה שלבים — היא כעת המקור היחיד.

---

## מה Claude עושה תמיד בתחילת סשן

1. בודק על איזה ענף אנחנו: `git status`. אם זה לא `staging`, מחליף ל-staging.
2. אם המשתמש מבקש שינוי — עובד על staging, מ-commit-ל ב-staging.
3. **לעולם** לא checkout-מ ל-main בסשן רגיל.
4. אם משהו דחוף נראה כאילו דורש main — שואל את המשתמש את שאלת המסלול: רגיל / hot-fix / לא לעלות.

---

## הערה על DB

נכון ל-2026-09-01, staging ו-prod עדיין **חולקים את אותו מסד נתונים** בסופהבייס. שינויי data שעושה משתמש על ה-staging URL **משפיעים על production**. לטסטים יש להשתמש בחשבונות הייעודיים בלבד (ראה את רשימת חשבונות הבדיקה אצל Ofek — לא מתועדת כאן).

כש-DB ייפרד בעתיד, החוקים האלה נשארים בתוקף — שער 5 (DB Safety) פשוט יחייב הרצה כפולה במקום אחת.

### אין migration runner — ואי אפשר להריץ replay

כל ה-SQL מוחל **ידנית** ב-SQL editor של סופהבייס. אין `supabase/migrations/`, אין `config.toml` — הפרויקט קושר ב-CLI אך מעולם לא אותחל. בשורש הריפו יושבים **199 קבצי `.sql`** בלי סדר ובלי פנקס של מה הוחל ומתי.

**אסור להריץ replay של הקבצים האלה, גם לא „רק כדי לסנכרן”.** 91% מהם בטוחים להרצה חוזרת, וזו בדיוק המלכודת: הסדר בלתי-ניתן לשחזור (70 קבצים חולקים קומיט עם קובץ SQL אחר), ו-**45 פונקציות מוגדרות מחדש ביותר מקובץ אחד** — `email_dispatch_candidates()` לבדה נכתבת בשישה. replay שרץ 91% נקי ומחזיר בשקט תריסר פונקציות מוקשחות-אבטחה גרוע מאין replay בכלל, כי הוא נראה כאילו הצליח.

**ו-16 קבצים הם פעולות נתונים חד-פעמיות שאסור לגעת בהן לעולם** — ביניהם `supabase-seed-fake-fleet-ofek.sql`, 30KB של צי רכבים מזויף שיישפך ישר לפרודקשן.

### הפנקס — מה עושים מעכשיו

הכלים קיימים מ-2026-09-01. **כל החלה של SQL חייבת להירשם.**

```bash
node scripts/sql-ledger.cjs scan            # מסווג את כל קבצי ה-SQL
node scripts/sql-ledger.cjs record <file>   # מייצר את קריאת הרישום להדבקה
node scripts/sql-ledger.cjs drift           # מה השתנה מאז שהוחל
```

**התהליך:** מריצים את הקובץ ב-SQL editor → מריצים `record` → מדביקים את הפלט → ממלאים `p_notes` במה שאימתת בפועל.

הטבלה היא `public.sql_ledger` (ראה `supabase-sql-ledger-2026-09-01.sql`, טרם הוחל). **השדה הנושא הוא `sha256`** — שם קובץ לא מוכיח כלום אם הקובץ השתנה אחרי ההחלה. ה-hash מצמיד את הבייטים המדויקים שרצו, וזה מה שמאפשר ל-`drift` לענות על „האם המסד הריץ את מה שהקובץ אומר היום”.

**שלוש רמות סיווג:**

| | מה זה | מה עושים |
|---|---|---|
| `REPLAY_SAFE` | 169 קבצים, מוגנים לאורך כל הדרך | אפשר להריץ שוב |
| `NEEDS_REVIEW` | 10 — נזרקים באמצע, או רושמים cron | להסתכל לפני |
| `ONE_TIME_DATA` | 20 — כותבים או משכפלים שורות | **לעולם לא שוב** |

המסווג **שמרן בכוונה**. `supabase-vehicle-cap-2026-07-25.sql` מסומן `ONE_TIME_DATA` בגלל `UPDATE` חשוף, אבל קריאה מעמיקה מראה שהוא בטוח כי `greatest()` רק מעלה את המכסה. הכלי מסמן; אדם מכריע.

### ⚠️ `scripts/build-staging-init.sh` — אל תריץ

הוא משרשר רשימה קשיחה של קבצי SQL לקובץ אחד, ומתחיל ב-`supabase-base44-migration.sql` — היחיד עם `CREATE TABLE` חשוף. זהו בדיוק ה-replay שאסור: הוא ייראה כאילו הצליח בזמן שהוא מחזיר לאחור פונקציות מוקשחות. שום דבר לא מפנה אליו. **מועמד למחיקה.**

הצעד שנותר: `pg_dump --schema-only` מפרודקשן כ-baseline, וארכוב 199 הקבצים כתיעוד פורנזי.
