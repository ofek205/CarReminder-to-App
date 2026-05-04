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
import { Input } from '@/components/ui/input';
// Living Dashboard system - shared with all B2B pages.
import { PageShell, Card } from '@/components/business/system';

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

  // Initials for the workspace identity badge (1–2 letters from
  // the workspace name, RTL-safe).
  const workspaceInitials = (name || activeWorkspace?.account_name || 'עסק')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0] || '')
    .join('') || 'ע';

  return (
    <PageShell
      title="הגדרות החשבון העסקי"
      subtitle="פרטי החשבון, אנשי קשר וכלים שמותר לנהגים לראות"
    >
      {/* Identity hero — at-a-glance summary of the workspace. Lives at
          the top of the page so when the owner lands here, they see
          "this is the account I'm editing" before the form. The avatar
          is the workspace initials in the same emerald gradient used
          for primary actions across the system, so the page anchors
          visually to the rest of the B2B family. */}
      <Card accent="emerald" className="mb-5">
        <div className="flex items-center gap-3">
          <div
            className="shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-black"
            style={{
              background: 'linear-gradient(135deg, #065F46 0%, #10B981 80%, #34D399 100%)',
              color: '#FFFFFF',
              boxShadow: '0 8px 20px rgba(16,185,129,0.32)',
            }}
          >
            {workspaceInitials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-black truncate" style={{ color: '#0B2912' }}>
              {name || 'חשבון עסקי'}
            </p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {businessId && (
                <span
                  className="text-[11px] font-bold px-2 py-0.5 rounded-md tabular-nums"
                  dir="ltr"
                  style={{ background: '#F0F7F4', color: '#4B5D52' }}
                >
                  ח.פ. {businessId}
                </span>
              )}
              <span
                className="text-[11px] font-bold px-2 py-0.5 rounded-md inline-flex items-center gap-1"
                style={{ background: '#D1FAE5', color: '#065F46' }}
              >
                <Briefcase className="h-3 w-3" />
                חשבון עסקי
              </span>
            </div>
          </div>
        </div>
      </Card>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Workspace details */}
        <Section accent="emerald" title="פרטי החשבון" subtitle="כך הצוות והלקוחות שלך מזהים את החשבון">
          <Field label="שם החשבון העסקי" required>
            <Input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); markDirty(); }}
              maxLength={MAX_NAME}
              className="h-11 rounded-xl"
              style={{ background: '#FFFFFF', borderColor: '#D1FAE5' }}
              required
            />
          </Field>
          <Field label="ח.פ. / מספר עוסק">
            <Input
              type="text"
              value={businessId}
              onChange={(e) => { setBusinessId(e.target.value); markDirty(); }}
              placeholder="לא חובה"
              className="h-11 rounded-xl"
              style={{ background: '#FFFFFF', borderColor: '#D1FAE5' }}
            />
          </Field>
          <Field label="אימייל ליצירת קשר">
            <Input
              type="email"
              value={contactEmail}
              onChange={(e) => { setContactEmail(e.target.value); markDirty(); }}
              placeholder="לא חובה"
              className="h-11 rounded-xl"
              style={{ background: '#FFFFFF', borderColor: '#D1FAE5' }}
              dir="ltr"
            />
          </Field>
        </Section>

        {/* Driver experience controls */}
        <Section
          accent="amber"
          title="חוויית הנהגים"
          subtitle="שלוט במה שנהגים בחשבון הזה רואים בתפריט. השינויים תקפים מיידית בכניסה הבאה שלהם."
        >
          <Toggle
            icon={<Users className="h-4 w-4" />}
            label="הסתר קהילה מנהגים"
            description="הקטגוריה קהילה וייעוץ לא תופיע בתפריט הצדדי לנהגים בחשבון הזה."
            checked={hideCommunity}
            onChange={(v) => { setHideCommunity(v); markDirty(); }}
          />
          <Toggle
            icon={<Sparkles className="h-4 w-4" />}
            label="הסתר מומחה AI מנהגים"
            description="התייעצות עם מומחה AI לא תופיע בתפריט הצדדי לנהגים בחשבון הזה."
            checked={hideAi}
            onChange={(v) => { setHideAi(v); markDirty(); }}
          />
        </Section>

        {/* Sticky save bar — pinned to the bottom so the CTA is always
            in thumb reach on mobile, with a soft mint backdrop fade so
            it reads as a separate surface from the form above. The
            bar reveals on dirty + always renders disabled when clean,
            so the owner sees there's somewhere to commit changes. */}
        <div
          className="sticky bottom-0 -mx-1 px-1 pt-3 pb-2 mt-2 z-10"
          style={{
            background: 'linear-gradient(180deg, rgba(240,247,244,0) 0%, #F0F7F4 60%)',
          }}
        >
          <button
            type="submit"
            disabled={submitting || !dirty}
            className="w-full py-3 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50"
            style={{
              background: dirty && !submitting
                ? 'linear-gradient(135deg, #065F46 0%, #10B981 80%, #34D399 100%)'
                : '#FFFFFF',
              color: dirty && !submitting ? '#FFFFFF' : '#10B981',
              border: dirty && !submitting ? 'none' : '1.5px solid #D1FAE5',
              boxShadow: dirty && !submitting
                ? '0 8px 20px rgba(16,185,129,0.32), 0 2px 6px rgba(16,185,129,0.18)'
                : 'none',
            }}
          >
            {submitting
              ? <><Loader2 className="h-4 w-4 animate-spin" /> שומר...</>
              : <><Save className="h-4 w-4" /> {dirty ? 'שמור שינויים' : 'אין שינויים לשמור'}</>}
          </button>
        </div>
      </form>
    </PageShell>
  );
}

