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

// Sensible defaults for the admin's Send-Test flow. Used instead of the
// generic `[varName]` stub so a test send feels like a real email. Anything
// we don't know a default for falls back to the literal variable name 
// visible enough to edit, but not broken-looking.
function buildSmartStub(varName, ctx) {
  const today = new Date();
  const inDays = (n) => {
    const d = new Date(today); d.setDate(d.getDate() + n);
    return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };
  switch (varName) {
    case 'firstName':    return (ctx.firstName || 'ישראל');
    case 'inviterName':  return (ctx.fullName  || 'דנה כהן');
    case 'roleLabel':    return 'שותף';
    case 'inviteLink':   return 'https://car-reminder.app/JoinInvite?token=DEMO_TOKEN_1234';
    case 'vehicleName':  return 'טויוטה קורולה';
    case 'licensePlate': return '12-345-67';
    case 'daysLeft':     return '14';
    case 'expiryDate':   return inDays(14);
    case 'vehicleId':    return 'demo-vehicle-id';
    case 'reminderText': return 'טיפול 10,000 ק"מ';
    case 'title':        return 'הודעה מצוות CarReminder';
    case 'preheader':    return 'פרטים חשובים בפנים';
    case 'message':      return 'זוהי הודעה לדוגמה. בהמשך נוכל לכתוב פה תוכן אמיתי.';
    case 'ctaLabel':     return 'למידע נוסף';
    case 'ctaUrl':       return 'https://car-reminder.app';
    default:             return varName;  // visible, editable, not broken
  }
}

/**
 * SendTestDialog. sends a test copy of a notification template to a
 * recipient the admin chooses. Renders the template with JSON variables,
 * then pipes through the regular sendEmail() (Edge Function → Resend).
 *
 * Note: test sends bypass the "enabled" flag on the notification. the
 * point is to preview while disabled. But they DO respect the global
 * kill switch, because sendEmail() will check it.
 */
export default function SendTestDialog({ notification, open, onClose }) {
  const { data: template } = useEmailTemplate(notification?.key);
  const [recipient, setRecipient] = useState('');
  const [varsJson, setVarsJson] = useState('{}');
  const [sending, setSending] = useState(false);
  // Tracks the timestamp of the last successful send so rapid re-clicks
  // (admin hammering the button while debugging a template) are gated to
  // 1 per 3 seconds. Saves Resend quota and catches accidental duplicates.
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [result, setResult] = useState(null); // { ok, msg, id? }

  const [adminCtx, setAdminCtx] = useState({});

  // Prefill recipient + pull admin context (used to personalise stubs).
  useEffect(() => {
    if (!open) return;
    supabase.auth.getUser().then(({ data }) => {
      const u = data?.user;
      if (u?.email) setRecipient(u.email);
      const fullName = u?.user_metadata?.full_name || u?.user_metadata?.name || '';
      setAdminCtx({
        fullName: fullName || (u?.email ? u.email.split('@')[0] : ''),
        firstName: fullName ? fullName.split(/\s+/)[0] : '',
      });
    });
    setResult(null);
  }, [open]);

  // Prefill vars from the template's declared variables with smart defaults
  // (admin name → inviterName, sample license plate → licensePlate, etc.).
  // Admin can still edit the JSON before sending.
  useEffect(() => {
    if (!template) return;
    const declared = Array.isArray(template.variables) ? template.variables : [];
    const used = new Set([
      ...declared,
      ...extractPlaceholders(template.subject),
      ...extractPlaceholders(template.body_html),
      ...extractPlaceholders(template.cta_url),
    ]);
    const stub = {};
    for (const name of used) stub[name] = buildSmartStub(name, adminCtx);
    setVarsJson(JSON.stringify(stub, null, 2));
  }, [template, adminCtx]);

  if (!notification) return null;

  const handleSend = async () => {
    setResult(null);
    if (!template) {
      setResult({ ok: false, msg: 'אין תבנית שמורה. שמור קודם את התבנית, ואז שלח בדיקה.' });
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

    if (Date.now() < cooldownUntil) {
      const wait = Math.ceil((cooldownUntil - Date.now()) / 1000);
      setResult({ ok: false, msg: `נסה שוב בעוד ${wait} שניות` });
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
      setCooldownUntil(Date.now() + 3000);
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
          <DialogTitle>שליחת מייל בדיקה: {notification.display_name}</DialogTitle>
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
