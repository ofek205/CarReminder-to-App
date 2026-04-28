/**
 * Phase 4 — Create Business Workspace.
 *
 * Form that calls the create_business_workspace RPC, switches the
 * active workspace to the newly-created one, then redirects to the
 * Vehicles page (which is now scoped to the new business workspace
 * via WorkspaceContext).
 *
 * Reachable from the WorkspaceSwitcher dropdown ("צור חשבון עסקי")
 * and from the route /CreateBusinessWorkspace registered in
 * pages.config.js.
 *
 * Form fields (all stored under accounts.business_meta except name):
 *   - name           → accounts.name (required)
 *   - business_id    → business_meta.business_id (ח.פ., optional)
 *   - contact_email  → business_meta.contact_email (optional)
 *
 * After successful creation:
 *   1. invalidate workspace list query so the new membership shows up
 *   2. switchTo(newAccountId) — Phase 3 handles state + persistence
 *   3. navigate to /Vehicles
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Briefcase, Loader2, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/shared/GuestContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { createPageUrl } from '@/utils';

const MAX_NAME = 120;

export default function CreateBusinessWorkspace() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { switchTo } = useWorkspace();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (authLoading) {
    return (
      <div dir="rtl" className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-[#2D5233]" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div dir="rtl" className="max-w-md mx-auto py-16 text-center">
        <p className="text-sm text-gray-600">צריך להיות מחובר כדי ליצור חשבון עסקי.</p>
      </div>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      toast.error('יש להזין שם לחשבון העסקי');
      return;
    }
    if (cleanName.length > MAX_NAME) {
      toast.error(`השם ארוך מדי. מקסימום ${MAX_NAME} תווים.`);
      return;
    }

    setSubmitting(true);
    try {
      const businessMeta = {};
      if (businessId.trim())   businessMeta.business_id   = businessId.trim();
      if (contactEmail.trim()) businessMeta.contact_email = contactEmail.trim();

      const { data: newAccountId, error } = await supabase.rpc('create_business_workspace', {
        p_name: cleanName,
        p_business_meta: Object.keys(businessMeta).length ? businessMeta : null,
      });
      if (error) throw error;
      if (!newAccountId) throw new Error('no_id_returned');

      // Reload the workspace list so the new membership appears.
      await queryClient.invalidateQueries({ queryKey: ['user-workspaces'] });

      // Wait one tick so the WorkspaceContext picks up the new
      // membership before we switchTo it. switchTo validates the
      // account is in the membership list.
      await new Promise(r => setTimeout(r, 50));
      const switched = await switchTo(newAccountId);
      if (!switched) {
        // Fallback: refetch and try once more.
        await queryClient.invalidateQueries({ queryKey: ['user-workspaces'] });
        await new Promise(r => setTimeout(r, 200));
        await switchTo(newAccountId);
      }

      toast.success('החשבון העסקי נוצר. עברנו אליו אוטומטית.');
      navigate(createPageUrl('Vehicles'));
    } catch (err) {
      const code = err?.message || err?.code || '';
      if (code.includes('name_required'))    toast.error('שם החשבון העסקי חובה');
      else if (code.includes('name_too_long')) toast.error(`שם ארוך מדי (עד ${MAX_NAME} תווים)`);
      else if (code.includes('not_authenticated')) toast.error('פג תוקף ההתחברות. התחבר מחדש ונסה שוב.');
      else toast.error('יצירת החשבון נכשלה. נסה שוב, או פנה לתמיכה אם הבעיה חוזרת.');
      // eslint-disable-next-line no-console
      console.error('CreateBusinessWorkspace failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div dir="rtl" className="max-w-md mx-auto py-6 px-2">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-11 h-11 rounded-xl bg-[#E8F2EA] flex items-center justify-center">
          <Briefcase className="h-5 w-5 text-[#2D5233]" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">חשבון עסקי חדש</h1>
          <p className="text-xs text-gray-500">לניהול צי רכבים של חברה או עסק</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-bold text-gray-700 mb-1.5">
            שם החשבון העסקי <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="לדוגמה: יצור פלסטיק בע&quot;מ"
            maxLength={MAX_NAME}
            className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5233]/30 focus:border-[#2D5233]"
            required
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-gray-700 mb-1.5">
            ח.פ. / מספר עוסק
          </label>
          <input
            type="text"
            value={businessId}
            onChange={(e) => setBusinessId(e.target.value)}
            placeholder="לא חובה"
            className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5233]/30 focus:border-[#2D5233]"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-gray-700 mb-1.5">
            אימייל ליצירת קשר
          </label>
          <input
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder="לא חובה"
            className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5233]/30 focus:border-[#2D5233]"
          />
        </div>

        <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-[11px] text-blue-900 leading-relaxed">
          תיווצר סביבת עבודה נפרדת לחלוטין. הרכבים האישיים שלך נשארים פרטיים — הם לא יופיעו בחשבון העסקי, ולהיפך.
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 rounded-xl font-bold text-sm bg-[#2D5233] text-white flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-60"
        >
          {submitting
            ? <><Loader2 className="h-4 w-4 animate-spin" /> יוצר...</>
            : <>צור חשבון עסקי <ArrowRight className="h-4 w-4 rotate-180" /></>
          }
        </button>
      </form>
    </div>
  );
}
