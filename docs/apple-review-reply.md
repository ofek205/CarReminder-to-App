# App Review Reply — v4.2.0 submission

> Paste this verbatim into the "Reply to App Review" message field in
> App Store Connect after the new build (v4.2.0) is uploaded and all
> three external configurations are complete. Attach the screen
> recording (per docs/apple-1.2-screen-recording-script.md) to the
> "App Review Information → Notes" attachment slot.

---

Hello App Review Team,

Thank you for the detailed feedback on submission 1fd9f558-414f-4ef2-b893-814f6baa279d. We have addressed all three issues in v4.2.0. Details below, mapped one-to-one to your rejection grounds.

## Guideline 1.5 — Safety / Developer Information (Support URL)

We have made the Support URL `https://car-reminder.app/Contact` publicly accessible without authentication. Anyone visiting that URL — including App Review reviewers who are not signed in — now sees:

- A direct support email link (mailto:support@car-reminder.app)
- The published response-time SLA (24–48 business hours)
- A 3-item FAQ covering the most common user questions (response time, how to delete an account, how to report a bug)
- Links to our Privacy Policy and Terms of Service
- A contact form for sending us a message directly

Previously the page was gated behind authentication, which is why the reviewer was redirected to the login screen. That gating has been removed for this specific route.

## Guideline 1.2 — Safety / User-Generated Content

The Community feature in v4.2.0 now includes all the precautions required by Guideline 1.2:

**Terms-of-use agreement before registration.** The signup form contains a required, unticked checkbox: "I have read and accept the Terms of Service and Privacy Policy." Both documents open in new tabs from the checkbox. Submission is blocked at the client and an explicit error is shown ("You must accept the Terms of Service and Privacy Policy to register") until the user explicitly ticks it. The acceptance is also recorded server-side in an immutable audit table (`eula_acceptances`) with the document version and timestamp.

**Mechanism to flag objectionable content.** Every post in the Community feed has a "more" menu (the "..." icon) with a "Report content" action. Tapping it opens a dialog with four reason radios (spam / harassment / illegal / other) and an optional free-text details field. Reports are persisted to a `reported_posts` table that our admin dashboard reads, with row-level security ensuring only the reporter and admins can see the report.

**Mechanism to block abusive users.** Every post's "more" menu also has a "Block user" action (previously this was admin-only — now available to every authenticated user). Confirming the block:

1. Inserts a row into the `blocked_users` table (RLS-scoped to the current user).
2. Removes the blocked user's posts from the current user's feed instantly — the feed is read via a server-side `community_posts_visible` view that filters out blocked authors at query time.
3. Auto-creates a `reported_posts` entry for the post that triggered the block, satisfying the "Blocking should also notify the developer of the inappropriate content" requirement — the same admin dashboard surfaces this for moderation.

The user can review and undo their blocks from Settings → "Shared Account" → "Blocked Users", which lists every block with an "Undo" button.

A screen recording captured on a physical iPad demonstrating all three mechanisms — EULA acceptance at signup, flagging content, and blocking a user — is attached to the App Review Notes for this submission.

## Guideline 4.8 — Design / Login Services

We have added **Sign in with Apple** as an equivalent login option alongside Google Sign-In. On iOS the button uses the native Sign in with Apple sheet via `@capacitor-community/apple-sign-in`, exchanging the returned identity token with our Supabase backend. On web and Android the button uses Apple's web OAuth flow through Supabase. The button is positioned above Google on the auth screen to satisfy the "equivalent prominence" requirement, follows Apple's HIG light-theme spec (black background, white Apple logo, "Sign in with Apple" wording — localized to Hebrew as "המשך עם Apple"), and is wired so the user can choose to "Hide my email" during sign-up.

Sign in with Apple meets all three Guideline 4.8 sub-requirements:
- Data collection is limited to the user's name and email
- Users can keep their email private via Apple's private relay
- No interactions are tracked for advertising

---

We appreciate the rigorous review. Please let us know if anything else is needed.

Best regards,
Ofek Edelshtain — CarReminder
