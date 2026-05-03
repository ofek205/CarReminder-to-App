import React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * <LoadingState> — replaces the legacy LoadingSpinner + ad-hoc spinners.
 *
 * Variants:
 *   page     — centered, fills page section. Use for full-page loads.
 *   inline   — small spinner, inline with text. Use inside buttons / rows.
 *   skeleton — a simple bar skeleton. For lists and cards.
 *
 * Brand-correct: spinner uses --cr-brand-primary (not amber, fixing
 * the legacy LoadingSpinner.jsx).
 *
 * For complex skeletons (multi-line cards), prefer composing the
 * simpler <SkeletonBar> blocks below into a custom skeleton inside
 * the page. We're intentionally not building a generic ListSkeleton
 * here yet — sprint 3 reviews each page's specific needs.
 */

export default function LoadingState({
  variant = 'page',
  label = 'טוען...',
  size,
  className = '',
}) {
  if (variant === 'inline') {
    const px = size || 16;
    return (
      <span dir="rtl" className={`inline-flex items-center gap-2 text-cr-sm text-cr-text-secondary ${className}`}>
        <Loader2 size={px} className="animate-spin text-cr-brand-primary" aria-hidden="true" />
        {label && <span>{label}</span>}
      </span>
    );
  }

  if (variant === 'skeleton') {
    return <SkeletonBar className={className} />;
  }

  // page variant
  const px = size || 32;
  return (
    <div
      dir="rtl"
      className={`flex flex-col items-center justify-center py-16 ${className}`}
      role="status"
      aria-live="polite"
    >
      <Loader2 size={px} className="animate-spin text-cr-brand-primary" aria-hidden="true" />
      {label && (
        <p className="mt-3 text-cr-sm text-cr-text-secondary font-cr-medium">{label}</p>
      )}
    </div>
  );
}

/**
 * <SkeletonBar> — a single shimmering bar.
 * Compose into bigger skeletons. The shimmer animation is defined
 * in src/index.css alongside the other cr- animations (sprint 1).
 */
export function SkeletonBar({ className = '', width = '100%', height = 12 }) {
  return (
    <div
      className={`bg-cr-surface-subtle rounded-cr-md cr-skeleton-shimmer ${className}`}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}
