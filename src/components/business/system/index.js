/**
 * Business design-system barrel.
 *
 * Every B2B page imports from here. Adding a new page? Read this file
 * first to see what's available before inventing.
 *
 * Tone reference (color → meaning):
 *   emerald = healthy, active, counted, primary
 *   amber   = financial, pending, warning
 *   blue    = informational, neutral data, infra
 *   red     = problem, critical, overdue
 *   purple  = special / accent / activity
 */
export { default as PageShell }       from './PageShell';
export { default as Card }            from './Card';
export { default as KpiTile }         from './KpiTile';
export { default as ActionTile }      from './ActionTile';
export { default as AnimatedCount, useAnimatedNumber } from './AnimatedCount';
export { default as Sparkline }       from './Sparkline';
export { default as useTickEverySecond } from './useTickEverySecond';
