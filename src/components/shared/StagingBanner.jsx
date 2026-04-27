/**
 * Persistent banner that announces "this is the staging environment".
 *
 * Renders only when the page is loaded from a Vercel preview URL of the
 * staging branch (any hostname containing `git-staging`). On production
 * (`car-reminder.app`, the apex/www domain, or the main Vercel alias)
 * the component returns `null` so users see nothing — same DOM as before
 * the banner existed.
 *
 * Sticky-top banner: stays glued to the top of the viewport on scroll
 * AND occupies real layout space, so the header / hero card below
 * never gets covered. The earlier `position:fixed` version overlapped
 * the page chrome and clipped the first ~28px of every screen.
 */
import React from 'react';

const STAGING_HOST_FRAGMENT = 'git-staging';

export function isStagingHost() {
  if (typeof window === 'undefined') return false;
  return window.location.hostname.includes(STAGING_HOST_FRAGMENT);
}

export default function StagingBanner() {
  if (!isStagingHost()) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      dir="rtl"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 9999,
        background: 'linear-gradient(90deg,#FACC15 0%,#F59E0B 100%)',
        color: '#1F2937',
        textAlign: 'center',
        padding: '6px 12px',
        fontSize: 13,
        fontWeight: 600,
        letterSpacing: '0.02em',
        boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
      }}
    >
      סביבת טסטים — staging — שינויים נשמרים במסד האמיתי
    </div>
  );
}
