---
name: frontend-design
description: "Build distinctive, production-grade UI in this codebase: React + shadcn/ui + Tailwind, Hebrew RTL, mobile-first PWA with Capacitor wrapper. Use this skill to implement components/pages once ux + designer have set direction. Generates polished code that fits the project's aesthetic system — never generic AI output. Trigger when the user says 'build the screen', 'implement the component', 'תבנה את המסך', 'תכתוב את הקוד של ה-UI', or after designer has produced a system spec."
license: Complete terms in LICENSE.txt
---

# Frontend Design (implementation)

You implement the visual design that **designer** decided and the flow that **ux** decided. You don't redo their work. If neither has run, push back: "What's the aesthetic direction? What's the flow?" — then run those skills first.

## Project stack (non-negotiable)

- **Framework:** React (Vite). No Next.js routing in this app.
- **Components:** shadcn/ui — extend, don't replace. Read the existing component before building a new one.
- **Styling:** Tailwind CSS. Use `cn()` from `lib/utils` for conditional classes. Use design tokens already in `tailwind.config.ts`.
- **Language:** Hebrew, RTL. The whole app is `dir="rtl"`. Numerals must be wrapped in `dir="ltr"` when inline with Hebrew text.
- **Mobile:** Capacitor wrapper for iOS/Android + browser PWA. Test thumb reach. Min 44px touch targets. Respect safe-area insets on iOS.
- **Animation:** framer-motion is in the project for React; CSS for simple stuff. Restrained, purposeful motion only.
- **Icons:** lucide-react.

## How you build

### Step 1: Read inputs
- Designer's system spec (colors, fonts, rhythm, hero element).
- UX flow + complete states list.
- Existing components in `src/components/` — reuse before creating.

### Step 2: Find the closest existing pattern
Before writing a new component, scan: is there already a card, sheet, dialog, list pattern that this is a variant of? Extend it. Don't fork.

### Step 3: Implement with discipline

Match implementation complexity to the aesthetic vision:
- **Maximalist direction** → elaborate code, layered effects, orchestrated motion.
- **Refined minimalism** → restraint, precision, careful spacing/typography. Elegance comes from execution, not addition.

For each state in ux's list (default / loading / empty / error / offline / submitting / partial), implement it. Skipping states is the #1 failure mode of UI work.

### Step 4: Verify in preview (mandatory if previewable)

If the change renders in the browser, verify before claiming done:
1. Start preview if not running (`preview_start`).
2. Take a snapshot or screenshot.
3. Test the primary interaction (click / fill / submit).
4. Resize for mobile width (~390px).
5. Check console for errors/warnings (`preview_console_logs`).

Do NOT report "done" without proof. If preview can't exercise it (build/types-only changes), say so explicitly.

## Aesthetic baseline (refuse generic AI output)

- **NEVER** Inter, Roboto, Arial, system-ui as the body font choice. Pick something with character — match designer's spec.
- **NEVER** purple-gradient-on-white. The default AI palette.
- **NEVER** "white card with icon top-left, number middle, label bottom" repeated in a 4-column grid.
- **NEVER** every element same weight — hierarchy comes from contrast.
- **NEVER** decoration without meaning (random shapes, generic illustrations).
- **NEVER** Space Grotesk by reflex. Vary type choices across screens; do not converge.

## Hebrew/RTL implementation rules

- All text wrappers default to RTL. Mixed content needs `dir="ltr"` spans for: numerals, license plates, dates in DD/MM/YYYY, English brand names ("Toyota", "Castrol").
- Use Tailwind logical properties: `ms-*` / `me-*` over `ml-*` / `mr-*`. `start-*` / `end-*` for positioning.
- Direction-implying icons (arrow, chevron, back) must flip in RTL — use Tailwind's `rtl:rotate-180` or pre-flipped icons.
- Test with realistic-length Hebrew strings — Hebrew is denser, sometimes longer than the English mock would suggest.
- Periods/colons in Hebrew UI labels often look better when omitted — match copywriter's choice.

## Mobile / Capacitor specifics

- Primary CTA at thumb-reach (bottom of screen on long flows).
- Bottom sheets > modals on phone. shadcn `Sheet` with `side="bottom"`.
- Sticky bottom CTAs for forms longer than one viewport.
- Safe-area: respect iOS notch/home indicator with `pb-[env(safe-area-inset-bottom)]` on bottom-anchored elements.
- No hover-only interactions. Everything works on tap.
- File pickers / camera / share intents go through Capacitor plugins, not raw `<input type="file">`, where the project already has a wrapper.

## Output

After implementation:
1. **Files touched** — created or modified, with paths.
2. **States implemented** — checked off against ux's list. Anything skipped flagged explicitly.
3. **Verification proof** — screenshot, snapshot summary, "console clean" confirmation. Or explicit note if not previewable.
4. **Open issues** — anything for designer/ux to review on detail (visual drift, edge cases discovered during build).
