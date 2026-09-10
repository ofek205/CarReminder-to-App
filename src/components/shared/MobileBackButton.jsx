/**
 * MobileBackButton — small inline "→ חזור" affordance for page headers.
 *
 * Used at the top of every B2B page (Routes, Drivers, Reports, etc.)
 * to mirror the back-affordance pattern that personal pages get from
 * PageHeader's backPage prop. Web users have a browser back button, but
 * mobile / Capacitor users — the primary B2B audience — don't.
 *
 * Default behavior: navigate(-1). Override with `to` for an explicit
 * page (e.g. RouteDetail's "back to משימות" might want to land on
 * /Routes regardless of how the user got here).
 *
 * The arrow points right because Hebrew reading direction makes the
 * right side feel like "where I came from" — matches the OS-level
 * back gesture on iOS/Android in RTL apps. Built-in mb-2 so callers
 * just drop the component at the top of the page without needing to
 * micromanage spacing.
 */
import React from 'react';
import { ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { isDemoMode } from '@/lib/demoMode';
import { DEMO_HOME_ID, pathForScreen } from '@/lib/demoScreens';

export default function MobileBackButton({ to = null, label = 'חזור', className = '' }) {
  const navigate = useNavigate();

  const handleClick = () => {
    // In the marketing preview, "back" means the preview's home screen and
    // never a history step. The frame is 390px wide, so the app renders its
    // mobile chrome and this button appears; `history.length` inside an iframe
    // counts the JOINT session history, measured at 29, so the guard below
    // passed and navigate(-1) walked straight out of the preview and into a
    // sign-in screen the visitor could neither use nor leave. A fixed
    // destination cannot escape the frame no matter what the stack holds.
    if (isDemoMode()) {
      navigate(pathForScreen(DEMO_HOME_ID), { replace: true });
      return;
    }
    if (to) {
      // String: page name → /PageName URL
      // Object: explicit URL with optional query
      const target = typeof to === 'string' ? createPageUrl(to) : to;
      navigate(target);
    } else if (window.history.length > 1) {
      navigate(-1);
    } else {
      // Cold-start (PWA opened directly to a deep link). Land on
      // a sensible home rather than a no-op back.
      navigate(createPageUrl('Dashboard'));
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`inline-flex items-center gap-1 text-xs font-bold text-gray-500 hover:text-gray-900 active:scale-95 transition-all py-1.5 px-2 -mr-2 mb-2 rounded-lg ${className}`}
      aria-label={label}
    >
      <ChevronRight className="h-4 w-4" />
      {label}
    </button>
  );
}
