/**
 * The transfer manifest: what the seller chooses to hand over.
 *
 * Extracted from TransferVehicleDialog so the key set can be pinned by a test.
 * Each key here is read by name inside accept_vehicle_transfer, as
 *
 *     coalesce((v_manifest->>'services')::boolean, true)
 *
 * which means a key added on this side and not in the SQL does nothing at all,
 * silently: the seller ticks a box, the RPC never looks for it, and the data
 * either travels when they asked it not to or stays behind when they asked for
 * it. Neither shows up as an error anywhere. manifest.test.js reads the
 * migration file and refuses to let the two drift.
 */

import { Wrench, Banknote, ShieldAlert } from 'lucide-react';

export const MANIFEST_ITEMS = [
  {
    key: 'services',
    label: 'טיפולים ותיקונים',
    description: 'כל רשומה עם התאריך המקורי שלה',
    icon: Wrench,
    defaultOn: true,
  },
  {
    key: 'accidents',
    label: 'תאונות',
    description: 'תאריך, מיקום ותיאור הנזק',
    icon: ShieldAlert,
    defaultOn: true,
  },
  {
    // COSTS DEFAULTS OFF, and that is a decision rather than an oversight.
    // What someone paid for a clutch is their business, it is the one field a
    // buyer can use against them in a negotiation, and a default that leaks
    // money is the wrong default to be generous with. The other two default on
    // because they are the entire point of the feature.
    key: 'costs',
    label: 'עלויות',
    description: 'כמה שילמת על כל טיפול',
    icon: Banknote,
    defaultOn: false,
  },
];

export const MANIFEST_KEYS = MANIFEST_ITEMS.map(i => i.key);

export const defaultManifest = () =>
  Object.fromEntries(MANIFEST_ITEMS.map(i => [i.key, i.defaultOn]));
