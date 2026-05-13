# Apple Guideline 1.2 — Screen Recording Script

> Apple specifically requires this recording as part of the response to the
> May 2026 rejection of v4.0.0. Without it, App Review will reject again
> regardless of the code changes.

## What Apple Asked For

> "reply to this message with a screen recording captured on a physical
> device that demonstrates:
> - The EULA or terms of use agreement presented to users before
>   registering or logging in
> - The mechanism for users to flag objectionable content
> - The mechanism for users to block abusive users
>
> Include the recording in the Notes field of the App Review Information
> section in App Store Connect for future submissions."

## Setup Before Recording

1. **Use a physical iPhone or iPad** (NOT the simulator — Apple
   explicitly requires "physical device").
2. **Install the latest staging build** with all v4.1.x UGC moderation
   changes applied. Confirm by checking:
   - The signup form shows the "קראתי ואני מאשר" checkbox (Auth → Signup tab)
   - PostCard's "..." menu has both "דווח על תוכן" and "חסום משתמש"
   - Settings → "חשבון משותף" tab shows a "משתמשים חסומים" section
3. **Prepare two test accounts** before recording:
   - Account A: a fresh email you can sign up with on camera
   - Account B: an existing test account that already has at least one
     community post visible to Account A (use natanzone2024@gmail.com or
     a similar dedicated test account)
4. **Sign out of all accounts** before starting the recording.
5. **Start screen recording** from Control Center (swipe down on the
   top-right corner; tap the circular record button).

## Recording Script — Step by Step

The recording should be about **60–90 seconds total**. Apple reviewers
skim — keep each part deliberate and visible. Hold each screen for at
least 2 seconds after a tap so the recording captures the result.

### Part 1 — EULA at signup (~25 sec)

1. Open the app. You should land on the auth screen.
2. Tap **"התחברות / הרשמה"** to open the form.
3. Tap **"הרשמה"** tab. Pause so the form is fully visible.
4. **Scroll slowly** so the "**קראתי ואני מאשר/ת את תנאי השימוש ואת
   מדיניות הפרטיות**" checkbox is clearly on screen, **unticked**.
5. Try to fill the email + password + name fields and tap **"הרשמה"**.
   - The app should refuse to submit because the checkbox is unticked,
     showing an error message: "יש לאשר את תנאי השימוש ומדיניות
     הפרטיות כדי להירשם".
6. **Tap the checkbox** to tick it.
7. Tap **"תנאי השימוש"** link — it opens TermsOfService in a new tab.
   Wait 2 seconds so the reviewer sees the page header.
8. Go back. Tap **"מדיניות הפרטיות"** link — same idea. Wait 2 seconds.
9. Go back to the signup form. The checkbox is still ticked. Tap
   **"הרשמה"** — the form proceeds to the verify-email screen (you
   don't have to complete the verify; the EULA gate is what we're
   demonstrating).

### Part 2 — Flag objectionable content (~20 sec)

10. Stop the current flow. Sign in with Account A (existing user, has
    already completed EULA in a previous session). Land on the home
    screen.
11. Navigate to **"קהילה וייעוץ"** from the side menu or bottom nav.
12. Find any post by another user (Account B's post).
13. Tap the **"..."** icon at the top-right of the post card.
14. The dropdown shows **"דווח על תוכן"** with a flag icon. Tap it.
15. The Report dialog opens. Pause so the reviewer sees:
    - The header "דיווח על תוכן"
    - The 4 reason radio buttons (ספאם / הטרדה / לא חוקי / אחר)
    - The optional "פרטים נוספים" textarea
16. Select **"הטרדה או שפה פוגענית"** and tap **"שלח דיווח"**.
17. Wait for the success toast: "הדיווח נשלח. נבדוק את התוכן בהקדם."

### Part 3 — Block abusive user (~20 sec)

18. On the same post, tap the **"..."** icon again.
19. Tap **"חסום משתמש"** (the red item with a ban icon).
20. The native confirm dialog appears: "לחסום את [שם]? לא תראו עוד
    פוסטים ותגובות שלהם." Tap **OK** / **אישור**.
21. Wait for the success toast: "המשתמש נחסם".
22. **The post should disappear from the feed immediately** — make
    sure to scroll a touch so the reviewer sees the feed has updated.

### Part 4 — Unblock (~15 sec, optional but strong)

23. Navigate to **"הגדרות"** → **"חשבון משותף"** tab.
24. Scroll to the **"משתמשים חסומים"** section near the bottom.
25. The blocked user's name appears with a "בטל" button. Tap it.
26. Confirm in the native dialog. Wait for the toast "החסימה הוסרה".
27. End recording.

## How to Submit

1. Stop recording from Control Center. The video lands in Photos.
2. Open App Store Connect → CarReminder → App Information →
   **App Review Information** section.
3. Upload the recording in the **Notes / Attachments** field (App
   Store Connect lets you attach video files directly to the Review
   Notes — there is a paperclip / "Add Attachment" affordance).
4. In the message reply to App Review, identify:
   - The third-party login service you offer: **Google Sign-In** (and
     once Apple Sign-In ships in 4.2.0, both)
   - The EULA acceptance: visible at signup, blocking
   - The flag mechanism: PostCard → "..." → "דווח על תוכן"
   - The block mechanism: PostCard → "..." → "חסום משתמש", and
     management at Settings → "חשבון משותף" → "משתמשים חסומים"

## Common Gotchas

- **Do NOT record in airplane mode.** The Report and Block calls hit
  Supabase; without network they'll fail and the recording will show
  an error.
- **Do NOT record with a fresh account that hasn't accepted the EULA
  yet — the post-EULA UI is what Part 2 + 3 demonstrate.** Use an
  existing signed-in account for those parts.
- **Match the App Review device class.** If they reviewed on iPad Air,
  prefer recording on an iPad (the layout differs from iPhone).
- **Keep the recording under 2 minutes.** Anything longer and the
  uploader may reject it.
