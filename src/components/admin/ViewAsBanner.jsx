/**
 * ViewAsBanner — persistent strip shown on every screen while an admin is in
 * read-only "view-as" mode. It is the single most important safety affordance:
 * the admin must never forget they are looking at a customer's account.
 *
 * Renders nothing when not in view-as. While active it shows the target name,
 * a live countdown to the session expiry, and an exit button. When the
 * countdown reaches zero it auto-exits (the server session has expired anyway,
 * so RLS access is already gone — this just cleans up the client).
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Eye, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import useViewAs from '@/hooks/useViewAs';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { createPageUrl } from '@/utils';
import { C } from '@/lib/designTokens';

function fmtRemaining(ms) {
  if (ms <= 0) return '00:00';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function ViewAsBanner() {
  const viewAs = useViewAs();
  const { exitViewAs } = useWorkspace();
  const navigate = useNavigate();
  const [remaining, setRemaining] = useState(0);
  const [exiting, setExiting] = useState(false);

  const expiresAt = viewAs?.expiresAt ? new Date(viewAs.expiresAt).getTime() : 0;

  const handleExit = useCallback(async () => {
    if (exiting) return;
    setExiting(true);
    try { await exitViewAs(); } catch { /* best effort */ }
    navigate(createPageUrl('AdminUsers'));
  }, [exiting, exitViewAs, navigate]);

  useEffect(() => {
    if (!viewAs) return undefined;
    const tick = () => {
      const ms = expiresAt - Date.now();
      setRemaining(ms);
      if (ms <= 0) handleExit();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [viewAs, expiresAt, handleExit]);

  if (!viewAs) return null;

  return (
    <div
      dir="rtl"
      role="status"
      className="sticky top-0 z-40 flex items-center justify-between gap-3 px-3 py-2"
      style={{ background: C.orange, color: '#FFFFFF', borderBottom: `1px solid ${C.warn}` }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <Eye className="w-4 h-4 shrink-0" />
        <span className="text-[13px] font-bold truncate">
          צופה בחשבון של {viewAs.targetName || 'משתמש'}
        </span>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-[13px] tabular-nums" dir="ltr">{fmtRemaining(remaining)}</span>
        <button
          type="button"
          onClick={handleExit}
          disabled={exiting}
          className="flex items-center gap-1 text-[13px] font-bold px-2.5 py-1 rounded-md transition disabled:opacity-60"
          style={{ border: '1px solid #FFFFFF', minHeight: 32 }}
        >
          <X className="w-3.5 h-3.5" />
          {exiting ? 'יוצא…' : 'יציאה'}
        </button>
      </div>
    </div>
  );
}
