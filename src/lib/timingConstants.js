/**
 * Centralised timing constants for the small UX patterns that repeat
 * across the codebase. Prior to this module, the same intent was spelled
 * out with subtly different magic numbers (e.g. copy-feedback was
 * 1500ms in LicensePlate, 2000ms in ShareVehicleDialog, 3000ms in
 * AccountSettings — same UX, three values).
 *
 * Tuned-per-site values (PIN shake animation, splash watchdog, search
 * debounce, popup delay) intentionally stay inline at their use site
 * because they're tied to a specific animation duration or window we
 * don't want to globally retune.
 */

/**
 * How long to show the "Copied!" / checkmark state after a copy action
 * before reverting to the default button label.
 *
 * Two seconds is the sweet spot — long enough that the user notices
 * the confirmation, short enough not to feel sticky if they want to
 * copy something else right after.
 */
export const COPY_FEEDBACK_DURATION_MS = 2000;

/**
 * Delay before calling `.focus()` on a freshly-mounted search input
 * inside a Dialog / Popover. Radix portals into the DOM async; the
 * focus needs to wait one tick for the element to actually exist + be
 * focusable, otherwise the browser drops the focus call silently.
 */
export const FOCUS_AFTER_MOUNT_MS = 30;

/**
 * Tiny delay before calling `window.print()`. Without it the browser
 * sometimes prints a half-painted DOM (e.g. the report sheet hasn't
 * mounted the photos yet). 50ms is enough for one paint cycle on
 * even slow hardware while staying invisible to the user.
 */
export const PRINT_PAINT_DELAY_MS = 50;

/**
 * Delay between onBlur and "close the dropdown". Lets a click on the
 * dropdown register before the blur tears the menu down — without it,
 * a user clicking a suggestion sees the menu vanish under their finger.
 */
export const BLUR_CLOSE_DELAY_MS = 200;
