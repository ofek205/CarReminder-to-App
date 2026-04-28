/**
 * Phase 9, Step 8 — Business workspace settings (owner-only).
 *
 * Lets the workspace owner edit:
 *   - workspace name (accounts.name)
 *   - business identifier / ח.פ. (business_meta.business_id)
 *   - contact email (business_meta.contact_email)
 *   - hide Community for drivers (business_meta.driver_hide_community)
 *   - hide AI Assistant for drivers (business_meta.driver_hide_ai)
 *
 * Server-side: accounts.update RLS allows only role='בעלים' to update,
 * so a manager (מנהל) can view but their save will be rejected. The
 * page hides the form from non-owners as a UX guard.
 */
import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Briefcase, Loader2, ShieldAlert, Save, Users, Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/shared/GuestContext';
import useAccountRole from '@/hooks/useAccountRole';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import { useWorkspace } from '@/contexts/WorkspaceContext';

const MAX_NAME = 120;

export default function BusinessSettings() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { accountId } = useAccountRole();
  const { activeWorkspace } = useWorkspace();
  const { isBusiness, isOwner, isLoading: roleLoading } = useWorkspaceRole();
  const queryClient = useQueryClient();

  const [name, setName]                 = useState('');
  const [businessId, setBusinessId]     = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [hideCommunity, setHideCommunity] = useState(false);
  const [hideAi, setHideAi]               = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dirty, setDirty]           = useState(false);

  // Hydrate form from active workspace metadata.
  useEffect(() => {
    if (!activeWorkspace) return;
    setName(activeWorkspace.account_name || '');
    const meta = activeWorkspace.business_meta || {};
    setBusinessId(meta.business_id || '');
    setContactEmail(meta.contact_email || '');
    setHideCommunity(!!meta.driver_hide_community);
    setHideAi(!!meta.driver_hide_ai);
    setDirty(false);
  }, [activeWorkspace?.account_id]);

  if (authLoading || roleLoading) {
    return <div dir="rtl" className="text-center py-16 text-xs text-gray-400">טוען...</div>;
  }
  if (!isAuthenticated) {
    return <Empty text="צריך להתחבר כדי לערוך הגדרות חשבון." />;
  }
  if (!isBusiness) {
    return (
      <Empty
        icon={<Briefcase className="h-10 w-10 text-gray-300" />}
        title="הגדרות עסקי זמינות בחשבון עסקי"
        text="עבור לחשבון עסקי דרך הסרגל העליון, או צור חשבון חדש."
      />
    );
  }
  if (!isOwner) {
    return (
      <Empty
        icon={<ShieldAlert className="h-10 w-10 text-gray-300" />}
        title="הגדרות החשבון שמורות לבעלים"
        text="רק בעלי החשבון העסקי יכולים לעדכן את הפרטים וההגדרות."
      />
    );
  }

  const markDirty = () => setDirty(true);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) { toast.error('יש להזין שם לחשבון העסקי'); return; }
    if (cleanName.length > MAX_NAME) { toast.error(`השם ארוך מדי (עד ${MAX_NAME} תווים)`); return; }

    const newMeta = {
      ...(activeWorkspace?.business_meta || {}),
      business_id:           businessId.trim() || null,
      contact_email:         contactEmail.trim() || null,
      driver_hide_community: !!hideCommunity,
      driver_hide_ai:        !!hideAi,
    };
    // Strip nulls to keep the jsonb tidy.
    Object.keys(newMeta).forEach(k => { if (newMeta[k] == null) delete newMeta[k]; });

    setSubmitting(true);
    try {
      const { error } = await supabase
        .from('accounts')
        .update({
          name: cleanName,
          business_meta: Object.keys(newMeta).length ? newMeta : null,
        })
        .eq('id', accountId);
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['user-workspaces'] });
      toast.success('ההגדרות נשמרו');
      setDirty(false);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('BusinessSettings save failed:', err);
      toast.error('השמירה נכשלה. נסה שוב, או פנה לתמיכה אם הבעיה חוזרת.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div dir="rtl" className="max-w-xl mx-auto py-2">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900">הגדרות החשבון העסקי</h1>
        <p className="text-xs text-gray-500">פרטי החשבון, אנשי קשר וכלים שמותר לנהגים לראות</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Workspace details */}
        <Section title="פרטי החשבון">
          <Field label="שם החשבון העסקי" required>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); markDirty(); }}
              maxLength={MAX_NAME}
              className={inputCls}
              required
            />
          </Field>
          <Field label="ח.פ. / מספר עוסק">
            <input
              type="text"
              value={businessId}
              onChange={(e) => { setBusinessId(e.target.value); markDirty(); }}
              placeholder="לא חובה"
              className={inputCls}
            />
          </Field>
          <Field label="אימייל ליצירת קשר">
            <input
              type="email"
              value={contactEmail}
              onChange={(e) => { setContactEmail(e.target.value); markDirty(); }}
              placeholder="לא חובה"
              className={inputCls}
            />
          </Field>
        </Section>

        {/* Driver experience controls */}
        <Section
          title="חוויית הנהגים"
          subtitle="שלוט במה שנהגים בחשבון הזה רואים בתפריט. השינויים תקפים מיידית בכניסה הבאה שלהם."
        >
          <Toggle
            icon={<Users className="h-4 w-4" />}
            label="הסתר קהילה מנהגים"
            description="הקטגוריה 'קהילה וייעוץ' לא תופיע בתפריט הצדדי לנהגים בחשבון הזה."
            checked={hideCommunity}
            onChange={(v) => { setHideCommunity(v); markDirty(); }}
          />
          <Toggle
            icon={<Sparkles className="h-4 w-4" />}
            label="הסתר 'מומחה AI' מנהגים"
            description="התייעצות עם מומחה AI לא תופיע בתפריט הצדדי לנהגים בחשבון הזה."
            checked={hideAi}
            onChange={(v) => { setHideAi(v); markDirty(); }}
          />
        </Section>

        <button
          type="submit"
          disabled={submitting || !dirty}
          className="w-full py-2.5 rounded-xl font-bold text-sm bg-[#2D5233] text-white flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50"
        >
          {submitting
            ? <><Loader2 className="h-4 w-4 animate-spin" /> שומר...</>
            : <><Save className="h-4 w-4" /> שמור שינויים</>}
        </button>
        {!dirty && !submitting && (
          <p className="text-center text-[10px] text-gray-400">אין שינויים לשמור</p>
        )}
      </form>
    </div>
  );
}

