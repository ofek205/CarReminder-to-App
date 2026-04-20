import React, { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { db } from '@/lib/supabaseEntities';
import { useAuth } from '../components/shared/GuestContext';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { AlertTriangle, Trash2, FileX, Loader2, CheckCircle, ArrowRight } from 'lucide-react';
import { C } from '@/lib/designTokens';

export default function DeleteAccount() {
  const { isAuthenticated, user, isGuest } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState('choose'); // choose | confirm | deleting | done
  const [mode, setMode] = useState(null); // 'account' | 'data'
  const [error, setError] = useState('');

  // Not logged in
  if (!isAuthenticated || isGuest) {
    return (
      <div dir="rtl" className="max-w-md mx-auto py-16 px-4 text-center">
        <AlertTriangle className="w-12 h-12 mx-auto mb-4" style={{ color: '#D97706' }} />
        <h1 className="text-xl font-black mb-2">נדרשת התחברות</h1>
        <p className="text-sm mb-6" style={{ color: '#6B7280' }}>כדי למחוק חשבון או נתונים, יש להתחבר קודם</p>
        <button onClick={() => navigate(createPageUrl('Auth'))}
          className="px-6 py-3 rounded-2xl font-bold text-white" style={{ background: C.primary }}>
          התחבר
        </button>
      </div>
    );
  }

  const handleDelete = async () => {
    setStep('deleting');
    setError('');
    try {
      const userId = user.id;
      const members = await db.account_members.filter({ user_id: userId, status: 'פעיל' });

      if (mode === 'data') {
        // Delete user data only (vehicles, documents, notes, etc.) - keep account
        for (const member of members) {
          const accountId = member.account_id;
          // Delete vehicles (cascade will handle related data)
          const vehicles = await db.vehicles.filter({ account_id: accountId });
          for (const v of vehicles) {
            try { await db.vehicles.delete(v.id); } catch {}
          }
          // Delete cork notes, community posts
          try {
            await supabase.from('cork_notes').delete().eq('vehicle_id', vehicles.map(v => v.id));
            await supabase.from('community_posts').delete().eq('user_id', userId);
            await supabase.from('community_comments').delete().eq('user_id', userId);
            await supabase.from('community_likes').delete().eq('user_id', userId);
            await supabase.from('community_reactions').delete().eq('user_id', userId);
            await supabase.from('community_saved').delete().eq('user_id', userId);
          } catch {}
          // Delete user profile
          try { await supabase.from('user_profiles').delete().eq('user_id', userId); } catch {}
        }
        // Clear localStorage
        localStorage.clear();
        setStep('done');
      } else {
        // Delete entire account
        // Delete all data first
        for (const member of members) {
          const accountId = member.account_id;
          const vehicles = await db.vehicles.filter({ account_id: accountId });
          for (const v of vehicles) {
            try { await db.vehicles.delete(v.id); } catch {}
          }
          // Delete account membership
          try { await db.account_members.delete(member.id); } catch {}
          // Try to delete the account itself (only if owner)
          if (member.role === 'בעלים') {
            try { await db.accounts.delete(accountId); } catch {}
          }
        }
        // Delete community data
        try {
          await supabase.from('community_posts').delete().eq('user_id', userId);
          await supabase.from('community_comments').delete().eq('user_id', userId);
          await supabase.from('community_likes').delete().eq('user_id', userId);
          await supabase.from('community_reactions').delete().eq('user_id', userId);
          await supabase.from('community_saved').delete().eq('user_id', userId);
          await supabase.from('user_profiles').delete().eq('user_id', userId);
          await supabase.from('community_notifications').delete().eq('user_id', userId);
        } catch {}
        // Clear localStorage
        localStorage.clear();
        // Sign out
        await supabase.auth.signOut();
        setStep('done');
      }
    } catch (err) {
      console.error('Delete error:', err);
      setError('אירעה שגיאה. נסה שוב או פנה לתמיכה.');
      setStep('confirm');
    }
  };

  return (
    <div dir="rtl" className="max-w-md mx-auto py-8 px-4">
      {/* Back button */}
      <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 mb-6 text-sm font-bold" style={{ color: C.primary }}>
        <ArrowRight className="w-4 h-4" /> חזרה
      </button>

      {step === 'choose' && (
        <div className="space-y-6">
          <div className="text-center">
            <h1 className="text-2xl font-black mb-2" style={{ color: '#1F2937' }}>מחיקת חשבון ונתונים</h1>
            <p className="text-sm" style={{ color: '#6B7280' }}>
              CarReminder מאפשרת לך למחוק את הנתונים שלך בכל עת.
              <br />בחר מה ברצונך לעשות:
            </p>
          </div>

          {/* Option 1: Delete data only */}
          <button onClick={() => { setMode('data'); setStep('confirm'); }}
            className="w-full rounded-2xl p-5 text-right transition-all active:scale-[0.99]"
            style={{ background: '#FFF8E1', border: '1.5px solid #FDE68A' }}>
            <div className="flex items-center gap-3 mb-2">
              <FileX className="w-6 h-6" style={{ color: '#D97706' }} />
              <span className="text-base font-black" style={{ color: '#92400E' }}>מחק את הנתונים שלי</span>
            </div>
            <p className="text-xs" style={{ color: '#B45309' }}>
              מוחק את כל הרכבים, המסמכים, הטיפולים והפוסטים שלך. החשבון נשאר פעיל ואפשר להתחיל מחדש.
            </p>
          </button>

          {/* Option 2: Delete account */}
          <button onClick={() => { setMode('account'); setStep('confirm'); }}
            className="w-full rounded-2xl p-5 text-right transition-all active:scale-[0.99]"
            style={{ background: '#FEF2F2', border: '1.5px solid #FECACA' }}>
            <div className="flex items-center gap-3 mb-2">
              <Trash2 className="w-6 h-6" style={{ color: '#DC2626' }} />
              <span className="text-base font-black" style={{ color: '#991B1B' }}>מחק את החשבון לצמיתות</span>
            </div>
            <p className="text-xs" style={{ color: '#DC2626' }}>
              מוחק את החשבון, כל הנתונים, הרכבים, המסמכים והפוסטים. לא ניתן לשחזר. תנותק מהמערכת.
            </p>
          </button>

          <div className="text-center">
            <p className="text-[10px]" style={{ color: '#9CA3AF' }}>
              לשאלות: support@car-reminder.app
            </p>
          </div>
        </div>
      )}

      {step === 'confirm' && (
        <div className="space-y-6">
          <div className="text-center">
            <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
              style={{ background: mode === 'account' ? '#FEF2F2' : '#FFF8E1' }}>
              <AlertTriangle className="w-8 h-8" style={{ color: mode === 'account' ? '#DC2626' : '#D97706' }} />
            </div>
            <h2 className="text-xl font-black mb-2">
              {mode === 'account' ? 'בטוח שברצונך למחוק את החשבון?' : 'בטוח שברצונך למחוק את כל הנתונים?'}
            </h2>
            <p className="text-sm" style={{ color: '#6B7280' }}>
              {mode === 'account'
                ? 'כל הנתונים שלך יימחקו לצמיתות. לא ניתן לשחזר.'
                : 'כל הרכבים, המסמכים, הטיפולים והפוסטים שלך יימחקו. החשבון ישאר פעיל.'}
            </p>
          </div>

          {error && (
            <div className="p-3 rounded-xl text-center text-sm font-bold" style={{ background: '#FEF2F2', color: '#DC2626' }}>
              {error}
            </div>
          )}

          <div className="space-y-3">
            <p className="text-xs font-bold" style={{ color: '#6B7280' }}>הנתונים הבאים יימחקו:</p>
            <ul className="text-xs space-y-1" style={{ color: '#9CA3AF' }}>
              <li>- כל כלי הרכב וכלי השייט</li>
              <li>- מסמכים (ביטוח, רישיון, וכו')</li>
              <li>- טיפולים ותיקונים</li>
              <li>- פוסטים ותגובות בקהילה</li>
              <li>- לייקים ושמירות</li>
              <li>- פרופיל אישי ורישיון נהיגה</li>
              {mode === 'account' && <li className="font-bold text-red-500">- החשבון עצמו (ייסגר)</li>}
            </ul>
          </div>

          <div className="flex gap-3">
            <button onClick={handleDelete}
              className="flex-1 py-3.5 rounded-2xl font-bold text-sm text-white transition-all active:scale-[0.98]"
              style={{ background: mode === 'account' ? '#DC2626' : '#D97706' }}>
              {mode === 'account' ? 'מחק חשבון לצמיתות' : 'מחק את כל הנתונים'}
            </button>
            <button onClick={() => { setStep('choose'); setMode(null); setError(''); }}
              className="px-6 py-3.5 rounded-2xl font-bold text-sm" style={{ color: '#6B7280', background: '#F3F4F6' }}>
              ביטול
            </button>
          </div>
        </div>
      )}

      {step === 'deleting' && (
        <div className="text-center py-16">
          <Loader2 className="w-10 h-10 mx-auto mb-4 animate-spin" style={{ color: '#DC2626' }} />
          <p className="text-base font-bold" style={{ color: '#1F2937' }}>מוחק נתונים...</p>
          <p className="text-sm mt-1" style={{ color: '#9CA3AF' }}>זה עשוי לקחת מספר שניות</p>
        </div>
      )}

      {step === 'done' && (
        <div className="text-center py-16">
          <CheckCircle className="w-14 h-14 mx-auto mb-4" style={{ color: '#10B981' }} />
          <h2 className="text-xl font-black mb-2" style={{ color: '#1F2937' }}>
            {mode === 'account' ? 'החשבון נמחק' : 'הנתונים נמחקו'}
          </h2>
          <p className="text-sm mb-6" style={{ color: '#6B7280' }}>
            {mode === 'account'
              ? 'כל הנתונים שלך נמחקו. אם תרצה, תמיד אפשר ליצור חשבון חדש.'
              : 'כל הנתונים שלך נמחקו. החשבון עדיין פעיל ואפשר להתחיל מחדש.'}
          </p>
          <button onClick={() => {
            if (mode === 'account') window.location.href = '/';
            else navigate(createPageUrl('Dashboard'));
          }}
            className="px-8 py-3 rounded-2xl font-bold text-white" style={{ background: C.primary }}>
            {mode === 'account' ? 'לדף הבית' : 'חזרה למערכת'}
          </button>
        </div>
      )}
    </div>
  );
}
