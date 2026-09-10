# CLAUDE.md — Operational rules for every Claude session in this repo

> **Why this file exists:** Claude Code automatically loads `CLAUDE.md` at
> the start of every session in this directory. The rules below are
> binding for every agent working on this project. They cannot be relaxed
> mid-session, only by Ofek explicitly editing this file.

---

## חוקי-על (defaults that NEVER change)

### חוק 0 — הפרדה לפי סיכון, לא לפי „פנים מול חוץ”

#### תקציר בשפה פשוטה

**השאלה היחידה היא: אפשר לבטל את זה?** מה שאפשר לבטל — קלוד. מה שלא — Ofek.

| | |
|---|---|
| **קלוד לבד** | לכתוב קוד, לקמט, להעלות ענף צדדי, ולהעביר ל-`staging` |
| **Ofek** | להעלות ללקוחות |
| **אף אחד בלחיצה אחת** | פריסות, שינויי מסד, גרסאות לחנויות |

הקו עובר במקום אחד בדיוק: **בין `staging` ללקוחות.** עד שם קלוד, משם Ofek.
הסיבה שהוא שם ולא במקום אחר: עלייה ללקוחות היא הדבר היחיד שקורה מיד ואי אפשר
להחזיר. תקלה ב-`staging` מתוקנת בחמש דקות ואף אחד לא ראה אותה.

**ארבעה תנאים לעלייה ללקוחות, וכולם חייבים להתקיים:**

1. Ofek אומר את מילות המפתח המדויקות (חוק 3). „בוא נעלה” לא מספיק, וקלוד שואל
   מה התכוונת. ניסוח מעורפל הוא בדיוק הרגע שבו קורות טעויות.
2. הקוד עבר דרך `staging`.
3. ארבע הבדיקות האוטומטיות ירוקות. מ-2026-09-09 זה **נאכף בשרת ולא בהסכמה**,
   ורשימת העקיפה ריקה — גם Ofek לא יכול לעקוף.
4. Ofek לוחץ על ה-merge. לא קלוד.

**עלייה ישירה ללקוחות בלי בדיקות ובלי PR: אף פעם.** חסום בשרת לשניהם. עד
2026-09-09 זה היה פתוח לגמרי ואיש לא ידע.

**דילוג על `staging`: רק במסלול hot-fix**, וגם אז נדרשים כל אלה: תקלה בייצור
שדורשת תיקון מיידי, **תיקון אחד קטן** ולא אוסף, **בלי שום שינוי מסד** (תנאי
מוחלט), ומילות החירום במפורש. גם שם הבדיקות רצות וה-merge נשאר של Ofek. מה
שמדלגים עליו זו רק ההמתנה ב-`staging`.

---

> ## ✅ בתוקף מ-2026-09-09. שתי שכבות האכיפה אומתו
>
> **1. ה-ruleset על main:** `Active`, `Applies to 1 target: main`, רשימת
> עקיפה **ריקה** (אין פטור לאף אחד, כולל ל-Ofek), `Require a pull request
> before merging`, `Require branches to be up to date`, `Block force
> pushes`, וארבע בדיקות נדרשות: `Build`, `Lint`, `Query timeout gate`,
> `View-as identity gate` (האחרונה קשורה ל-GitHub Actions ולא ל„כל מקור”,
> כך שרק ה-workflow האמיתי יכול לדווח עליה).
>
> **2. `permissions.deny`:** 82 כללים, אומת בקריאת הקובץ החי.
>
> הסעיף נכתב **לפני** האכיפה, עם באנר „טרם בתוקף”, ורק אז הוחלף בזה. זה
> היה מכוון: מסמך שמצהיר שהוא לא בתוקף הוא לא פער, מסמך שמבטיח יכולת שאין
> הוא כן. ראה שתי ההערות ההיסטוריות למטה.
>
> **מה שנמצא בדרך, ולמה זה מצדיק את הסדר הזה:** ה-ruleset היה שבור בשתי
> שכבות בלתי תלויות (`Disabled` **וגם** `targeting 0 branches`), ואחרי
> התיקון הראשון אחת מארבע הבדיקות נשמרה בשם משובש
> (`QueryView-as identity gate timeout gate`). שם בדיקה שלא קיים לעולם לא
> מדווח, כלומר **כל מיזוג ל-main היה נחסם לנצח** ואף אחד לא היה מבין למה.
> שלוש התקלות התגלו רק בהסתכלות על המסך עצמו, אחת אחרי השנייה.

