/**
 * Phase 3 — WorkspaceSwitcher.
 *
 * Dropdown that lets a user move between their workspaces. Renders
 * NOTHING when the user has 0 or 1 memberships — single-workspace
 * (typical private) users never see new UI. This is the contract that
 * preserves the existing private-user experience byte-identically.
 *
 * Mount point: top bar in src/Layout.jsx, between the logo and the
 * notification bell.
 */
import React, { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Briefcase, User as UserIcon, Check, ChevronDown, Plus } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { createPageUrl } from '@/utils';

const PERSONAL_LABEL = 'החשבון האישי שלי';

function workspaceLabel(m) {
  if (m.account_type === 'business') {
    return m.account_name || 'חשבון עסקי';
  }
  return PERSONAL_LABEL;
}

export default function WorkspaceSwitcher() {
  const { memberships, activeWorkspaceId, activeWorkspace, switchTo, isGuest } = useWorkspace();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('touchstart', onDocClick);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('touchstart', onDocClick);
    };
  }, [open]);

  // Phase 3 contract was: hide entirely for memberships.length <= 1.
  // Phase 4 adjusts this — a single-membership user now needs a way to
  // create their first business workspace, so the switcher renders even
  // for them but as a compact one-line pill. Guests still see nothing.
  if (isGuest) return null;
  if (!memberships || memberships.length === 0) return null;
  const hasMultiple = memberships.length > 1;

  const ActiveIcon = activeWorkspace?.account_type === 'business' ? Briefcase : UserIcon;
  const activeLabel = activeWorkspace ? workspaceLabel(activeWorkspace) : '...';

  return (
    <div ref={wrapRef} className="relative" dir="rtl">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 max-w-[140px] sm:max-w-[180px] px-2.5 py-1.5 rounded-lg bg-gray-50 hover:bg-gray-100 active:scale-[0.98] transition-all"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={hasMultiple ? 'החלף סביבת עבודה' : 'סביבת עבודה פעילה'}
      >
        <ActiveIcon className="h-4 w-4 text-[#2D5233] shrink-0" />
        <span className="text-xs font-semibold text-gray-900 truncate">{activeLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 text-gray-400 shrink-0" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute top-full mt-1 right-0 z-[10001] min-w-[220px] bg-white border border-gray-100 rounded-xl shadow-lg overflow-hidden"
        >
          {hasMultiple && (
            <>
              <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100">
                סביבות העבודה שלי
              </div>
              {memberships
                .filter(m => m.status !== 'הוסר' && m.status !== 'removed')
                .map(m => {
                  const isActive = m.account_id === activeWorkspaceId;
                  const Icon = m.account_type === 'business' ? Briefcase : UserIcon;
                  return (
                    <button
                      key={m.account_id}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onClick={async () => {
                        setOpen(false);
                        if (!isActive) {
                          const ok = await switchTo(m.account_id);
                          if (ok) {
                            // Land on the home page of the new workspace.
                            // Personal stays on Dashboard; business is
                            // redirected by Dashboard.jsx to BusinessDashboard.
                            navigate(createPageUrl('Dashboard'));
                          }
                        }
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 text-right transition-colors ${
                        isActive ? 'bg-[#E8F2EA]' : 'hover:bg-gray-50 active:bg-gray-100'
                      }`}
                    >
                      <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-[#2D5233]' : 'text-gray-400'}`} />
                      <span className={`flex-1 text-xs truncate ${isActive ? 'font-bold text-[#2D5233]' : 'text-gray-700'}`}>
                        {workspaceLabel(m)}
                      </span>
                      {isActive && <Check className="h-4 w-4 text-[#2D5233] shrink-0" />}
                    </button>
                  );
                })}
            </>
          )}
          <Link
            to={createPageUrl('CreateBusinessWorkspace')}
            onClick={() => setOpen(false)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 text-right text-[#2D5233] hover:bg-[#E8F2EA] active:bg-[#D8E5D9] transition-colors ${hasMultiple ? 'border-t border-gray-100' : ''}`}
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-xs font-bold">צור חשבון עסקי</span>
          </Link>
        </div>
      )}
    </div>
  );
}