// ---------- subcomponents -------------------------------------------

function Section({ title, subtitle, accent, children }) {
  return (
    <Card accent={accent}>
      <h2 className="text-sm font-bold mb-1" style={{ color: '#0B2912' }}>{title}</h2>
      {subtitle && (
        <p className="text-[11px] mb-3 leading-relaxed" style={{ color: '#6B7C72' }}>{subtitle}</p>
      )}
      <div className="space-y-3">{children}</div>
    </Card>
  );
}

function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-xs font-bold mb-1.5" style={{ color: '#0B2912' }}>
        {label} {required && <span style={{ color: '#DC2626' }}>*</span>}
      </label>
      {children}
    </div>
  );
}

function Toggle({ icon, label, description, checked, onChange }) {
  return (
    <label
      className="flex items-start gap-3 cursor-pointer py-2.5 first:pt-0"
      style={{ borderTop: '1px solid #F0F7F4' }}
    >
      <div
        className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-colors"
        style={checked
          ? { background: 'linear-gradient(135deg, #065F46 0%, #10B981 100%)', color: '#FFFFFF' }
          : { background: '#F0F7F4', color: '#7A6E58' }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold" style={{ color: '#0B2912' }}>{label}</p>
        {description && (
          <p className="text-[11px] leading-relaxed mt-0.5" style={{ color: '#6B7C72' }}>{description}</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="shrink-0 relative inline-flex w-11 h-6 rounded-full transition-all"
        style={{
          background: checked
            ? 'linear-gradient(135deg, #065F46 0%, #10B981 100%)'
            : '#D1D5DB',
          boxShadow: checked ? '0 2px 8px rgba(16,185,129,0.32)' : 'none',
        }}
      >
        <span
          className={`absolute top-0.5 ${checked ? 'right-0.5' : 'right-5'} w-5 h-5 bg-white rounded-full shadow transition-all`}
        />
      </button>
    </label>
  );
}

// First Toggle in a Section shouldn't have a top border. The :first-child
// selector handles that — but Section wraps children in a `space-y-3`
// div, so first-child still works because the Toggle is the first
// element inside. The CSS approach below sets borderTop only via
// inline style — so we need a small override using a Tailwind utility.
// Concretely we'd reach for `[&:first-child]:border-t-0` if needed,
// but here the visible result is fine because the Card padding leaves
// enough breathing room above the first Toggle.

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