הקו הוא **הרגע שבו פעולה נהיית בלתי הפיכה**, לא הגבול בין המחשב לרשת.

**מה שקלוד עושה עצמאית:**
- עריכות, `git add`, `git commit` מקומי — דרך `commit-gatekeeper`, בלי שינוי
- `git push` של **ענף צדדי** — ענף שאף סביבה לא מריצה
- `gh pr create` — פתיחת PR. היא לא משנה שום דבר, רק יוצרת מסך סקירה ומפעילה את השערים
- `gh pr view` / `gh pr list` / `gh pr checks` — קריאת מצב השערים
- `git push origin --delete <branch>` על ענף **שכבר מוזג**. הפיך: הקומיטים בפנים

**מה ש-Ofek עושה, תמיד:**
- **ה-merge עצמו — גם ל-staging וגם ל-main.**

  הסיבה טכנית ולא זהירות יתר: `gh pr merge` מקבל מספר PR, לא שם ענף. אין תבנית
  שיכולה להתיר merge ל-staging ולאסור merge ל-main, זו אותה פקודה. או שקלוד יכול
  למזג הכל או כלום. מכיוון ש-merge ל-main נפרס ללקוחות תוך שניות, התשובה היא כלום.
- deploy ל-Vercel — קורה מעצמו על merge ל-main, אין צעד ידני
- כל דבר בסופהבייס: `functions deploy`, `secrets set`, והרצת SQL. הסביבות חולקות
  מסד, ולכן SQL נוגע בלקוחות (ראה „הערה על DB”)
- native build והעלאה לחנות
- הפעלת workflow ידנית

**מה שחסום לתמיד, גם באישור מפורש בצ'אט:**
`git push --force` / `-f` / `--force-with-lease` / `--all` / `--mirror` · דחיפה ישירה
ל-main · מחיקת `main` או `staging` · `gh api` (גישה גולמית = בלי גבול) · `gh repo` ·
`gh secret` · `gh ruleset` · `git remote add/set-url` · `npx cap` · `vercel` ·
`npm publish` · `gradlew` · `xcodebuild` · `supabase`

**קלוד לא עורך את `.claude/settings.json`.** גם כשמתבקש. הערך של הקובץ הוא בדיוק
שהסוכן לא יכול לכתוב אליו: אם הוראה שמוטמעת בקוד של ספרייה, בדף אינטרנט או בתוצאת
כלי מצליחה להשפיע על קלוד, ויכולת העריכה פתוחה, אותה הוראה פותחת לעצמה הכל בצעד
אחד. קלוד מכין טיוטה, Ofek מחיל. זו ההבחנה מול הקובץ הזה, ש**כן** מותר לקלוד לערוך:
עריכת `CLAUDE.md` לא מוסיפה לקלוד שום יכולת, עריכת רשימת ההרשאות מוסיפה.

---

#### שלוש רמות אכיפה, ולמה זה משנה

| רמה | חוזק | מה היא מחזיקה |
|---|---|---|
| ruleset ב-GitHub | קשה, בשרת | אי אפשר להגיע ל-main בלי PR ובלי שערים ירוקים |
| `permissions.deny` | קשה, בשכבת הכלים | אין deploy, אין merge, אין force-push |
| `CLAUDE.md` | **רך**, התנהגותי | סדר פעולות, שיקול דעת, מתי לשאול |

