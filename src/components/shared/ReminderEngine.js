/**
 * ReminderEngine.js
 * Centralized, pure-function reminder calculation logic.
 * No React, no side effects - just data in, reminder items out.
 */

import { differenceInDays, parseISO } from 'date-fns';
import { getVehicleLabels, isVessel } from './DateStatusUtils';

// ── Primitive helpers ──────────────────────────────────────────────────────────

/** Days until a date string. Negative means past due. */
export function daysUntil(dateStr) {
  if (!dateStr) return null;
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return differenceInDays(parseISO(dateStr), today);
  } catch {
    return null;
  }
}

/** Urgency level from days remaining. */
export function urgencyFromDays(daysLeft) {
  if (daysLeft === null || daysLeft === undefined) return 'neutral';
  if (daysLeft < 0) return 'danger';
  if (daysLeft <= 7) return 'warn';
  return 'upcoming';
}

/** Human-readable Hebrew label for days remaining. */
export function daysLabel(daysLeft) {
  if (daysLeft === null || daysLeft === undefined) return '';
  if (daysLeft < 0) return `פג תוקף לפני ${Math.abs(daysLeft)} ימים`;
  if (daysLeft === 0) return 'פג תוקף היום';
  if (daysLeft === 1) return 'פג תוקף מחר';
  return `פג תוקף בעוד ${daysLeft} ימים`;
}

/** Short label variant. */
export function daysLabelShort(daysLeft) {
  if (daysLeft === null) return '';
  if (daysLeft < 0) return `-${Math.abs(daysLeft)} ימים`;
  if (daysLeft === 0) return 'היום';
  return `${daysLeft} ימים`;
}

// ── Category → doc type mapping ────────────────────────────────────────────────
const INSURANCE_TYPES = new Set(['ביטוח חובה', 'ביטוח מקיף', 'ביטוח צד ג', 'צד ג']);
const TEST_TYPES      = new Set(['טסט']);
const LICENSE_TYPES   = new Set(['רישיון רכב', 'רישיון נהיגה']);
const SERVICE_TYPES   = new Set(['טיפול תקופתי']);

export function getDocEmoji(documentType) {
  if (INSURANCE_TYPES.has(documentType)) return '🛡️';
  if (TEST_TYPES.has(documentType))      return '🔧';
  if (LICENSE_TYPES.has(documentType))   return '🪪';
  if (SERVICE_TYPES.has(documentType))   return '⚙️';
  return '📄';
}

// ── Main calculation ───────────────────────────────────────────────────────────

/**
 * calcReminders({ vehicles, documents, settings })
 *
 * Returns an array of reminder items sorted by daysLeft ascending (most urgent first).
 * Only includes items within the configured reminder window.
 *
 * Each item:
 * {
 *   id: string,           unique key
 *   type: 'test' | 'insurance' | 'document',
 *   emoji: string,
 *   typeName: string,     Hebrew label
 *   name: string,         vehicle name or document title
 *   dueDate: string,      ISO date
 *   daysLeft: number,
 *   status: 'danger' | 'warn' | 'upcoming',
 *   linkTo: string,       page URL fragment
 * }
 */

