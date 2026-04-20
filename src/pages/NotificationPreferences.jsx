import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, ChevronRight, Loader2, Shield, Clock, AlertCircle, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import PageHeader from '@/components/shared/PageHeader';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { useMyEmailPreferences, useUpdateMyEmailPreference } from '@/hooks/useEmailAdmin';
import { useAuth } from '@/components/shared/GuestContext';
import { toast } from 'sonner';

/**
 * NotificationPreferences — user-facing page (not admin) for managing
 * which notifications each user wants to receive by email. Groups by
 * category, shows a brief description for each, and persists flips
 * to user_notification_preferences via RLS-protected hooks.
 */

const CATEGORY_VISUAL = {
  transactional: { icon: Mail,        label: 'תפעולי',    fg: '#1E40AF', bg: '#DBEAFE' },
  reminder:      { icon: Clock,       label: 'תזכורות',   fg: '#92400E', bg: '#FEF3C7' },
  system:        { icon: AlertCircle, label: 'מערכת',     fg: '#6B21A8', bg: '#F3E8FF' },
  marketing:     { icon: FileText,    label: 'עדכונים',   fg: '#9D174D', bg: '#FCE7F3' },
};

export default function NotificationPreferences() {
  const navigate = useNavigate();
  const { user, isGuest } = useAuth();
  const { data, isLoading } = useMyEmailPreferences();
  const updatePref = useUpdateMyEmailPreference();

  if (isGuest) {
    return (
      <div dir="rtl" className="min-h-screen flex items-center justify-center p-6"
        style={{ background: '#F4F7F3' }}>
        <div className="max-w-md text-center rounded-3xl p-8"
          style={{ background: 'white', border: '1.5px solid #E5E7EB' }}>
          <Shield className="w-10 h-10 mx-auto mb-3" style={{ color: '#2D5233' }} />
          <h2 className="text-lg font-bold mb-2">נדרשת התחברות</h2>
          <p className="text-sm text-gray-600 mb-5">
            כדי לנהל העדפות מייל, יש להתחבר לחשבון.
          </p>
          <Button onClick={() => navigate('/Auth')} className="rounded-xl"
            style={{ background: '#2D5233', color: 'white' }}>
            להתחברות
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading || !data) return <LoadingSpinner />;

  const handleToggle = async (key, subscribed) => {
    try {
      await updatePref.mutateAsync({ userId: data.userId, notificationKey: key, subscribed });
      toast.success(subscribed ? 'תקבל/י מיילים מסוג זה' : 'לא תקבל/י מיילים מסוג זה');
    } catch (e) {
      toast.error(`שמירה נכשלה: ${e.message}`);
    }
  };

  // Group by category for display.
  const groups = {};
  for (const item of data.items) (groups[item.category] ||= []).push(item);

  return (
    <div dir="rtl" className="min-h-screen pb-24" style={{ background: '#F4F7F3' }}>
      <PageHeader
        title="העדפות מייל"
        subtitle="בחר/י אילו מיילים תרצה/י לקבל מ-CarReminder"
        icon={Mail}
      />

      <div className="max-w-2xl mx-auto px-4 py-6">

        {/* Info banner */}
        <div className="rounded-2xl p-3 mb-5 text-xs"
          style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1E3A8A' }}>
          <strong>הערה:</strong> מיילי אימות והתחברות תמיד נשלחים (נדרשים לאבטחה). את השאר אפשר להשבית כאן.
        </div>

        {Object.keys(groups).length === 0 ? (
          <div className="text-center text-sm text-gray-500 py-12 rounded-2xl bg-white border">
            לא נמצאו סוגי מיילים.
          </div>
        ) : (
          Object.entries(groups).map(([category, items]) => {
            const v = CATEGORY_VISUAL[category] || CATEGORY_VISUAL.transactional;
            const Icon = v.icon;
            return (
              <section key={category} className="mb-6">
                <div className="flex items-center gap-2 mb-3 px-1">
                  <Icon className="w-4 h-4" style={{ color: v.fg }} />
                  <h2 className="text-sm font-bold" style={{ color: '#1C3620' }}>{v.label}</h2>
                </div>
                {items.map(item => (
                  <div key={item.key}
                    className="rounded-2xl p-4 mb-2 flex items-start gap-3"
                    style={{ background: 'white', border: '1.5px solid #E5E7EB' }}>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-sm mb-0.5" style={{ color: '#1C2E20' }}>
                        {item.display_name}
                        {!item.enabled && (
                          <span className="mr-2 text-[10px] font-normal text-gray-400">(כבוי באופן גלובלי)</span>
                        )}
                      </h3>
                      <p className="text-xs text-gray-500 leading-relaxed">
                        {item.description}
                      </p>
                    </div>
                    <Switch
                      checked={item.subscribed}
                      disabled={updatePref.isPending || !item.enabled}
                      onCheckedChange={(v) => handleToggle(item.key, v)}
                    />
                  </div>
                ))}
              </section>
            );
          })
        )}

        <div className="mt-6 text-[11px] text-gray-400 text-center">
          השינויים נשמרים אוטומטית.
        </div>
      </div>
    </div>
  );
}
