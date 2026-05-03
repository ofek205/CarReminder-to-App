import React from 'react';

/**
 * <PageLayout> — wraps a page with consistent spacing + max-width.
 *
 * The app-wide chrome (sidebar, top bar, bottom nav) is provided by
 * src/Layout.jsx. <PageLayout> handles ONLY the in-page container.
 *
 * Why both?
 *   - Layout = shell (one per session)
 *   - PageLayout = per-route container with consistent padding,
 *     RTL direction, and content width.
 *
 * Pages should look like:
 *
 *   export default function MyPage() {
 *     return (
 *       <PageLayout>
 *         <PageHeader title="..." />
 *         ...content...
 *       </PageLayout>
 *     );
 *   }
 *
 * Width modes:
 *   default  — max-w-3xl (article-ish, 768px). Use for forms,
 *              detail pages, settings screens.
 *   wide     — max-w-5xl (~1024px). Use for dashboards, lists.
 *   full     — no max-width. Use for maps, full-bleed UI.
 */

const widthClasses = {
  default: 'max-w-3xl',
  wide:    'max-w-5xl',
  full:    'max-w-none',
};

export default function PageLayout({
  width = 'wide',
  children,
  className = '',
}) {
  const w = widthClasses[width] || widthClasses.wide;
  return (
    <div dir="rtl" className={`mx-auto ${w} pb-12 ${className}`}>
      {children}
    </div>
  );
}
