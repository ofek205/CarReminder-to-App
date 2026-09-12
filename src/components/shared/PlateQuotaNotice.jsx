/**
 * PlateQuotaNotice — the inline "you are out of plate checks" message.
 *
 * Used by the form surfaces (AddVehicle, AddAccident) where the lookup is
 * one optional convenience inside a longer form. VehicleCheck uses its own
 * full-width card instead, because there the lookup IS the screen and an
 * inline note beside an empty result would leave nothing to look at.
 *
 * ⚠️ AMBER, NOT RED, AND THAT IS THE POINT OF A SEPARATE COMPONENT.
 * Nothing failed here: the account is working exactly as its plan says, and
 * the form still submits. Rendering it in the error colour would tell the
 * user something is broken and invite them to retry a request that will be
 * refused again for the same reason.
 *
 * The words, and whether a link is even permitted, come from
 * plateQuotaCopy. No screen decides that for itself: App Store Guideline
 * 3.1.1(a) covers prose rather than only controls, so "a paid plan exists"
 * is itself steering on iOS, and four surfaces each deciding it is four
 * chances for the one that is wrong to be a review rejection.
 */

import { Link } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { plateQuotaCopy } from '@/lib/plateQuotaGate';

export default function PlateQuotaNotice({ verdict, tail }) {
  const { title, body, cta } = plateQuotaCopy(verdict);

  return (
    <div className="mt-2 flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900">
      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-700" />
      <div className="flex-1 text-xs leading-relaxed">
        <p className="font-bold text-sm">{title}</p>
        {/* `tail` is the host form's own next step ("fill it in manually
            below"), which differs per screen and must not be baked into the
            shared copy. */}
        <p className="mt-1">{body}{tail ? ` ${tail}` : ''}</p>
        {cta === 'plan' && (
          <Link
            to={createPageUrl('MyPlan')}
            className="inline-block mt-2 font-bold underline underline-offset-2 hover:no-underline"
          >
            המסלול והמגבלות שלי
          </Link>
        )}
      </div>
    </div>
  );
}