export function calcReminders({ vehicles = [], documents = [], settings = {} }) {
  const testDays   = settings.remind_test_days_before      ?? 14;
  const insDays    = settings.remind_insurance_days_before ?? 14;
  const docDays    = settings.remind_document_days_before  ?? 14;
  const safetyDays = settings.remind_safety_days_before    ?? docDays; // fallback to doc window

  const items = [];

  // ── Vehicles ──
  vehicles.forEach(v => {
    const vLabels = getVehicleLabels(v.vehicle_type, v.nickname);
    const vName = v.nickname || [v.manufacturer, v.model].filter(Boolean).join(' ') || vLabels.vehicleFallback;

    if (v.test_due_date) {
      const dl = daysUntil(v.test_due_date);
      if (dl !== null && dl <= testDays) {
        items.push({
          id: `test-${v.id}`,
          type: 'test',
          emoji: '📋',
          typeName: vLabels.testWord,
          name: vName,
          dueDate: v.test_due_date,
          daysLeft: dl,
          status: urgencyFromDays(dl),
          linkTo: `VehicleDetail?id=${v.id}`,
        });
      }
    }

    if (v.insurance_due_date) {
      const dl = daysUntil(v.insurance_due_date);
      if (dl !== null && dl <= insDays) {
        items.push({
          id: `ins-${v.id}`,
          type: 'insurance',
          emoji: '🛡️',
          typeName: vLabels.insuranceWord || 'ביטוח',
          name: vName,
          dueDate: v.insurance_due_date,
          daysLeft: dl,
          status: urgencyFromDays(dl),
          linkTo: `VehicleDetail?id=${v.id}`,
        });
      }
    }

    // ── Vessel safety equipment ──
    if (isVessel(v.vehicle_type, v.nickname)) {
      if (v.pyrotechnics_expiry_date) {
        const dl = daysUntil(v.pyrotechnics_expiry_date);
        if (dl !== null && dl <= safetyDays) {
          items.push({
            id: `pyro-${v.id}`,
            type: 'safety',
            emoji: '🔴',
            typeName: 'פירוטכניקה',
            name: vName,
            dueDate: v.pyrotechnics_expiry_date,
            daysLeft: dl,
            status: urgencyFromDays(dl),
            linkTo: `VehicleDetail?id=${v.id}`,
          });
        }
      }

      if (v.fire_extinguisher_expiry_date) {
        const dl = daysUntil(v.fire_extinguisher_expiry_date);
        if (dl !== null && dl <= safetyDays) {
          items.push({
            id: `extinguisher-${v.id}`,
            type: 'safety',
            emoji: '🧯',
            typeName: 'מטף כיבוי',
            name: vName,
            dueDate: v.fire_extinguisher_expiry_date,
            daysLeft: dl,
            status: urgencyFromDays(dl),
            linkTo: `VehicleDetail?id=${v.id}`,
          });
        }
      }

      if (v.life_raft_expiry_date) {
        const dl = daysUntil(v.life_raft_expiry_date);
        if (dl !== null && dl <= safetyDays) {
          items.push({
            id: `liferaft-${v.id}`,
            type: 'safety',
            emoji: '🛟',
            typeName: 'אסדת הצלה',
            name: vName,
            dueDate: v.life_raft_expiry_date,
            daysLeft: dl,
            status: urgencyFromDays(dl),
            linkTo: `VehicleDetail?id=${v.id}`,
          });
        }
      }
    }
  });

  // ── Documents ──
  documents.forEach(doc => {
    if (!doc.expiry_date) return;
    const dl = daysUntil(doc.expiry_date);
    if (dl !== null && dl <= docDays) {
      items.push({
        id: `doc-${doc.id}`,
        type: 'document',
        emoji: getDocEmoji(doc.document_type),
        typeName: doc.document_type || 'מסמך',
        name: doc.title || doc.document_type || 'מסמך',
        dueDate: doc.expiry_date,
        daysLeft: dl,
        status: urgencyFromDays(dl),
        linkTo: doc.vehicle_id ? `Documents?vehicle_id=${doc.vehicle_id}` : 'Documents',
      });
    }
  });

  // Sort: most urgent (lowest daysLeft) first
  items.sort((a, b) => a.daysLeft - b.daysLeft);

  return items;
}

/**
 * calcUsageAlerts({ vehicle, logs, catalog })
 *
 * Returns an array of km/hours-based maintenance alerts for a single vehicle.
 * Uses the latest maintenance log per type and compares current usage against
 * the catalog interval.
 *
 * Each alert:
 * {
 *   maintenanceName: string,
 *   intervalUsage: number,       km or hours threshold
 *   usageSinceService: number,   how much driven since last service
 *   percentUsed: number,         0-100+
 *   status: 'ok' | 'warn' | 'danger',
 *   unit: 'ק״מ' | 'שעות',
 * }
 */
