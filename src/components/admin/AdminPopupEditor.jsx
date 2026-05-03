import React, { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ChevronDown, ChevronUp, ArrowRight, Save, Eye, Rocket, Loader2, Sparkles,
} from 'lucide-react';
import PopupRenderer from '@/components/shared/PopupRenderer';
import {
  CATEGORIES, STATUSES, THEMES, SIZES, TRIGGERS, TARGETABLE_PAGES,
  SEGMENTS, USER_TYPES, HAS_VEHICLE_OPTIONS, FREQUENCIES,
  CTA_ACTIONS, ICON_OPTIONS,
} from '@/lib/popups/constants';

/**
 * AdminPopupEditor — split-pane editor.
 *
 * LEFT: sections of form fields (pretty + content + design + trigger +
 *       conditions + frequency) with progressive disclosure.
 * RIGHT: live preview that renders the current in-flight popup exactly
 *        as a real user would see it, using the same <PopupRenderer>.
 *
 * Top sticky bar: "← back", save draft, preview on-device ("הצג עכשיו לי
 * בלבד"), publish. Publish is disabled until required fields are valid.
 */
const DEFAULTS = {
  name: '',
  category: 'engagement',
  status: 'draft',
  description: '',
  content: {
    title: '',
    body: '',
    icon: 'Sparkles',
    primary_cta:   { label: 'המשך', action: 'dismiss', target: '' },
    secondary_cta: { label: 'לא עכשיו' },
  },
  design: { theme: 'brand', size: 'center' },
  trigger: { kind: 'on_login' },
  conditions: { segment: 'all', user_type: 'authenticated', has_vehicle: null },
  frequency: { kind: 'once' },
  priority: 100,
  starts_at: null,
  ends_at: null,
};

