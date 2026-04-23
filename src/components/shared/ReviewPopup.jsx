import React, { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Star, Loader2, Send, Heart } from "lucide-react";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { hapticFeedback } from "@/lib/capacitor";
import { C } from "@/lib/designTokens";

const TITLE_MAX = 60;
const BODY_MIN  = 10;
const BODY_MAX  = 500;

const VEHICLE_TYPES = ['רכב', 'כלי שייט', 'אופנוע', 'משאית', 'כלי שטח'];

//  Interactive star rating 
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

//  Short label under the stars 
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
        setError('כבר שיתפת חוות דעת ביממה האחרונה. תודה!');
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
        ? 'אין הרשאה לפרסם. ודא שאתה מחובר'
        : 'השליחה נכשלה, נסה שוב';
      setError(msg);
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent dir="rtl"
        className="max-w-md max-h-[92vh] overflow-y-auto p-0 border-0 rounded-3xl"
        style={{ boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>

        {/* Screen-reader title; visual title lives in the hero. */}
        <VisuallyHidden.Root>
          <DialogTitle>חוות דעת על CarReminder</DialogTitle>
        </VisuallyHidden.Root>

        {/*  Warm hero. Sets the tone — this is a genuine ask, not a nag.
           Note on design: most users who decline a rating prompt do so because
           the prompt feels transactional. A heart icon + a human framing ("we
           listen") converts better than a dry "rate us". */}
        <div className="relative overflow-hidden rounded-t-3xl"
          style={{
            background: 'linear-gradient(165deg, #1C3620 0%, #2D5233 45%, #4A8C5C 100%)',
            padding: '28px 24px 22px',
          }}>
          <div className="absolute pointer-events-none rounded-full"
            style={{ top: -40, right: -40, width: 140, height: 140, background: 'rgba(255,255,255,0.08)' }} />
          <div className="absolute pointer-events-none rounded-full"
            style={{ bottom: -30, left: -30, width: 100, height: 100, background: 'rgba(255,191,0,0.06)' }} />

          <div className="flex justify-center relative z-10">
            <div className="flex items-center justify-center"
              style={{
                width: 56, height: 56, borderRadius: 18,
                background: 'rgba(255,255,255,0.15)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                border: '1.5px solid rgba(255,255,255,0.2)',
              }}>
              <Heart className="w-7 h-7 text-white" strokeWidth={2} fill="rgba(255,255,255,0.15)" />
            </div>
          </div>

          <p className="text-center mt-3 text-[11px] font-bold relative z-10"
            style={{ letterSpacing: '0.25em', color: 'rgba(255,255,255,0.85)' }}>
            CARREMINDER
          </p>

          <h2 className="text-center mt-1.5 text-xl font-black text-white leading-tight relative z-10">
            איך החוויה שלך עד עכשיו?
          </h2>

          <p className="text-center mt-2 text-[12px] leading-relaxed px-2 relative z-10"
            style={{ color: 'rgba(255,255,255,0.82)' }}>
            הדעה שלך עוזרת לנו לשפר ולהוסיף פיצ'רים שחשובים לך
          </p>
        </div>

        {/*  Body  */}
        <div className="px-6 pt-5 pb-5">

          {/* Stars */}
          <div className="text-center">
            <Label className="text-[13px] font-bold text-gray-700 block">דירוג</Label>
            <StarRating value={rating} onChange={setRating} />
            <p className="text-xs font-bold h-4 transition-colors"
              style={{ color: rating > 0 ? '#B45309' : 'transparent' }}>
              {rating > 0 ? RATING_LABELS[rating] : '\u00A0'}
            </p>
          </div>

          {/* Details — revealed only after a star is picked, keeping the
              initial view minimal and welcoming. */}
          {rating > 0 && (
            <div className="space-y-3.5 pt-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
              <div>
                <Label htmlFor="review-title" className="text-[13px] font-bold text-gray-700 block mb-1.5">
                  כותרת <span className="text-gray-400 font-normal">(לא חובה)</span>
                </Label>
                <Input id="review-title"
                  value={title}
                  onChange={e => setTitle(e.target.value.slice(0, TITLE_MAX))}
                  placeholder="במילה אחת, מה הרושם שלך?"
                  maxLength={TITLE_MAX}
                  className="text-right rounded-xl" />
                <p className="text-[10px] text-gray-400 mt-1 text-left" dir="ltr">{title.length}/{TITLE_MAX}</p>
              </div>

              <div>
                <Label htmlFor="review-body" className="text-[13px] font-bold text-gray-700 block mb-1.5">
                  ספר לנו עוד <span className="text-red-500">*</span>
                </Label>
                <Textarea id="review-body"
                  value={body}
                  onChange={e => setBody(e.target.value.slice(0, BODY_MAX))}
                  placeholder="מה עבד טוב, מה היה פחות מוצלח, ומה היית רוצה להוסיף"
                  rows={4}
                  maxLength={BODY_MAX}
                  className="text-right resize-none rounded-xl" />
                <div className="flex items-center justify-between mt-1">
                  <p className="text-[10px]" style={{ color: bodyTrimmed.length < BODY_MIN ? '#DC2626' : '#9CA3AF' }}>
                    {bodyTrimmed.length < BODY_MIN ? `מינימום ${BODY_MIN} תווים` : ' '}
                  </p>
                  <p className="text-[10px] text-gray-400" dir="ltr">{body.length}/{BODY_MAX}</p>
                </div>
              </div>

              <div>
                <Label className="text-[13px] font-bold text-gray-700 block mb-1.5">איזה כלי?</Label>
                <Select value={vehicleType} onValueChange={setVehicleType}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {VEHICLE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {error && (
                <div className="rounded-xl px-3 py-2 text-xs font-bold"
                  style={{ background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA' }}>
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Actions. Primary gets the brand gradient; secondary is a low-
              weight outline so dismissing doesn't feel like failure. */}
          <div className="flex gap-2 pt-5">
            <Button variant="outline" onClick={() => handleClose()} disabled={submitting}
              className="flex-1 rounded-xl h-11 text-[13px] font-semibold">
              לא עכשיו
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit}
              className="flex-1 gap-1.5 rounded-xl h-11 text-[14px] font-extrabold transition-all active:translate-y-px"
              style={{
                background: canSubmit
                  ? 'linear-gradient(135deg, #2D5233 0%, #4A8C5C 100%)'
                  : '#D1D5DB',
                color: '#fff',
                boxShadow: canSubmit ? '0 8px 20px -6px rgba(45,82,51,0.4)' : 'none',
              }}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              שלח
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
