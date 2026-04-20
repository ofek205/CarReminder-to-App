import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Save, AlertTriangle, Eye, Code, Smartphone, Monitor, History, Rocket, CircleDot } from 'lucide-react';
import { useEmailTemplate, useSaveEmailTemplate, usePublishTemplate } from '@/hooks/useEmailAdmin';
import { validateTemplate, extractPlaceholders } from '@/lib/emailValidate';
import { renderFromTemplateObject } from '@/lib/emailRender';
import { toast } from 'sonner';
import VersionHistoryDialog from './VersionHistoryDialog';

/**
 * TemplateEditorDialog — full editor for a single notification's template.
 *
 * Layout: two columns on desktop, tabs on mobile.
 *   - Left  = form (subject, preheader, title, body, CTA, footer)
 *   - Right = tabs: Preview | Source (final HTML) | Variables
 *
 * Save is blocked if validateTemplate() returns errors — prevents silent
 * {{foo}} leaking to production (architect's #2 fix).
 */

const SAMPLE_VARS = {
  invite:               { inviterName: 'דנה כהן', roleLabel: 'שותף', inviteLink: 'https://car-reminder.app/JoinInvite?token=sample' },
  welcome:              { firstName: 'אופק' },
  reminder_insurance:   { vehicleName: 'מאזדה 3', licensePlate: '12-345-67', daysLeft: '14', expiryDate: '10/06/2026', vehicleId: 'abc' },
  reminder_test:        { vehicleName: 'מאזדה 3', licensePlate: '12-345-67', daysLeft: '7',  expiryDate: '27/05/2026', vehicleId: 'abc' },
  reminder_maintenance: { vehicleName: 'מאזדה 3', licensePlate: '12-345-67', reminderText: 'טיפול 10,000 ק"מ', vehicleId: 'abc' },
  reminder_license:     { vehicleName: 'מאזדה 3', licensePlate: '12-345-67', daysLeft: '21', expiryDate: '15/06/2026', vehicleId: 'abc' },
  system_alert:         { title: 'תחזוקה מתוזמנת', preheader: 'השירות ירד לכמה דקות', message: 'ב-23:00 הערב השירות ירד לעדכון. נחזור עד 23:30.', ctaLabel: 'לפרטים', ctaUrl: 'https://car-reminder.app' },
};