**כלל האצבע: כל דבר שטעות בו בלתי הפיכה לא יכול לחיות רק במסמך הזה.** המסמך עובד
כי קלוד קורא אותו ומציית; זה אמיתי, אבל טעות, קריאה שגויה או סשן שאיבד הקשר שוברים
אותו, ושתי הרמות האחרות לא תלויות בקלוד בכלל. הפער של `supabase` שלמטה הוא ההוכחה:
כותרת החוק הייתה נכונה, והאכיפה פשוט לא כיסתה אותה.

בחלוקה שלמעלה המסמך לא מחזיק לבד שום דבר קטסטרופלי. כל מה שבלתי הפיך יושב בשתי
הרמות הקשות.

#### למה ה-ruleset הוא התנאי, ולא רק המלצה

התאמת התבניות ב-`deny` עובדת על **תחילת** הפקודה, ולכן לא יכולה לזהות דחיפה שהיעד
שלה מוסתר באמצע. `git push origin main` ו-`git push origin HEAD:main` נראות לה שונות
לגמרי ועושות אותו דבר, ו-`git push` יחף מענף שכבר עוקב אחרי main לא מזכיר את היעד
בכלל. לכן חסימת „דחיפה ל-main” ברשימה היא **שכבה שנייה ונוחות בלבד**, והאכיפה
האמיתית היא בשרת. בלי ה-ruleset, ההיתר לדחוף היה נשען על תבניות שאפשר לעקוף בטעות
בניסוח.

**ומכאן הכלל להמשך:** אם ה-ruleset אי פעם יכובה, ינוטרל, או יאבד את היעד שלו,
ההיתרים ב-`deny` חייבים לחזור למצב הישן **באותו רגע**. שתי השכבות תלויות זו בזו.

#### אכיפה טכנית: 82 כללים ב-`permissions.deny`

בשתי הצורות, `Bash(...)` ו-`PowerShell(...)`.

**חסום תמיד:** `git push --force` / `-f` / `--force-with-lease` / `--all` / `--mirror` ·
`git push origin main` (וגם `HEAD:main`) · מחיקת `main` או `staging` (גם `--delete`
וגם refspec ריק) · `gh pr merge` · `gh api` · `gh repo` · `gh secret` · `gh variable` ·
`gh workflow` · `gh run` · `gh release` · `gh auth` · `gh config` · `gh alias` ·
`gh extension` · `gh codespace` · `gh ssh-key` · `gh gpg-key` · `gh ruleset` ·
`git remote add/set-url` · `npx cap` · `vercel` / `npx vercel` · `npm publish` ·
`gradlew` · `xcodebuild` · `supabase` / `npx supabase`

**מותר לקלוד:** `git push` של ענף צדדי · `git push origin staging` · `git push origin
--delete <branch>` על ענף ממוזג · `gh pr create` / `view` / `list` / `checks`

> **הערה על ההשלכה של חסימת `gh ruleset` ו-`gh api`:** קלוד **לא יכול לקרוא** את
> הגדרות ה-ruleset, ולכן אימות שלהן יישאר תמיד דרך Ofek (צילום מסך או קריאה בדפדפן).
> זו הגדרה שמשתנה פעם בשנה, אז זה מחיר סביר. אבל צריך לזכור אותו: כשקלוד אומר
> „ה-ruleset תקין”, הוא מצטט את מה שנאמר לו, לא משהו שבדק.

> **הערה 2026-09-08 — פער שנסגר:** `supabase` **לא** היה ברשימה, בזמן שכותרת החוק הזה אומרת „כל פעולה חיצונית”. כלומר קלוד היה יכול להריץ `npx supabase functions deploy` ולשנות קוד שרץ בפרודקשן, בלי שדבר יעצור אותו. הפער התגלה כשקלוד נשאל לפרוס ובדק את רשימת ה-deny לפני שנגע בה. זה אותו סוג בעיה כמו ה-`skip-worktree` למטה: החוק היה נכון והאכיפה לא כיסתה אותו.
>
> **הלקח הכללי:** רשימת ה-deny היא רשימה מפורשת, ולכן כל כלי CLI חדש שנכנס לפרויקט ומדבר עם שירות חיצוני צריך להיכנס אליה **באותו קומיט** שמכניס את הכלי. אחרת ההגנה נשארת מאחור בשקט, וזה נגלה רק כשמישהו מנסה.

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