export default function AdminPopupEditor({ popup, onClose, onSaved }) {
  const [form, setForm] = useState(() => popup ? mergeDefaults(popup) : DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const isSystem = !!popup?.is_system;

  // Section expand/collapse. First two open by default (essentials).
  const [open, setOpen] = useState({
    general: true, content: true, design: false,
    trigger: false, conditions: false, frequency: false,
  });

  const toggleSection = (key) => setOpen(o => ({ ...o, [key]: !o[key] }));

  //  Validation — publish gate
  const errors = useMemo(() => {
    const e = {};
    if (!form.name?.trim()) e.name = 'שם הוא שדה חובה';
    if (!form.content?.title?.trim()) e.title = 'כותרת היא שדה חובה לפרסום';
    if (!form.trigger?.kind) e.trigger = 'יש לבחור טריגר';
    if (form.trigger?.kind === 'on_page_view' && !form.trigger?.path) e.triggerPath = 'בחר עמוד יעד';
    if (form.trigger?.kind === 'after_delay' && !form.trigger?.delay_seconds) e.triggerDelay = 'הזן השהיה בשניות';
    return e;
  }, [form]);

  const canPublish = Object.keys(errors).length === 0;

  //  Save helpers
  const serializable = useMemo(() => {
    // Strip empty CTAs so they don't render as empty buttons
    const content = { ...form.content };
    if (!content.primary_cta?.label?.trim()) delete content.primary_cta;
    if (!content.secondary_cta?.label?.trim()) delete content.secondary_cta;
    return {
      name: form.name?.trim(),
      category: form.category,
      status: form.status,
      description: form.description?.trim() || null,
      content,
      design: form.design,
      trigger: form.trigger,
      conditions: form.conditions,
      frequency: form.frequency,
      priority: Number(form.priority) || 100,
      starts_at: form.starts_at || null,
      ends_at: form.ends_at || null,
    };
  }, [form]);

  const handleSave = async (nextStatus) => {
    const payload = { ...serializable };
    if (nextStatus) payload.status = nextStatus;
    if (nextStatus === 'active' && !canPublish) {
      toast.error('לא ניתן לפרסם, יש שדות חובה שחסרים');
      return;
    }
    const setter = nextStatus === 'active' ? setPublishing : setSaving;
    setter(true);
    try {
      if (popup?.id) {
        const { error } = await supabase.from('admin_popups').update(payload).eq('id', popup.id);
        if (error) throw error;
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        const { error } = await supabase.from('admin_popups').insert({ ...payload, created_by: user?.id });
        if (error) throw error;
      }
      toast.success(nextStatus === 'active' ? 'פורסם 🚀' : 'נשמר');
      onSaved?.();
    } catch (e) {
      toast.error(`שמירה נכשלה: ${e.message}`);
    } finally {
      setter(false);
    }
  };

  const handleShowNow = () => {
    if (!popup?.id) {
      toast.info('שמור קודם, ואז תוכל להציג על המכשיר שלך לבדיקה');
      return;
    }
    window.dispatchEvent(new CustomEvent('cr:popup:manual', { detail: { popupId: popup.id } }));
    toast.success('שלוח, הפופ-אפ יופיע עכשיו בסשן שלך');
  };

  //  Previewable popup (live updates from form)
  const previewPopup = useMemo(() => ({
    ...(popup || {}),
    content:    form.content,
    design:     form.design,
    trigger:    form.trigger,
    conditions: form.conditions,
  }), [form, popup]);

  //  UI
  return (
    <div dir="rtl" className="space-y-4">
      {/* Sticky top bar */}
      <div className="sticky top-0 z-30 bg-white border-b border-gray-100 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="flex items-center gap-1 px-3 h-9 rounded-lg text-xs font-bold text-gray-600 hover:bg-gray-100">
            <ArrowRight className="w-3.5 h-3.5" /> חזרה
          </button>
          <h2 className="text-base font-bold text-gray-900">
            {popup ? `עריכה: ${popup.name}` : 'פופ-אפ חדש'}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {isSystem ? (
            <span className="text-[11px] font-bold px-3 py-1.5 rounded-full bg-gray-100 text-gray-500">
              🔒 פופ-אפ מערכת — צפייה בלבד
            </span>
          ) : (
            <>
              <button onClick={handleShowNow}
                title="שלח את הפופ-אפ לסשן הנוכחי שלך (ללא פרסום למשתמשים אחרים)"
                className="h-9 px-3 rounded-lg text-xs font-bold bg-amber-50 text-amber-700 hover:bg-amber-100 flex items-center gap-1.5 border border-amber-100">
                <Eye className="w-3.5 h-3.5" /> הצג עכשיו לי בלבד
              </button>
              <button onClick={() => handleSave('draft')} disabled={saving}
                className="h-9 px-3 rounded-lg text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 flex items-center gap-1.5 disabled:opacity-50">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} שמור טיוטה
              </button>
              <button onClick={() => handleSave('active')} disabled={publishing || !canPublish}
                title={canPublish ? '' : 'השלם שדות חובה כדי לפרסם'}
                className="h-9 px-4 rounded-lg text-xs font-bold text-white flex items-center gap-1.5 disabled:opacity-50 shadow-sm"
                style={{ background: canPublish ? '#2D5233' : '#9CA3AF' }}>
                {publishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rocket className="w-3.5 h-3.5" />} פרסם
              </button>
            </>
          )}
        </div>
      </div>

      {/* System-popup notice — pins right under the sticky bar. */}
      {isSystem && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-3">
          <Eye className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
          <div className="text-xs leading-relaxed text-amber-800">
            <p className="font-bold">פופ-אפ של המערכת. צפייה בלבד</p>
            <p className="mt-0.5">
              התוכן והטיימינג של הפופ-אפ הזה מנוהלים בקוד (לוגיקה דינאמית שלא ניתן לבטא בעורך).
              הדף הזה מציג את ההגדרות הנוכחיות ומאפשר לעקוב אחר הסטטיסטיקה.
              אם תרצה גרסה הניתנת לעריכה — לחץ "שכפל" מהרשימה וערוך את העותק.
            </p>
          </div>
        </div>
      )}

      {/* Content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/*  LEFT: editor */}
        <div className="lg:col-span-3 space-y-3">

          <Section title="1. פרטים כלליים" open={open.general} onToggle={() => toggleSection('general')}>
            <Field label="שם פנימי (לא מוצג למשתמש)" error={errors.name}>
              <Input value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder='לדוגמה: ברוך הבא לגרסה 2.7' maxLength={80} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="קטגוריה">
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="סטטוס">
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="תיאור פנימי (לעצמך ולצוות)">
              <Textarea rows={2} value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="מטרת הפופ-אפ, הקשר עסקי, הערות" />
            </Field>
            <Field label="עדיפות (גבוה יותר = מנצח פופ-אפים אחרים)">
              <Input type="number" value={form.priority}
                onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} />
            </Field>
          </Section>

          <Section title="2. תוכן" open={open.content} onToggle={() => toggleSection('content')}>
            <Field label="כותרת" error={errors.title}>
              <Input value={form.content.title} maxLength={80}
                onChange={e => setForm(f => ({ ...f, content: { ...f.content, title: e.target.value } }))} />
            </Field>
            <Field label="טקסט">
              <Textarea rows={3} value={form.content.body}
                onChange={e => setForm(f => ({ ...f, content: { ...f.content, body: e.target.value } }))}
                placeholder="טקסט עיקרי שיוצג למשתמש. ניתן להשתמש בשורות חדשות." />
            </Field>
            <Field label="אייקון">
              <Select value={form.content.icon} onValueChange={v => setForm(f => ({ ...f, content: { ...f.content, icon: v } }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ICON_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>

            <div className="rounded-xl border border-gray-100 p-3 bg-gray-50">
              <p className="text-xs font-bold text-gray-700 mb-2">כפתור ראשי</p>
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="טקסט" value={form.content.primary_cta?.label || ''}
                  onChange={e => setForm(f => ({ ...f, content: { ...f.content, primary_cta: { ...f.content.primary_cta, label: e.target.value } } }))} />
                <Select value={form.content.primary_cta?.action || 'dismiss'}
                  onValueChange={v => setForm(f => ({ ...f, content: { ...f.content, primary_cta: { ...f.content.primary_cta, action: v } } }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CTA_ACTIONS.map(a => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {(() => {
                const a = CTA_ACTIONS.find(x => x.value === (form.content.primary_cta?.action || 'dismiss'));
                if (!a?.needsTarget) return null;
                return (
                  <Input className="mt-2" placeholder={a.targetLabel}
                    value={form.content.primary_cta?.target || ''}
                    onChange={e => setForm(f => ({ ...f, content: { ...f.content, primary_cta: { ...f.content.primary_cta, target: e.target.value } } }))} />
                );
              })()}
            </div>

            <div className="rounded-xl border border-gray-100 p-3 bg-gray-50">
              <p className="text-xs font-bold text-gray-700 mb-2">כפתור משני (אופציונלי)</p>
              <Input placeholder='טקסט (למשל "לא עכשיו"). השאר ריק כדי להסתיר'
                value={form.content.secondary_cta?.label || ''}
                onChange={e => setForm(f => ({ ...f, content: { ...f.content, secondary_cta: { label: e.target.value } } }))} />
            </div>
          </Section>

          <Section title="3. עיצוב" open={open.design} onToggle={() => toggleSection('design')}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="ערכת נושא">
                <Select value={form.design.theme} onValueChange={v => setForm(f => ({ ...f, design: { ...f.design, theme: v } }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{THEMES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="סוג פופ-אפ">
                <Select value={form.design.size} onValueChange={v => setForm(f => ({ ...f, design: { ...f.design, size: v } }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SIZES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            </div>
          </Section>

          <Section title="4. טריגר. מתי מוצג" open={open.trigger} onToggle={() => toggleSection('trigger')}>
            <Field label="סוג טריגר" error={errors.trigger}>
              <Select value={form.trigger.kind} onValueChange={v => setForm(f => ({ ...f, trigger: { ...f.trigger, kind: v } }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TRIGGERS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-[11px] text-gray-400 mt-1">
                {TRIGGERS.find(t => t.value === form.trigger.kind)?.description}
              </p>
            </Field>

            {form.trigger.kind === 'on_page_view' && (
              <Field label="עמוד יעד" error={errors.triggerPath}>
                <Select value={form.trigger.path || ''} onValueChange={v => setForm(f => ({ ...f, trigger: { ...f.trigger, path: v } }))}>
                  <SelectTrigger><SelectValue placeholder="בחר עמוד" /></SelectTrigger>
                  <SelectContent>{TARGETABLE_PAGES.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            )}

            {form.trigger.kind === 'after_delay' && (
              <Field label="השהיה (שניות)" error={errors.triggerDelay}>
                <Input type="number" min={1} max={300}
                  value={form.trigger.delay_seconds || ''}
                  onChange={e => setForm(f => ({ ...f, trigger: { ...f.trigger, delay_seconds: Number(e.target.value) } }))} />
              </Field>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="תאריך התחלה (אופציונלי)">
                <Input type="datetime-local" value={form.starts_at ? toLocalInput(form.starts_at) : ''}
                  onChange={e => setForm(f => ({ ...f, starts_at: e.target.value ? new Date(e.target.value).toISOString() : null }))} />
              </Field>
              <Field label="תאריך סיום (אופציונלי)">
                <Input type="datetime-local" value={form.ends_at ? toLocalInput(form.ends_at) : ''}
                  onChange={e => setForm(f => ({ ...f, ends_at: e.target.value ? new Date(e.target.value).toISOString() : null }))} />
              </Field>
            </div>
          </Section>

          <Section title="5. תנאי תצוגה. למי מוצג" open={open.conditions} onToggle={() => toggleSection('conditions')}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="סוג משתמש">
                <Select value={form.conditions.user_type || 'all'} onValueChange={v => setForm(f => ({ ...f, conditions: { ...f.conditions, user_type: v } }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{USER_TYPES.map(u => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="סגמנט רכב">
                <Select value={form.conditions.segment || 'all'} onValueChange={v => setForm(f => ({ ...f, conditions: { ...f.conditions, segment: v } }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SEGMENTS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="רכב רשום?">
              <Select value={String(form.conditions.has_vehicle ?? 'null')}
                onValueChange={v => setForm(f => ({ ...f, conditions: { ...f.conditions, has_vehicle: v === 'null' ? null : v === 'true' } }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {HAS_VEHICLE_OPTIONS.map(o =>
                    <SelectItem key={String(o.value)} value={String(o.value)}>{o.label}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </Field>
          </Section>

          <Section title="6. תדירות. כמה פעמים" open={open.frequency} onToggle={() => toggleSection('frequency')}>
            <Field label="סוג">
              <Select value={form.frequency.kind} onValueChange={v => setForm(f => ({ ...f, frequency: { ...f.frequency, kind: v } }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{FREQUENCIES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-[11px] text-gray-400 mt-1">
                {FREQUENCIES.find(f => f.value === form.frequency.kind)?.hint}
              </p>
            </Field>
            {form.frequency.kind === 'custom' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="כל X ימים">
                  <Input type="number" min={1} value={form.frequency.every_days || ''}
                    onChange={e => setForm(f => ({ ...f, frequency: { ...f.frequency, every_days: Number(e.target.value) || undefined } }))} />
                </Field>
                <Field label="מקסימום צפיות סה״כ">
                  <Input type="number" min={1} value={form.frequency.max_impressions || ''}
                    onChange={e => setForm(f => ({ ...f, frequency: { ...f.frequency, max_impressions: Number(e.target.value) || undefined } }))} />
                </Field>
              </div>
            )}
          </Section>

        </div>

        {/*  RIGHT: live preview */}
        <div className="lg:col-span-2">
          <div className="sticky top-[72px]">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-blue-500" />
              <p className="text-xs font-bold text-gray-700">תצוגה מקדימה</p>
            </div>
            <div className="bg-slate-100 rounded-2xl p-6 min-h-[420px] flex items-center justify-center border border-gray-100">
              {/* Mobile-ish frame so preview feels real */}
              <div className="w-full max-w-sm">
                <PopupRenderer popup={previewPopup} open renderInline onClose={() => {}} />
              </div>
            </div>
            <p className="text-[10px] text-gray-400 mt-2 text-center leading-relaxed">
              זו תצוגה סטטית. לבדיקה אמיתית — שמור ולחץ "הצג עכשיו לי בלבד".
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}

//  Helpers
function mergeDefaults(p) {
  return {
    name:        p.name || '',
    category:    p.category || DEFAULTS.category,
    status:      p.status || DEFAULTS.status,
    description: p.description || '',
    content:     { ...DEFAULTS.content, ...(p.content || {}) },
    design:      { ...DEFAULTS.design, ...(p.design || {}) },
    trigger:     { ...DEFAULTS.trigger, ...(p.trigger || {}) },
    conditions:  { ...DEFAULTS.conditions, ...(p.conditions || {}) },
    frequency:   { ...DEFAULTS.frequency, ...(p.frequency || {}) },
    priority:    p.priority ?? DEFAULTS.priority,
    starts_at:   p.starts_at || null,
    ends_at:     p.ends_at || null,
  };
}

function toLocalInput(iso) {
  try {
    const d = new Date(iso);
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60 * 1000).toISOString().slice(0, 16);
  } catch { return ''; }
}

function Section({ title, open, onToggle, children }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <button onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-right hover:bg-gray-50 transition-colors">
        <span className="text-sm font-bold text-gray-800">{title}</span>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {open && <div className="px-4 pb-4 space-y-3 border-t border-gray-50">{children}</div>}
    </div>
  );
}

function Field({ label, children, error }) {
  return (
    <div className="pt-3">
      <label className="text-[13px] font-semibold text-gray-700 block mb-1.5">{label}</label>
      {children}
      {error && <p className="text-[11px] text-red-500 mt-1">{error}</p>}
    </div>
  );
}
