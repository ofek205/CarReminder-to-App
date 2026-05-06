/**
 * PageShell — shared page wrapper for every business screen.
 *
 * Why: each B2B page needs the SAME background gradient, max-width,
 * mobile back button, and header rhythm. Without this wrapper every
 * page invents its own and they slowly drift apart. PageShell
 * enforces visual consistency so the whole business section reads as
 * one product.
 *
 * Usage:
 *   <PageShell title="משימות" subtitle="ניהול משימות פעילות בצי">
 *     <YourSections />
 *   </PageShell>
 *
 * Optional `live` enables the LIVE chip in the header. Optional
 * `actions` accepts a node rendered on the trailing edge of the
 * header (right side of LTR / RTL flow).
 */
import React from 'react';
import MobileBackButton from '@/components/shared/MobileBackButton';

export default function PageShell({
  title,
  subtitle,
  live = false,
  actions = null,
  children,
}) {
  return (
    <div
      dir="rtl"
      className="max-w-5xl mx-auto pb-12 px-4 sm:px-6 pt-3"
      style={{
        // Same mint→white gradient as BusinessDashboard so every page
        // shares the atmosphere on first paint.
        background: `
          radial-gradient(ellipse at 70% -10%, rgba(16,185,129,0.08) 0%, transparent 50%),
          linear-gradient(180deg, #F0F7F4 0%, #FFFFFF 60%)
        `,
        minHeight: '100vh',
      }}
    >
      <MobileBackButton />

      <header className="mb-5 flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          {live && (
            <div
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide mb-2"
              style={{ background: '#10B981', color: '#FFFFFF' }}
            >
              <span className="relative flex h-1.5 w-1.5">
                <span
                  className="absolute inline-flex h-full w-full rounded-full opacity-75 bg-white"
                  style={{ animation: 'cr-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' }}
                />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
              </span>
              LIVE
            </div>
          )}
          <h1
            className="font-black leading-none tracking-tight truncate"
            style={{
              color: '#0B2912',
              fontWeight: 900,
              fontSize: 'clamp(1.5rem, 3.5vw, 2.25rem)',
              letterSpacing: '-0.025em',
            }}
          >
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm mt-1.5" style={{ color: '#4B5D52' }}>
              {subtitle}
            </p>
          )}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </header>

      {children}

      {/* Pulse animation keyframe scoped global so the LIVE chip
          breathes on any page that uses PageShell with `live=true`. */}
      <style>{`
        @keyframes cr-pulse {
          0%, 100% { transform: scale(1); opacity: 0.75; }
          50%      { transform: scale(2.5); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
