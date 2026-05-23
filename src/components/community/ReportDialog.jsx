import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/shared/GuestContext';
import { toast } from 'sonner';
import { Flag, Loader2 } from 'lucide-react';
import { C } from '@/lib/designTokens';

// 4 categorical reasons — matches the CHECK constraint on reported_posts.reason
// in supabase-add-ugc-moderation.sql. Keep these in sync if either side changes.
const REASONS = [
  { value: 'spam', label: 'ספאם או פרסום מסחרי', hint: 'תוכן חוזר, קישורים מטעים' },
  { value: 'harassment', label: 'הטרדה או שפה פוגענית', hint: 'איומים, הטרדה, שנאה' },
  { value: 'illegal', label: 'תוכן לא חוקי', hint: 'פלילי, פגיעה בזכויות, וכו' },
  { value: 'other', label: 'אחר', hint: 'פרטו למטה' },
];

export default function ReportDialog({ open, onClose, postId, postAuthorName }) {
  const { user } = useAuth();
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleClose = () => {
    setReason('');
    setDetails('');
    onClose?.();
  };

  const handleSubmit = async () => {
    if (!user) {
      toast.error('יש להתחבר כדי לדווח');
      return;
    }
    if (!reason) {
      toast.error('בחרו סיבה לדיווח');
      return;
    }
    setSubmitting(true);
    try {
      // supabase-js v2 returns errors in the response — must inspect explicitly.
      const { error } = await supabase.from('reported_posts').insert({
        post_id: postId,
        reporter_id: user.id,
        reason,
        details: details.trim() || null,
      });
      if (error) {
        // 23505 = unique_violation — user already reported this post.
        // Surface it as a friendly toast instead of a generic error so they
        // know the system already has their previous report.
        if (error.code === '23505') {
          toast.success('כבר דיווחת על הפוסט הזה. תודה!');
          handleClose();
          return;
        }
        console.warn('Report insert failed:', error.message);
        toast.error('לא הצלחנו לשלוח את הדיווח. נסו שוב.');
        return;
      }
      toast.success('הדיווח נשלח. נבדוק את התוכן בהקדם.');
      handleClose();
    } catch (e) {
      console.warn('Report network error:', e?.message);
      toast.error('שגיאה בשליחה');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent dir="rtl" className="max-w-md p-0 overflow-hidden">
        {/* Hero header */}
        <div className="px-5 pt-5 pb-4" style={{ background: `${C.primary}08`, borderBottom: `1px solid ${C.primary}15` }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold" style={{ color: C.text }}>
              <Flag className="w-4 h-4" style={{ color: '#DC2626' }} />
              דיווח על תוכן
            </DialogTitle>
            <p className="text-xs mt-1" style={{ color: C.muted }}>
              {postAuthorName ? `פוסט של ${postAuthorName}` : 'דיווח על הפוסט'}. הצוות יבדוק את הדיווח.
            </p>
          </DialogHeader>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          <fieldset className="space-y-2" disabled={submitting}>
            <legend className="text-xs font-bold mb-2" style={{ color: C.text }}>למה אתם מדווחים?</legend>
            {REASONS.map(r => (
              <label key={r.value}
                className="flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-all"
                style={{
                  borderColor: reason === r.value ? C.primary : '#E5E7EB',
                  background: reason === r.value ? `${C.primary}08` : '#fff',
                }}>
                <input type="radio" name="report-reason" value={r.value}
                  checked={reason === r.value}
                  onChange={(e) => setReason(e.target.value)}
                  className="mt-1 w-4 h-4 cursor-pointer"
                  style={{ accentColor: C.primary }} />
                <div className="flex-1">
                  <p className="text-sm font-semibold" style={{ color: C.text }}>{r.label}</p>
                  <p className="text-[11px] mt-0.5" style={{ color: C.muted }}>{r.hint}</p>
                </div>
              </label>
            ))}
          </fieldset>

          <div>
            <label className="text-xs font-bold mb-1.5 block" style={{ color: C.text }}>
              פרטים נוספים (אופציונלי)
            </label>
            <Textarea
              value={details}
              onChange={(e) => setDetails(e.target.value.slice(0, 500))}
              placeholder="הסבירו בקצרה למה התוכן בעייתי..."
              rows={3}
              disabled={submitting}
              className="resize-none text-sm"
            />
            <p className="text-[10px] mt-1 text-left" style={{ color: C.muted }}>
              {details.length}/500
            </p>
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-5 pb-5 pt-1 flex gap-2">
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting}
            className="flex-1 h-11 rounded-xl font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-50"
            style={{ background: '#F3F4F6', color: C.text }}>
            ביטול
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !reason}
            className="flex-1 h-11 rounded-xl font-bold text-sm text-white flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50"
            style={{ background: '#DC2626' }}>
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Flag className="w-4 h-4" />}
            {submitting ? 'שולח...' : 'שלח דיווח'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