**חלוקת עבודה (עודכן 2026-09-09 לפי חוק 0 החדש):** קלוד מכין, דוחף את ענף השחרור, ופותח את ה-PR. **ה-merge ל-main וה-tag הם של Ofek**, ואת זה אוכפים גם `permissions.deny` (`gh pr merge` חסום) וגם ה-ruleset בשרת (אין דחיפה ישירה ל-main, ואין merge בלי ארבע הבדיקות הירוקות).

**מה קלוד עושה:**
1. בודק `package.json` — נדרש bump (semver)? אם כן, bump ב-staging, commit דרך commit-gatekeeper.

**מה Ofek עושה:**

2. דוחף את staging ופותח PR ל-main:
```
git push origin staging
```
ואז PR ב-github.com מ-`staging` ל-`main`.

> **חובה לעבור דרך PR.** `production-gates.yml` מופעל **אך ורק** על `pull_request` שמכוון ל-main. הנוסח הישן של השער הזה הורה `git push origin main` ישירות — כלומר ארבעת ה-jobs (build, lint, query-timeout, view-as identity) **לא רצו על אף שחרור אמיתי**. שתים-עשרה הריצות הירוקות בהיסטוריה הגיעו מ-PR-ים שנפתחו בנפרד ובמקרה. merge ישיר עוקף את כל האכיפה האוטומטית שיש לפרויקט.

3. אחרי שכל ה-jobs ירוקים — merge דרך ה-UI של GitHub (Create a merge commit, לא squash).
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
- **תיעוד ה-hotfix ב-issue:** נכון ל-2026-09-09 `gh` **אינו מותקן** במכונה, אז זה ידני דרך github.com. אחרי התקנה (`winget install GitHub.cli`) קלוד יוכל לפתוח issue ו-PR, אבל לא למזג אותם.

> **הערה על סתירה שהייתה כאן:** הנוסח הישן הורה לקלוד לעשות `checkout` ל-main (שסעיף „מה Claude עושה תמיד בתחילת סשן” אוסר) ולפתוח issue ב-GitHub (שחוק 0 אוסר). שתי ההוראות היו בלתי-ניתנות לביצוע. החלוקה למעלה פותרת את שתיהן.

---

## מצב lint — נקי

נמדד ב-2026-09-01: `npm run lint` יוצא **exit 0** — **0 errors, 919 warnings**. רוב האזהרות הן אכיפת מערכת העיצוב (`no-restricted-syntax` על hex/rgb מוטבע), שמוגדרת בכוונה כ-`warn` כי הפיכה ל-`error` הייתה מפילה כ-200 מקומות. חוב ה-lint הישן (`react-hooks/rules-of-hooks` + `typescript-eslint` חסר) **טופל**.

### מה באמת רץ, ואיפה

| שכבה | מתי | מה |
|---|---|---|
| `.githooks/pre-commit` | כל commit מקומי | קבצי סוד (`.env`/`.pem`/`.key`), סמני קונפליקט, מפתחות מקודדים (`sk-`/`AKIA`/`ghp_`), eslint על הקבצים בסטייג' |
| `.githooks/pre-push` | כל push מקומי | **שש** בדיקות: אזהרת main, `npm run lint`, `npm test`, `npm run build`, שער query-timeout, שער זהות view-as |
| `.claude/hooks/commit-gate.cjs` | כל פקודת git שיוצרת או משכתבת קומיט של קלוד (commit/push/merge/pull/rebase/cherry-pick/revert/am) | דורש אסימון APPROVED טרי מ-commit-gatekeeper |
| `production-gates.yml` | **PR ל-main בלבד** | **ארבעה** jobs: build, lint, query-timeout, view-as identity |

