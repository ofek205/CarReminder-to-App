// Navigation tracker — Base44 logging removed, also serves as the deep-link
// bridge from Capacitor's appUrlOpen event to React Router.
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { initDeepLinks } from './capacitor';

export default function NavigationTracker() {
  const navigate = useNavigate();
  useEffect(() => {
    // No-op on web; on Capacitor native this wires push/share deep links
    // into client-side navigation instead of full page reloads.
    initDeepLinks((path) => {
      try { navigate(path); } catch { window.location.href = path; }
    });
  }, [navigate]);
  return null;
}
