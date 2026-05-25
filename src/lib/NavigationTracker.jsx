// Navigation tracker. Base44 logging removed, also serves as the deep-link
// bridge from Capacitor's appUrlOpen event to React Router.
//
// Additionally (Phase 1 observability): records every route change as a
// breadcrumb so the crash reporter can attach "user just navigated to X"
// to any error that fires on the new page.
import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { initDeepLinks } from './capacitor';
import { crumb } from './breadcrumbs';

export default function NavigationTracker() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // No-op on web; on Capacitor native this wires push/share deep links
    // into client-side navigation instead of full page reloads.
    initDeepLinks((path) => {
      try { navigate(path); } catch { window.location.href = path; }
    });
  }, [navigate]);

  // Record every route change as a breadcrumb. Triggers on initial mount
  // too, capturing the entry page. Cheap (string concat + ring buffer push).
  useEffect(() => {
    try { crumb.nav(location.pathname, location.search ? { search: location.search } : undefined); } catch {}
  }, [location.pathname, location.search]);

  return null;
}
