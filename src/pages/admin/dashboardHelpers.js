/**
 * Pure helper functions extracted from AdminDashboard.jsx.
 *
 * None of these use React, useState, useEffect, or any DOM. They take
 * inputs, return outputs, no side effects. Moving them out of the main
 * component file shaves ~90 lines from the page module and makes the
 * helpers reusable by other admin views (UsersTab, MessagesTab, BugsTab)
 * if any of them needs the same date / chart math later.
 *
 * Behavior is byte-equivalent to the inline versions — same params,
 * same returns, same TODAY-anchored ranges. Verified by build + lint.
 */

import {
  format, subDays, startOfDay, parseISO, isValid,
} from 'date-fns';
import { he } from 'date-fns/locale';
import { C } from '@/lib/designTokens';

// Anchor for "today" used by date-range helpers. Module-evaluated once,
// matches the previous TODAY constant in AdminDashboard.jsx.
const TODAY = new Date();

// Neutral BI palette — intentionally different from the main app
// branding. Used by retentionColor() and by any caller that wants
// consistent chart colors across the admin views.
export const ADMIN_PALETTE = {
  blue:   C.info,
  green:  C.successBright,
  amber:  C.warnIcon,
  red:    '#EF4444',
  purple: '#8B5CF6',
  teal:   '#0891B2',
  slate:  '#64748B',
};

/** Human-readable "X ago" for the last-refreshed label. */
export function formatRelative(date) {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 10)   return 'עכשיו';
  if (secs < 60)   return `לפני ${secs} שניות`;
  const mins = Math.floor(secs / 60);
  if (mins < 60)   return `לפני ${mins} דק'`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)    return `לפני ${hrs} שעות`;
  return `לפני ${Math.floor(hrs / 24)} ימים`;
}

/** Number of days the current filter spans. Caps "all" at 90 days for
 *  trend charts — unbounded series are unreadable. */
export function daysForFilter(key) {
  switch (key) {
    case 'today':     return 1;
    case 'yesterday': return 2;
    case 'week':      return 7;
    case 'month':     return 30;
    case 'quarter':   return 90;
    case 'all':       return 90;
    default:          return 7;
  }
}

export function getRangeStart(key) {
  switch (key) {
    case 'today':     return startOfDay(TODAY);
    case 'yesterday': return startOfDay(subDays(TODAY, 1));
    case 'week':      return startOfDay(subDays(TODAY, 6));
    case 'month':     return startOfDay(subDays(TODAY, 29));
    case 'quarter':   return startOfDay(subDays(TODAY, 89));
    case 'all':       return new Date(0);
    default:          return startOfDay(subDays(TODAY, 6));
  }
}

export function getRangeEnd(key) {
  return key === 'yesterday' ? startOfDay(TODAY) : new Date(TODAY.getTime() + 1);
}

export function inRange(dateStr, key) {
  if (key === 'all') return true;
  if (!dateStr) return false;
  try {
    const d = parseISO(String(dateStr));
    if (!isValid(d)) return false;
    return d >= getRangeStart(key) && d < getRangeEnd(key);
  } catch { return false; }
}

export function safeDate(str) {
  if (!str) return null;
  try { const d = parseISO(String(str)); return isValid(d) ? d : null; }
  catch { return null; }
}

export function dayStr(d) { return format(d, 'yyyy-MM-dd'); }

/**
 * Build a date-bucketed time series for chart rendering.
 * seriesDefs: [{ key, items, dateGetter }]
 */
export function buildSeries(filterKey, ...seriesDefs) {
  const isToday      = filterKey === 'today';
  const isYesterday  = filterKey === 'yesterday';
  const days         = filterKey === 'month' ? 30 : filterKey === 'week' ? 7 : 1;
  const startOffset  = isYesterday ? 1 : 0;

  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d  = subDays(TODAY, i + startOffset);
    const ds = dayStr(d);
    const point = {
      name: days === 1
        ? (isToday ? 'היום' : 'אתמול')
        : format(d, 'dd/MM', { locale: he }),
    };
    seriesDefs.forEach(({ key, items, dateGetter }) => {
      point[key] = items.filter(item => {
        const v = dateGetter(item);
        return v && String(v).split('T')[0] === ds;
      }).length;
    });
    result.push(point);
  }
  return result;
}

/** Maps a retention rate (0-100) to one of three palette colors. */
export function retentionColor(rate) {
  if (rate >= 60) return ADMIN_PALETTE.green;
  if (rate >= 30) return ADMIN_PALETTE.amber;
  return ADMIN_PALETTE.red;
}
