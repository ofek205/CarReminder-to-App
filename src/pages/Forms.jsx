import React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { FileSignature, FileText, Handshake, ChevronLeft, Lock, ArrowRight } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { C } from '@/lib/designTokens';
import { useAuth } from '@/components/shared/GuestContext';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import { FORMS_CATALOG, getForm } from '@/lib/forms/catalog';
import PowerOfAttorneyForm from '@/components/forms/PowerOfAttorneyForm';
import VehicleSaleForm from '@/components/forms/VehicleSaleForm';

const ICONS = { FileSignature, FileText, Handshake };

// Maps a form id → its fill component. Adding a future form = a catalog
// entry + a component here; the page shell stays untouched.
const FORM_COMPONENTS = {
  poa: PowerOfAttorneyForm,
  sale_contract: VehicleSaleForm,
};

function LoginGate() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-6" dir="rtl">
      <PageHeader title="טפסים" icon={FileSignature} />
      <div className="rounded-3xl border p-8 text-center" style={{ borderColor: C.border, background: C.card }}>
        <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: C.light }}>
          <Lock className="h-7 w-7" style={{ color: C.primary }} />
        </div>
        <p className="text-base font-bold mb-1" style={{ color: C.text }}>צריך להתחבר</p>
        <p className="text-sm mb-5" style={{ color: C.muted }}>
          הפקת טפסים דורשת חשבון, כדי למלא מראש את הפרטים שלך ולשמור אותם מאובטחים.
        </p>
        <Link to={createPageUrl('Auth')}
          className="inline-flex items-center justify-center h-11 px-6 rounded-2xl font-bold text-white"
          style={{ background: C.primary }}>
          התחברות
        </Link>
      </div>
    </div>
  );
}

function FormsLibrary() {
  const { isBusiness } = useWorkspaceRole();
  const accountType = isBusiness ? 'business' : 'personal';
  const items = FORMS_CATALOG.filter((f) => f.accounts.includes(accountType));

  return (
    <div className="max-w-2xl mx-auto px-4 py-6" dir="rtl">
      <PageHeader
        title="טפסים"
        subtitle="מלא פרטים — קבל מסמך מוכן ב-PDF או Word"
        icon={FileSignature}
      />
      <div className="space-y-3">
        {items.map((f) => {
          const Icon = ICONS[f.icon] || FileText;
          const soon = f.status !== 'live';
          if (soon) {
            return (
              <div key={f.id}
                className="rounded-3xl border p-4 flex items-center gap-3 opacity-60"
                style={{ borderColor: C.border, background: C.gray50 }}>
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{ background: C.gray100 }}>
                  <Icon className="h-5 w-5" style={{ color: C.muted }} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold" style={{ color: C.text }}>{f.title}</p>
                  <p className="text-[12px]" style={{ color: C.muted }}>{f.subtitle}</p>
                </div>
                <span className="text-[11px] font-bold px-2 py-1 rounded-full"
                  style={{ background: C.gray100, color: C.muted }}>בקרוב</span>
              </div>
            );
          }
          return (
            <Link key={f.id} to={`${createPageUrl('Forms')}?form=${f.id}`}
              className="rounded-3xl border p-4 flex items-center gap-3 transition-colors hover:border-current"
              style={{ borderColor: C.border, background: C.card }}>
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{ background: C.light }}>
                <Icon className="h-5 w-5" style={{ color: C.primary }} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold" style={{ color: C.text }}>{f.title}</p>
                <p className="text-[12px] leading-relaxed" style={{ color: C.muted }}>{f.subtitle}</p>
              </div>
              <ChevronLeft className="h-5 w-5 shrink-0" style={{ color: C.muted }} />
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export default function Forms() {
  const { isGuest } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const formId = params.get('form');

  if (isGuest) return <LoginGate />;
  if (!formId) return <FormsLibrary />;

  const form = getForm(formId);
  const FillComponent = form && form.status === 'live' ? FORM_COMPONENTS[formId] : null;

  // Unknown / not-yet-live form id → bounce back to the library.
  if (!FillComponent) {
    return <FormsLibrary />;
  }

  const HeaderIcon = ICONS[form.icon] || FileSignature;
  const headerSubtitle = formId === 'poa' ? 'ייפוי כוח · משרד התחבורה' : 'מלא פרטים והפק מסמך';

  return (
    <div className="max-w-2xl mx-auto px-4 py-6" dir="rtl">
      <PageHeader title={form.title} subtitle={headerSubtitle} icon={HeaderIcon} />
      <button
        type="button"
        onClick={() => navigate(createPageUrl('Forms'))}
        className="flex items-center gap-1.5 text-sm font-bold mb-4"
        style={{ color: C.primary }}
      >
        <ArrowRight className="h-4 w-4" /> חזרה לטפסים
      </button>
      <FillComponent />
    </div>
  );
}
