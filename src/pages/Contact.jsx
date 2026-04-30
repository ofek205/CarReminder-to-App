import React, { useState } from 'react';
import { MessageSquare, Send, Loader2, CheckCircle2, User, Mail, FileText } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/shared/GuestContext';
import { toast } from 'sonner';
import { C } from '@/lib/designTokens';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

export default function Contact() {
  const { user } = useAuth();
  const [form, setForm] = useState({
    name: user?.full_name || '',
    email: user?.email || '',
    subject: '',
    message: '',
  });
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState(false);
  const [touched, setTouched] = useState({ name: false, email: false, message: false });

  const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((e || '').trim());
  const errors = {
    name: !form.name.trim() ? 'שם חובה' : '',
    email: !form.email.trim() ? 'אימייל חובה' : !isValidEmail(form.email) ? 'אימייל לא תקין' : '',
    message: !form.message.trim() ? 'הודעה חובה' : form.message.trim().length < 10 ? 'ההודעה קצרה מדי' : '',
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setTouched({ name: true, email: true, message: true });
    if (errors.name || errors.email || errors.message) {
      toast.error(errors.email || errors.name || errors.message);
      return;
    }
    setSaving(true);
    try {
      // supabase-js v2 does NOT throw on DB errors — it returns them in
      // the response object. We must inspect `error` explicitly; a
      // try/catch alone would let a missing-table / RLS-denied insert
      // silently masquerade as success and trigger a false "sent" toast.
      const { error: insertErr } = await supabase.from('contact_messages').insert({
        user_id: user?.id || null,
        name: form.name.trim(),
        email: form.email.trim(),
        subject: form.subject.trim() || 'פנייה כללית',
        message: form.message.trim(),
        status: 'new',
      });

      if (insertErr) {
        // Tell the user rather than falling back to a mailto URL, which
        // leaks name + email into browser history, referrer headers, and
        // any analytics pixel the default mail client happens to hit.
        console.warn('Contact message DB insert failed:', insertErr.message);
        toast.error('לא הצלחנו לשלוח את הפנייה. נסה שוב מאוחר יותר או שלח למייל support@car-reminder.app');
        setSaving(false);
        return;
      }

      setSent(true);
      toast.success('ההודעה נשלחה בהצלחה');
      setTimeout(() => {
        setForm({ name: user?.full_name || '', email: user?.email || '', subject: '', message: '' });
        setSent(false);
      }, 3000);
    } catch (outerErr) {
      // Network-level failure (e.g. offline) — supabase-js throws here.
      console.warn('Contact submit network error:', outerErr?.message);
      toast.error('שגיאה בשליחה');
    } finally {
      setSaving(false);
    }
  };

  if (sent) {
    return (
      <div className="-mx-4 -mt-4 min-h-[80vh] flex items-center justify-center" dir="rtl">
        <div className="text-center px-6">
          <div className="w-20 h-20 rounded-3xl mx-auto mb-5 flex items-center justify-center"
            style={{ background: C.grad }}>
            <CheckCircle2 className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-2xl font-bold mb-2" style={{ color: C.text }}>ההודעה נשלחה!</h1>
          <p className="text-sm" style={{ color: C.muted }}>נחזור אליך בהקדם האפשרי.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="-mx-4 -mt-4" dir="rtl">
      {/* Hero header */}
      <div className="rounded-3xl p-5 mb-5 relative overflow-hidden mx-4 mt-4"
        style={{ background: C.grad, boxShadow: `0 8px 32px ${C.primary}30` }}>
        <div className="absolute -top-10 -left-10 w-40 h-40 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }} />
        <div className="absolute -bottom-6 -right-6 w-28 h-28 rounded-full" style={{ background: 'rgba(255,191,0,0.15)' }} />
        <div className="relative z-10 flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.2)' }}>
            <MessageSquare className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">צור קשר</h1>
            <p className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.7)' }}>
              יש לך שאלה, הערה, או בקשה? נשמח לשמוע
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="px-4 pb-24 space-y-4">
        <div>
          <Label className="flex items-center gap-1.5 mb-1.5"><User className="w-3.5 h-3.5" /> שם מלא *</Label>
          <Input value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            onBlur={() => setTouched(t => ({ ...t, name: true }))}
            placeholder="השם שלך"
            aria-invalid={touched.name && !!errors.name}
            aria-describedby="contact-name-error" />
          {touched.name && errors.name && (
            <p id="contact-name-error" className="text-xs font-medium mt-1 flex items-center gap-1" style={{ color: '#DC2626' }}>⚠ {errors.name}</p>
          )}
        </div>
        <div>
          <Label className="flex items-center gap-1.5 mb-1.5"><Mail className="w-3.5 h-3.5" /> אימייל *</Label>
          <Input type="email" dir="ltr" value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            onBlur={() => setTouched(t => ({ ...t, email: true }))}
            placeholder="example@email.com"
            aria-invalid={touched.email && !!errors.email}
            aria-describedby="contact-email-error" />
          {touched.email && errors.email && (
            <p id="contact-email-error" className="text-xs font-medium mt-1 flex items-center gap-1" style={{ color: '#DC2626' }}>⚠ {errors.email}</p>
          )}
        </div>
        <div>
          <Label className="flex items-center gap-1.5 mb-1.5"><FileText className="w-3.5 h-3.5" /> נושא</Label>
          <Input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
            placeholder="על מה ברצונך לפנות?" />
        </div>
        <div>
          <Label className="mb-1.5 block">הודעה *</Label>
          <Textarea rows={6} value={form.message}
            onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
            onBlur={() => setTouched(t => ({ ...t, message: true }))}
            placeholder="כתוב את ההודעה שלך כאן..." className="resize-none"
            aria-invalid={touched.message && !!errors.message}
            aria-describedby="contact-message-error" />
          {touched.message && errors.message && (
            <p id="contact-message-error" className="text-xs font-medium mt-1 flex items-center gap-1" style={{ color: '#DC2626' }}>⚠ {errors.message}</p>
          )}
        </div>

        <button type="submit" disabled={saving}
          className="w-full h-14 rounded-2xl font-bold text-base flex items-center justify-center gap-2.5 transition-all active:scale-95 disabled:opacity-50"
          style={{ background: C.grad, color: '#fff', boxShadow: `0 6px 24px ${C.primary}35` }}>
          {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          {saving ? 'שולח...' : 'שלח הודעה'}
        </button>

        <p className="text-xs text-center" style={{ color: C.muted }}>
          נענה תוך 24-48 שעות. למקרה דחוף, ניתן לפנות ישירות ל-support@car-reminder.app
        </p>
      </form>
    </div>
  );
}