// ---------- subcomponents -------------------------------------------

function Section({ title, subtitle, children }) {
  return (
    <section className="bg-white border border-gray-100 rounded-2xl p-4">
      <h2 className="text-sm font-bold text-gray-900 mb-1">{title}</h2>
      {subtitle && <p className="text-[11px] text-gray-500 mb-3 leading-relaxed">{subtitle}</p>}
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-xs font-bold text-gray-700 mb-1.5">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}

function Toggle({ icon, label, description, checked, onChange }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer py-2 border-t border-gray-100 first:border-0 first:pt-0">
      <div className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${checked ? 'bg-[#E8F2EA] text-[#2D5233]' : 'bg-gray-100 text-gray-500'}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-gray-900">{label}</p>
        {description && <p className="text-[11px] text-gray-500 leading-relaxed mt-0.5">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`shrink-0 relative inline-flex w-11 h-6 rounded-full transition-colors ${checked ? 'bg-[#2D5233]' : 'bg-gray-300'}`}
      >
        <span
          className={`absolute top-0.5 ${checked ? 'right-0.5' : 'right-5'} w-5 h-5 bg-white rounded-full shadow transition-all`}
        />
      </button>
    </label>
  );
}

const inputCls = "w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5233]/30";

function Empty({ icon, title, text }) {
  return (
    <div dir="rtl" className="max-w-md mx-auto py-16">
      <div className="text-center px-6">
        {icon && <div className="flex justify-center mb-3">{icon}</div>}
        {title && <p className="text-sm font-bold text-gray-700 mb-1">{title}</p>}
        <p className="text-xs text-gray-500 leading-relaxed">{text}</p>
      </div>
    </div>
  );
}
