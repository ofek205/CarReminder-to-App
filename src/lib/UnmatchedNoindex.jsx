import { useEffect } from 'react';

/**
 * Marks a truly unmatched app route as noindex, then removes that tag
 * when the visitor navigates away.
 *
 * Only the router fallback mounts this. Registered pages, including the
 * production stub for /dev/components, do not. The tag is a new element
 * so an existing robots meta (for example on a marketing page the visitor
 * just left) is restored by leaving it untouched.
 *
 * Capacitor loads dist/index.html from the device. vercel.json never
 * runs there. This component only adds and removes a meta tag in the
 * already running SPA, so it cannot change native routing or the start URL.
 */
export default function UnmatchedNoindex() {
  useEffect(() => {
    const el = document.createElement('meta');
    el.setAttribute('name', 'robots');
    el.setAttribute('content', 'noindex');
    el.setAttribute('data-cr-unmatched', '1');
    document.head.appendChild(el);
    return () => {
      el.remove();
    };
  }, []);
  return null;
}
