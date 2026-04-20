import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Send, CheckCircle2, XCircle } from 'lucide-react';
import { useEmailTemplate } from '@/hooks/useEmailAdmin';
import { renderFromTemplateObject } from '@/lib/emailRender';
import { extractPlaceholders } from '@/lib/emailValidate';
import { sendEmail } from '@/lib/sendEmail';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

/**
 * SendTestDialog — sends a test copy of a notification template to a
 * recipient the admin chooses. Renders the template with JSON variables,
 * then pipes through the regular sendEmail() (Edge Function → Resend).
 *
 * Note: test sends bypass the "enabled" flag on the notification — the
 * point is to preview while disabled. But they DO respect the global
 * kill switch, because sendEmail() will check it.
 */
export default function SendTestDialog({ notification, open, onClose }) {
  const { data: template } = useEmailTemplate(notification?.key);
  const [recipient, setRecipient] = useState('');
  const [varsJson, setVarsJson] = useState('{}');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null); // { ok, msg, id? }

  // Prefill recipient with the current user's email.
  useEffect(() => {
    if (!open) return;
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user?.email) setRecipient(data.user.email);
    });
    setResult(null);
  }, [open]);

  // Prefill vars from the template's declared variables with placeholder strings.
  useEffect(() => {
    if (!template) return;
    const declared = Array.isArray(template.variables) ? template.variables : [];
    // Also pick up anything used but not declared, just in case.
    const used = new Set([
      ...declared,
      ...extractPlaceholders(template.subject),
      ...extractPlaceholders(template.body_html),
      ...extractPlaceholders(template.cta_url),
    ]);
    const stub = {};
    for (const name of used) stub[name] = `[${name}]`;
    setVarsJson(JSON.stringify(stub, null, 2));
  }, [template]);

  if (!notification) return null;

  const handleSend = async () => {
    setResult(null);
    if (!template) {
      setResult({ ok: false, msg: 'אין תבנית שמורה — שמור קודם את התבנית ואז שלח בדיקה' });
      return;
    }
    if (!recipient.includes('@')) {
      setResult({ ok: false, msg: 'כתובת מייל לא תקינה' });
      return;
    }
    let parsedVars;
    try {
      parsedVars = JSON.parse(varsJson || '{}');
    } catch (e) {
      setResult({ ok: false, msg: 'ה-JSON של המשתנים לא תקין' });
      return;
    }

    setSending(true);
    try {
      const rendered = renderFromTemplateObject(template, parsedVars);
      const res = await sendEmail({
        to: recipient,
        subject: `[בדיקה] ${rendered.subject}`,
        html: rendered.html,
        text: rendered.text,
        from: `${rendered.fromName} <${rendered.fromEmail}>`,
        replyTo: rendered.replyTo || undefined,
      });
      setResult({ ok: true, msg: `נשלח ל-${recipient}`, id: res?.id });
      toast.success(`מייל בדיקה נשלח ל-${recipient}`);
    } catch (e) {
      setResult({ ok: false, msg: e.message || 'שליחה נכשלה' });
      toast.error(`נכשל: ${e.message}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose?.()}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>שליחת מייל בדיקה — {notification.display_name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <label className="text-xs font-bold text-gray-700 block mb-1">נמען</label>
            <Input
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              dir="ltr"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-gray-700 block mb-1">
              ערכי משתנים (JSON)
            </label>
            <Textarea
              value={varsJson}
              onChange={(e) => setVarsJson(e.target.value)}
              dir="ltr"
              rows={8}
              className="font-mono text-xs"
            />
            <p className="text-[10px] text-gray-400 mt-1">
              מולאו מראש לפי המשתנים שהצהרת בתבנית. ניתן לערוך לפני שליחה.
            </p>
          </div>

          {result && (
            <div className="rounded-xl p-3 flex gap-2 items-start"
              style={{
                background: result.ok ? '#ECFDF5' : '#FEF2F2',
                border: `1.5px solid ${result.ok ? '#A7F3D0' : '#FCA5A5'}`,
              }}>
              {result.ok
                ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#047857' }} />
                : <XCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#DC2626' }} />}
              <div className="flex-1">
                <p className="text-xs font-bold" style={{ color: result.ok ? '#064E3B' : '#991B1B' }}>
                  {result.msg}
                </p>
                {result.id && (
                  <p className="text-[10px] font-mono mt-1" dir="ltr" style={{ color: '#065F46' }}>
                    Resend ID: {result.id}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-xl">סגירה</Button>
          <Button
            onClick={handleSend}
            disabled={sending || !recipient}
            className="rounded-xl gap-2"
            style={{ background: '#2D5233', color: 'white' }}>
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            שלח בדיקה
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
