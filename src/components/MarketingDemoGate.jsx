/**
 * The preview's one conversion moment: shown when a visitor tries to write.
 *
 * Deliberately NOT a disabled-button treatment. Greying every write control
 * would tell the visitor the app is limited; letting them reach for the
 * action and then explaining why it stopped tells them the app is real and
 * the preview is the limit. That is also the only reason this dialog exists
 * rather than a silent no-op.
 *
 * "חזרה להדגמה" is not a courtesy. A visitor who cannot find a way back out
 * of a modal closes the tab, and then the conversion and the visit are both
 * gone. The escape stays cheap and visible.
 */
import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

const STORE_URL = '/website#download';

export default function MarketingDemoGate({ open, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
    return undefined;
  }, [open]);

  // A native <dialog> already closes on Esc, but it does it without telling
  // React, which would leave `open` true and wedge the dialog shut.
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const onCancel = () => onClose?.();
    el.addEventListener('close', onCancel);
    return () => el.removeEventListener('close', onCancel);
  }, [onClose]);

  return (
    <dialog ref={ref} className="cm-demo-gate" aria-labelledby="cm-demo-gate-title">
      <button type="button" className="cm-demo-gate-x" onClick={onClose} aria-label="סגירה">
        <X size={18} />
      </button>
      <h2 id="cm-demo-gate-title">זו תצוגת הדגמה</h2>
      <p>כדי לשמור רכבים, מסמכים ותזכורות משלכם צריך חשבון.</p>
      {/* One door, deliberately. An earlier version also offered "לכניסה
          לחשבון", and it was the wrong door twice over: someone playing with
          a preview on a marketing page is a prospect rather than a returning
          user, and the site header and footer already carry a sign-in link
          for the few who are. Two CTAs here only split the one decision the
          dialog exists to ask for.

          target="_top" matters: the preview runs in an iframe, and without it
          the store page would open inside the phone frame. */}
      <a className="cm-demo-gate-primary" href={STORE_URL} target="_top" rel="noopener">
        להורדת האפליקציה
      </a>
      <button type="button" className="cm-demo-gate-dismiss" onClick={onClose}>
        חזרה להדגמה
      </button>
    </dialog>
  );
}