export function calcUsageAlerts({ vehicle, logs = [], catalog = [] }) {
  const currentKm    = vehicle.current_km    ? Number(vehicle.current_km)    : null;
  const currentHours = vehicle.current_engine_hours ? Number(vehicle.current_engine_hours) : null;

  const alerts = [];

  catalog.forEach(item => {
    if (!item.km || item.km <= 0) return; // no km interval defined

    // Find the most recent log for this maintenance type
    const relevant = logs
      .filter(l => l.maintenance_type === item.name && l.km_at_service)
      .sort((a, b) => Number(b.km_at_service) - Number(a.km_at_service));

    const lastLog = relevant[0];
    const lastKm  = lastLog ? Number(lastLog.km_at_service) : null;
    const current = currentKm;

    if (current === null) return; // no current reading — skip

    // If no log exists, count from km_baseline (the odometer when the vehicle was added).
    // This ensures alerts only fire after the user has actually driven an interval since joining —
    // not immediately because the odometer was high when they first registered.
    const baseline  = vehicle.km_baseline != null ? Number(vehicle.km_baseline) : current;
    const since     = lastKm !== null ? current - lastKm : current - baseline;
    const pct       = Math.round((since / item.km) * 100);
    const status    = pct >= 100 ? 'danger' : pct >= 80 ? 'warn' : 'ok';

    if (status !== 'ok') {
      alerts.push({
        maintenanceName: item.name,
        intervalUsage: item.km,
        usageSinceService: since,
        percentUsed: pct,
        status,
        unit: 'ק״מ',
      });
    }
  });

  // Hours-based (same logic for engine hours)
  catalog.forEach(item => {
    if (!item.hours || item.hours <= 0) return;

    const relevant = logs
      .filter(l => l.maintenance_type === item.name && l.engine_hours_at_service)
      .sort((a, b) => Number(b.engine_hours_at_service) - Number(a.engine_hours_at_service));

    const lastLog   = relevant[0];
    const lastHours = lastLog ? Number(lastLog.engine_hours_at_service) : null;
    const current   = currentHours;

    if (current === null) return;

    const hoursBaseline = vehicle.engine_hours_baseline != null ? Number(vehicle.engine_hours_baseline) : current;
    const since  = lastHours !== null ? current - lastHours : current - hoursBaseline;
    const pct    = Math.round((since / item.hours) * 100);
    const status = pct >= 100 ? 'danger' : pct >= 80 ? 'warn' : 'ok';

    if (status !== 'ok') {
      alerts.push({
        maintenanceName: item.name,
        intervalUsage: item.hours,
        usageSinceService: since,
        percentUsed: pct,
        status,
        unit: 'שעות',
      });
    }
  });

  // Deduplicate: if same maintenanceName appears for both km and hours, keep the worse one
  const seen = new Map();
  alerts.forEach(a => {
    const existing = seen.get(a.maintenanceName);
    if (!existing || a.percentUsed > existing.percentUsed) seen.set(a.maintenanceName, a);
  });

  return Array.from(seen.values()).sort((a, b) => b.percentUsed - a.percentUsed);
}

/**
 * getDocumentStatus({ doc, settings })
 * Returns status info for a single document based on reminder settings.
 */
export function getDocumentStatus(doc, settings = {}) {
  if (!doc.expiry_date) return null;
  const docDays = settings.remind_document_days_before ?? 14;
  const dl = daysUntil(doc.expiry_date);
  if (dl === null) return null;
  return {
    daysLeft: dl,
    status: dl < 0 ? 'danger' : dl <= docDays ? 'warn' : 'ok',
    label: daysLabel(dl),
    labelShort: daysLabelShort(dl),
  };
}