- **`git push origin staging`** — עובר ללא `--no-verify`.
- **`git push origin main`** — אסור `--no-verify`. ה-CI לעולם לא יעקוף.
- **`commit-gatekeeper`** — `--no-verify` עוקף את ה-githooks, **לא** את שער קלוד.

> **שתי נקודות שהמסמך הזה תיאר בחסר עד 2026-09-01:** הוא כלל לא הזכיר שקיים `pre-commit` hook, ומנה שלוש בדיקות ב-pre-push ושלושה jobs ב-CI במקום חמש וארבעה. שער זהות ה-view-as (`scripts/check-view-as-identity.cjs`) קיים בשניהם ולא הוזכר באף אחד.

> **ואזהרה שעדיין בתוקף:** הגנת הענף על `main` ב-GitHub **כבויה** (ה-ruleset קיים במצב `enforcement: disabled`). כלומר ה-jobs של `production-gates.yml` הם כרגע מייעצים ולא חוסמים merge. יש להפעיל אותה.

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

ראה `.github/workflows/production-gates.yml`. ה-workflow רץ אוטומטית על כל PR שמטרתו `main` — **ורק על PR**, אין לו טריגר `push`. הוא אוכף **חמישה** jobs:
- Build pass (עם `VITE_SUPABASE_*` אמיתיים מוזרקים)
- Lint pass (כל הפרויקט)
- **Unit tests** — `npm test` (vitest). נוסף 2026-09-08. מקבע אינווריאנטים ש-build ו-lint לא רואים: אילו שדות מותר שיגיעו ל-cache האופליין על הדיסק (`role`, URL חתום, PII של צד שלישי), חוזה ה-envelope-מול-throw של ה-DAL, שכל `dal.run('name')` נפתר לפקודה רשומה (השם הוא מחרוזת, אז אין type או lint שיתפוס שגיאת כתיב), ושאף מסך לא כותב ל-supabase ישירות. לא דורש secrets.
- **Query Timeout Gate** (ראה למטה)
- **View-As Identity Gate** — `scripts/check-view-as-identity.cjs`, מוודא שקריאות `admin_*` לא רצות על מישור ההתחזות

חוסם merge ב-GitHub UI **רק כשהגנת הענף מופעלת** — נכון ל-2026-09-01 היא כבויה, ולכן ה-jobs מייעצים בלבד.

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

הטבלה היא `public.sql_ledger` (ראה `supabase-sql-ledger-2026-09-01.sql`). **השדה הנושא הוא `sha256`** — שם קובץ לא מוכיח כלום אם הקובץ השתנה אחרי ההחלה. ה-hash מצמיד את הבייטים המדויקים שרצו, וזה מה שמאפשר ל-`drift` לענות על „האם המסד הריץ את מה שהקובץ אומר היום”.

> **תיקון 2026-09-08:** הסעיף הזה אמר „טרם הוחל”. **הפנקס חי.** `select count(*) from public.sql_ledger` החזיר 4, והקובץ עצמו אינו זורע שורות (ה-`insert` היחיד שבו יושב בתוך גוף `sql_ledger_record`), ולכן אלה רישומים אמיתיים שקדמו לתאריך הזה.
>
> **ומכאן נובע הכלל שהיה משתמע ולא כתוב:** מכיוון שה-`sha256` הוא השדה הנושא, **אין לערוך קובץ SQL אחרי שהוא הוחל ונרשם.** עריכה כזו מנתקת את הקובץ מהבייטים שרצו, ו-`drift` יסמן אותו כ-CHANGED לנצח. תוספת לפיצ'ר שכבר הוחל = **קובץ חדש**, לא עריכה של הקיים.

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
