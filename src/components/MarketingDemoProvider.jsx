/**
 * Supplies the read-only demo's data, in place of the real guest store.
 *
 * GuestDataProvider reads and writes `fleet_guest_*` in localStorage. On the
 * marketing origin that store belongs to the visitor: someone who used guest
 * mode last week still has vehicles in it. Rendering the preview on top of
 * the real provider would show a stranger's own data inside a marketing
 * page, and any write would overwrite it. So this provider shadows
 * GuestDataCtx for the preview subtree and never touches storage at all.
 *
 * Every mutator is a no-op that reports the attempt upward instead. That is
 * the single enforcement point for "read-only": screens keep their normal
 * buttons and normal code paths, and the gate is here rather than scattered
 * across a dozen components that would each have to remember.
 */
import React, { useMemo } from 'react';
import { GuestDataCtx, DEFAULT_REMINDER_SETTINGS } from '@/contexts/GuestDataContext';
import {
  DEMO_VEHICLE, DEMO_VESSEL, DEMO_DOCUMENTS, DEMO_VESSEL_DOCUMENTS,
  DEMO_ACCIDENTS, DEMO_CORK_NOTES, DEMO_VESSEL_CORK_NOTES, DEMO_VESSEL_ISSUES,
} from '@/components/shared/demoVehicleData';

// Frozen at module scope: the preview must hand every visitor the identical
// dataset, and building it per render would also give the context a new
// identity on every pass and re-render every screen below it.
const DEMO_VEHICLES = [DEMO_VEHICLE, DEMO_VESSEL];
const DEMO_ALL_DOCUMENTS = [...(DEMO_DOCUMENTS || []), ...(DEMO_VESSEL_DOCUMENTS || [])];
const DEMO_ALL_CORK_NOTES = [...(DEMO_CORK_NOTES || []), ...(DEMO_VESSEL_CORK_NOTES || [])];

export default function MarketingDemoProvider({ children, onBlockedWrite }) {
  const value = useMemo(() => {
    // One blocked-write handler for every mutator. Returning null rather
    // than throwing keeps a screen that ignores the result from crashing
    // mid-render; the visitor sees the conversion dialog either way.
    const blocked = () => {
      onBlockedWrite?.();
      return null;
    };

    return {
      // Vehicles. The demo vehicle is the same Toyota Corolla the marketing
      // screenshots were captured from, so the live preview and the static
      // fallback image show the same car.
      // Both a car and a vessel, so the "כלי שייט" nav item appears and the
      // preview covers the second product line rather than only the first.
      guestVehicles: DEMO_VEHICLES,
      addGuestVehicle: blocked,
      updateGuestVehicle: blocked,
      removeGuestVehicle: blocked,
      getStoredGuestVehicles: () => DEMO_VEHICLES,
      // Documents
      guestDocuments: DEMO_ALL_DOCUMENTS,
      addGuestDocument: blocked,
      removeGuestDocument: blocked,
      updateGuestDocument: blocked,
      getStoredGuestDocuments: () => DEMO_ALL_DOCUMENTS,
      // Accidents
      guestAccidents: DEMO_ACCIDENTS || [],
      addGuestAccident: blocked,
      updateGuestAccident: blocked,
      removeGuestAccident: blocked,
      // Vessel issues
      guestVesselIssues: DEMO_VESSEL_ISSUES || [],
      addGuestVesselIssue: blocked,
      updateGuestVesselIssue: blocked,
      removeGuestVesselIssue: blocked,
      // Cork notes
      guestCorkNotes: DEMO_ALL_CORK_NOTES,
      addGuestCorkNote: blocked,
      updateGuestCorkNote: blocked,
      removeGuestCorkNote: blocked,
      // Reminder settings
      guestReminderSettings: DEFAULT_REMINDER_SETTINGS,
      updateGuestReminderSettings: blocked,
      getStoredGuestReminderSettings: () => DEFAULT_REMINDER_SETTINGS,
      // Sign-up prompt. The app's own prompt stays shut: the preview has one
      // conversion moment, the blocked-write dialog, and two competing
      // prompts would read as nagging.
      showSignUpPrompt: false,
      setShowSignUpPrompt: () => {},
      // Demo banners inside the app are dismissed, since the whole frame is
      // already labelled as a demo by the marketing chrome around it.
      isDemoDismissed: true,
      dismissDemo: () => {},
      resetDemo: () => {},
      // Never expose the real clear/migrate paths. clearGuestData wipes the
      // visitor's actual localStorage, and migrateGuestDataIfNeeded writes
      // rows to Supabase on sign-in. Both would act on real data from a
      // marketing page.
      clearGuestData: () => {},
      migrateGuestDataIfNeeded: async () => {},
    };
  }, [onBlockedWrite]);

  return <GuestDataCtx.Provider value={value}>{children}</GuestDataCtx.Provider>;
}
