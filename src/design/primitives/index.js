/**
 * Design system primitives — barrel export.
 *
 * Import from here in NEW code:
 *
 *   import { PageLayout, PageHeader, Card, CTAButton, StatusPill,
 *            StatusBar, EmptyState, LoadingState, Hero } from '@/design/primitives';
 *
 * The legacy components in src/components/shared/ (PageHeader,
 * EmptyState, LoadingSpinner) stay in place during sprint 2 migration.
 * Once a page is migrated, it should switch to the imports above.
 */

export { default as PageLayout }   from './PageLayout';
export { default as PageHeader }   from './PageHeader';
export { default as Hero }         from './Hero';
export { default as Card }         from './Card';
export { default as CTAButton }    from './CTAButton';
export { default as StatusPill }   from './StatusPill';
export { default as StatusBar }    from './StatusBar';
export { default as EmptyState }   from './EmptyState';
export { default as LoadingState, SkeletonBar } from './LoadingState';
