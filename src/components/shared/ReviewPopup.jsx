import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Star, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { hapticFeedback } from "@/lib/capacitor";
import { C } from "@/lib/designTokens";

const TITLE_MAX = 60;
const BODY_MIN  = 10;
const BODY_MAX  = 500;

const VEHICLE_TYPES = ['רכב', 'כלי שייט', 'אופנוע', 'משאית', 'כלי שטח'];

// ── Interactive star rating ────────────────────────────────────────────────
function StarRating({ value, onChange }) {
  const [hover, setHover] = useState(0);
  const display = hover || value;

  return (
    <div className="flex items-center justify-center gap-2 py-3" dir="ltr"
      onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button"
          onClick={() => { hapticFeedback('light'); onChange(n); }}
          onMouseEnter={() => setHover(n)}
          aria-label={`${n} כוכבים`}
          className="transition-transform hover:scale-110 active:scale-95 p-1">
          <Star
            className={`w-10 h-10 transition-colors ${
              n <= display ? 'text-amber-400 fill-amber-400' : 'text-gray-200 fill-gray-200'
            }`}
          />
        </button>
      ))}
    </div>
  );
}

// ── Short label under the stars ────────────────────────────────────────────
const RATING_LABELS = {
  1: 'גרוע',
  2: 'לא טוב',
  3: 'סביר',
  4: 'טוב',
  5: 'מצוין',
};

export default function ReviewPopup({ open, onClose, userId, userEmail, userName }) {
  const [rating, setRating]           = useState(0);
  const [title, setTitle]             = useState('');
  const [body, setBody]               = useState('');
  const [vehicleType, setVehicleType] = useState('רכב');
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState('');

  const reset = () => {
    setRating(0); setTitle(''); setBody(''); setVehicleType('רכב');
    setSubmitting(false); setError('');
  };

  const handleClose = (result) => {
    reset();
    onClose?.(result);
  };

  const bodyTrimmed = body.trim();
  const canSubmit = rating > 0 && bodyTrimmed.length >= BODY_MIN && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      // Basic client-side spam guard: one review per 24h per user.
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: recent } = await supabase.from('reviews')
        .select('id')
        .eq('user_id', userId)
        .gte('created_at', dayAgo)
        .limit(1);
      if (recent && recent.length > 0) {
        setError('כבר שיתפת חוות דעת ביממה האחרונה — תודה!');
        setSubmitting(false);
        return;
      }

      const payload = {
        user_id: userId,
        author_name: (userName || userEmail?.split('@')[0] || 'משתמש').slice(0, 60),
        rating,
        title: title.trim() || null,
        body: bodyTrimmed,
        vehicle_type: vehicleType,
        is_verified: false,
      };

      const { error: insertError } = await supabase.from('reviews').insert(payload);
      if (insertError) throw insertError;

      hapticFeedback('medium');
      toast.success('תודה על חוות הדעת! 🙏');
      handleClose('submitted');
    } catch (e) {
      const msg = e?.message?.includes('row-level security')
        ? 'אין הרשאה לפרסם — ודא שאתה מחובר'
        : 'השליחה נכשלה, נסה שוב';
      setError(msg);
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent dir="rtl" className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-right font-black text-lg">כתוב חוות דעת</DialogTitle>
        </DialogHeader>

        {/* Step 1: rating */}
        <div className="text-center">
          <Label className="text-sm font-bold text-gray-700 block mb-1">איך היית מדרג?</Label>
          <StarRating value={rating} onChange={setRating} />
          <p className="text-xs font-bold h-4" style={{ color: rating > 0 ? '#B45309' : 'transparent' }}>
            {rating > 0 ? RATING_LABELS[rating] : '—'}
          </p>
        </div>

        {/* Step 2: details (revealed after rating) */}
        {rating > 0 && (
          <div className="space-y-4 pt-2">
            {/* Title */}
            <div>
              <Label htmlFor="review-title" className="text-sm font-bold text-gray-700 block mb-1.5">
                כותרת <span className="text-gray-400 font-normal">(לא חובה)</span>
              </Label>
              <Input id="review-title"
                value={title}
                onChange={e => setTitle(e.target.value.slice(0, TITLE_MAX))}
                placeholder="במילה אחת — מה הרושם שלך?"
                maxLength={TITLE_MAX}
                className="text-right" />
              <p className="text-[10px] text-gray-400 mt-1 text-left" dir="ltr">{title.length}/{TITLE_MAX}</p>
            </div>

            {/* Body */}
            <div>
              <Label htmlFor="review-body" className="text-sm font-bold text-gray-700 block mb-1.5">
                מה היה טוב או פחות טוב? <span className="text-red-500">*</span>
              </Label>
              <Textarea id="review-body"
                value={body}
                onChange={e => setBody(e.target.value.slice(0, BODY_MAX))}
                placeholder="ספר לנו על החוויה שלך — מה עזר, מה היה פחות מוצלח, ומה חסר"
                rows={5}
                maxLength={BODY_MAX}
                className="text-right resize-none" />
              <div className="flex items-center justify-between mt-1">
                <p className="text-[10px]" style={{ color: bodyTrimmed.length < BODY_MIN ? '#DC2626' : '#9CA3AF' }}>
                  {bodyTrimmed.length < BODY_MIN ? `מינימום ${BODY_MIN} תווים` : ' '}
                </p>
                <p className="text-[10px] text-gray-400" dir="ltr">{body.length}/{BODY_MAX}</p>
              </div>
            </div>

            {/* Vehicle type */}
            <div>
              <Label className="text-sm font-bold text-gray-700 block mb-1.5">סוג כלי</Label>
              <Select value={vehicleType} onValueChange={setVehicleType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VEHICLE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {error && (
              <div className="rounded-lg px-3 py-2 text-xs font-bold"
                style={{ background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA' }}>
                {error}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-3 sticky bottom-0 bg-white">
          <Button variant="outline" onClick={() => handleClose()} disabled={submitting} className="flex-1">
            ביטול
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}
            className="flex-1 gap-1.5"
            style={{ background: canSubmit ? C.greenDark : '#D1D5DB', color: '#fff' }}>
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            שלח
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