export default function TemplateEditorDialog({ notification, open, onClose }) {
  const { data: existingTemplate, isLoading } = useEmailTemplate(notification?.key);
  const save = useSaveEmailTemplate();
  const publish = usePublishTemplate();
  const [draft, setDraft] = useState(null);
  const [previewMode, setPreviewMode] = useState('desktop');
  const [historyOpen, setHistoryOpen] = useState(false);

  // A draft is "unpublished" if the row was saved since the last publish.
  const hasUnpublishedChanges = !!(
    existingTemplate?.id &&
    existingTemplate?.updated_at &&
    (!existingTemplate?.published_at || new Date(existingTemplate.updated_at) > new Date(existingTemplate.published_at))
  );

  // When template loads, copy it into local draft state so edits are buffered.
  useEffect(() => {
    if (existingTemplate) {
      setDraft({ ...existingTemplate });
    } else if (notification && !isLoading) {
      // No template row yet — prepare a blank one.
      setDraft({
        notification_key: notification.key,
        subject: '',
        preheader: '',
        title: notification.display_name,
        body_html: '<p></p>',
        cta_label: '',
        cta_url: '',
        footer_note: '',
        from_name: 'CarReminder',
        from_email: 'no-reply@car-reminder.app',
        reply_to: '',
        variables: [],
      });
    }
  }, [existingTemplate, notification, isLoading]);

  const validation = useMemo(() => {
    if (!draft) return { ok: true, errors: [], warnings: [], found: [], declared: [] };
    return validateTemplate(draft);
  }, [draft]);

  // Live preview render
  const preview = useMemo(() => {
    if (!draft) return null;
    const sampleVars = SAMPLE_VARS[notification?.key] || {};
    try {
      return renderFromTemplateObject(draft, sampleVars);
    } catch (e) {
      return { error: e.message };
    }
  }, [draft, notification]);

  if (!notification) return null;

  const update = (patch) => setDraft(d => ({ ...d, ...patch }));

  const handleSave = async () => {
    const v = validateTemplate(draft);
    if (!v.ok) {
      toast.error(`לא ניתן לשמור — ${v.errors.length} שגיאות במשתנים`);
      return;
    }
    try {
      await save.mutateAsync(draft);
      toast.success('נשמר כטיוטה. לחצ/י "פרסם" כדי שזה יצא למשתמשים.');
    } catch (e) {
      toast.error(`שמירה נכשלה: ${e.message}`);
    }
  };

  const handlePublish = async () => {
    // If the draft has unsaved edits, save them first.
    const v = validateTemplate(draft);
    if (!v.ok) { toast.error(`לא ניתן לפרסם — ${v.errors.length} שגיאות במשתנים`); return; }
    try {
      if (existingTemplate && JSON.stringify(draft) !== JSON.stringify(existingTemplate)) {
        await save.mutateAsync(draft);
      }
      await publish.mutateAsync({ templateId: existingTemplate.id, notificationKey: notification.key });
      toast.success('פורסם! מעכשיו המיילים יוצאים עם הגרסה הזו.');
      onClose?.();
    } catch (e) {
      toast.error(`פרסום נכשל: ${e.message}`);
    }
  };

  // Auto-sync declared variables from content when admin clicks "רענן משתנים"
  const detectVariables = () => {
    if (!draft) return;
    const detected = new Set();
    ['subject','preheader','title','body_html','cta_label','cta_url','footer_note'].forEach(f => {
      extractPlaceholders(draft[f]).forEach(n => detected.add(n));
    });
    update({ variables: Array.from(detected) });
    toast.success(`זוהו ${detected.size} משתנים`);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose?.()}>
      <DialogContent dir="rtl" className="max-w-5xl max-h-[92vh] p-0 gap-0 flex flex-col overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <DialogTitle className="text-lg font-bold">
              עריכת תבנית — {notification.display_name}
            </DialogTitle>
            {existingTemplate?.id && (
              hasUnpublishedChanges ? (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"
                  style={{ background: '#FEF3C7', color: '#92400E' }}>
                  <CircleDot className="w-2.5 h-2.5" />
                  טיוטה לא מפורסמת
                </span>
              ) : (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: '#D1FAE5', color: '#047857' }}>
                  מפורסם
                </span>
              )
            )}
          </div>
          <p className="text-xs text-gray-500 font-mono" dir="ltr">{notification.key}</p>
        </DialogHeader>

        {!draft ? (
          <div className="flex-1 flex items-center justify-center p-12">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : (
          <div className="flex-1 overflow-hidden grid md:grid-cols-2">

            {/* LEFT — editor form */}
            <div className="overflow-y-auto p-6 border-l">
              <div className="space-y-4">

                {/* Validation banner */}
                {!validation.ok && (
                  <div className="rounded-xl p-3 flex gap-2"
                    style={{ background: '#FEF2F2', border: '1.5px solid #FCA5A5' }}>
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#DC2626' }} />
                    <div className="flex-1">
                      <p className="text-xs font-bold mb-1" style={{ color: '#991B1B' }}>
                        {validation.errors.length} שגיאות משתנים
                      </p>
                      <ul className="text-xs space-y-0.5" style={{ color: '#7F1D1D' }}>
                        {validation.errors.map((e, i) => <li key={i}>• {e}</li>)}
                      </ul>
                    </div>
                  </div>
                )}

                <Field label="Subject (נושא המייל)" hint="המופיע בתיבה של הנמען">
                  <Input value={draft.subject || ''} onChange={(e) => update({ subject: e.target.value })} dir="rtl" />
                </Field>

                <Field label="Preheader" hint="טקסט התצוגה המקדימה ב-Gmail/iOS">
                  <Input value={draft.preheader || ''} onChange={(e) => update({ preheader: e.target.value })} dir="rtl" />
                </Field>

                <Field label="כותרת ראשית" hint="הכותרת הגדולה בראש המייל">
                  <Input value={draft.title || ''} onChange={(e) => update({ title: e.target.value })} dir="rtl" />
                </Field>

                <Field label="גוף המייל (HTML)" hint="תומך ב-{{variables}} ותגיות HTML רגילות">
                  <Textarea
                    value={draft.body_html || ''}
                    onChange={(e) => update({ body_html: e.target.value })}
                    dir="ltr"
                    rows={8}
                    className="font-mono text-xs"
                  />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="תווית הכפתור (CTA)">
                    <Input value={draft.cta_label || ''} onChange={(e) => update({ cta_label: e.target.value })} dir="rtl" />
                  </Field>
                  <Field label="URL של הכפתור">
                    <Input value={draft.cta_url || ''} onChange={(e) => update({ cta_url: e.target.value })} dir="ltr" />
                  </Field>
                </div>

                <Field label="הערת פוטר" hint="טקסט קטן מתחת לקו">
                  <Textarea value={draft.footer_note || ''} onChange={(e) => update({ footer_note: e.target.value })} dir="rtl" rows={2} />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="שם השולח">
                    <Input value={draft.from_name || ''} onChange={(e) => update({ from_name: e.target.value })} dir="rtl" />
                  </Field>
                  <Field label="כתובת השולח">
                    <Input value={draft.from_email || ''} onChange={(e) => update({ from_email: e.target.value })} dir="ltr" />
                  </Field>
                </div>

                <Field label="Reply-To (אופציונלי)">
                  <Input value={draft.reply_to || ''} onChange={(e) => update({ reply_to: e.target.value })} dir="ltr" placeholder="support@car-reminder.app" />
                </Field>

                {/* Variables */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-bold text-gray-700">משתנים מוצהרים</label>
                    <Button variant="outline" size="sm" onClick={detectVariables} className="h-7 text-xs rounded-lg">
                      רענן משתנים מהתוכן
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 p-2.5 rounded-lg border bg-gray-50 min-h-[40px]">
                    {(draft.variables || []).length === 0 && (
                      <span className="text-xs text-gray-400">אין משתנים מוגדרים</span>
                    )}
                    {(draft.variables || []).map(v => (
                      <span key={v} className="text-xs font-mono px-2 py-0.5 rounded-md"
                        style={{ background: '#E0F2FE', color: '#075985' }} dir="ltr">
                        {'{{'}{v}{'}}'}
                      </span>
                    ))}
                  </div>
                  {validation.warnings.length > 0 && (
                    <div className="mt-2 text-[11px] text-amber-700">
                      {validation.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
                    </div>
                  )}
                </div>

              </div>
            </div>

            {/* RIGHT — preview */}
            <div className="overflow-y-auto bg-gray-50">
              <Tabs defaultValue="preview" className="w-full">
                <TabsList className="rounded-none border-b w-full justify-start px-4 bg-white">
                  <TabsTrigger value="preview" className="gap-2"><Eye className="w-3.5 h-3.5" /> תצוגה מקדימה</TabsTrigger>
                  <TabsTrigger value="source" className="gap-2"><Code className="w-3.5 h-3.5" /> HTML</TabsTrigger>
                </TabsList>

                <TabsContent value="preview" className="m-0">
                  <div className="flex items-center justify-center gap-1 py-2 border-b bg-white">
                    <Button variant={previewMode === 'desktop' ? 'default' : 'ghost'} size="sm"
                      onClick={() => setPreviewMode('desktop')} className="h-7 gap-1 text-xs rounded-lg">
                      <Monitor className="w-3.5 h-3.5" /> שולחן עבודה
                    </Button>
                    <Button variant={previewMode === 'mobile' ? 'default' : 'ghost'} size="sm"
                      onClick={() => setPreviewMode('mobile')} className="h-7 gap-1 text-xs rounded-lg">
                      <Smartphone className="w-3.5 h-3.5" /> מובייל
                    </Button>
                  </div>
                  <div className="p-4 flex justify-center">
                    {preview?.error ? (
                      <div className="p-4 text-xs text-red-600 bg-red-50 rounded-lg w-full">{preview.error}</div>
                    ) : (
                      <iframe
                        title="email preview"
                        sandbox=""
                        srcDoc={preview?.html || ''}
                        style={{
                          width: previewMode === 'mobile' ? 375 : '100%',
                          maxWidth: 640,
                          height: 720,
                          border: '1px solid #E5E7EB',
                          borderRadius: 12,
                          background: 'white',
                          boxShadow: '0 4px 16px rgba(0,0,0,0.05)',
                        }}
                      />
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="source" className="m-0 p-4">
                  <div className="mb-3 space-y-1 text-xs font-mono" dir="ltr" style={{ color: '#1C3620' }}>
                    <div><strong>Subject:</strong> {preview?.subject}</div>
                    <div><strong>From:</strong> {preview?.fromName} &lt;{preview?.fromEmail}&gt;</div>
                    {preview?.replyTo && <div><strong>Reply-To:</strong> {preview.replyTo}</div>}
                  </div>
                  <Textarea
                    value={preview?.html || ''}
                    readOnly
                    dir="ltr"
                    rows={28}
                    className="font-mono text-[10px]"
                  />
                </TabsContent>
              </Tabs>
            </div>
          </div>
        )}

        <DialogFooter className="px-6 py-3 border-t shrink-0 bg-white gap-2">
          {existingTemplate?.id && (
            <Button
              variant="outline"
              onClick={() => setHistoryOpen(true)}
              className="rounded-xl gap-2 mr-auto">
              <History className="w-4 h-4" />
              היסטוריית גרסאות
            </Button>
          )}
          <Button variant="outline" onClick={onClose} className="rounded-xl">סגירה</Button>
          <Button
            variant="outline"
            onClick={handleSave}
            disabled={save.isPending || !validation.ok}
            className="rounded-xl gap-2">
            {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            שמור טיוטה
          </Button>
          <Button
            onClick={handlePublish}
            disabled={publish.isPending || save.isPending || !validation.ok}
            className="rounded-xl gap-2"
            style={{ background: '#2D5233', color: 'white' }}>
            {publish.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
            פרסם
          </Button>
        </DialogFooter>

        <VersionHistoryDialog
          template={existingTemplate}
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="text-xs font-bold text-gray-700 block mb-1">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}
