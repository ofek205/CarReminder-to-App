/**
 * AiDateScan — disabled.
 *
 * This was a small camera button that photographed an
 * insurance / pyro / certificate date label and asked an AI to
 * extract the expiry date. Disabled at product request: extraction
 * accuracy across the variety of real-world certificates wasn't
 * reliable enough, and the user preferred to enter dates manually.
 *
 * The component is intentionally kept as a no-op stub so every call
 * site (AddVehicle pyrotechnic expiry, etc.) continues to compile —
 * no per-page edits needed. If the AI scan is restored later, the
 * implementation lives in git history at the commit that introduced
 * this stub.
 */
 
export default function AiDateScan({ onDateExtracted, label }) {
  return null;
}
