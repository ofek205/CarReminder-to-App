import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useIsAdmin from '@/hooks/useIsAdmin';
import { useEmailNotifications } from '@/hooks/useEmailAdmin';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import PageHeader from '@/components/shared/PageHeader';
import { Mail, ShieldAlert, FileText, Zap, ListTree } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import KillSwitchBanner from '@/components/admin/KillSwitchBanner';
import NotificationTypeRow from '@/components/admin/NotificationTypeRow';
import TemplateEditorDialog from '@/components/admin/TemplateEditorDialog';
import SendTestDialog from '@/components/admin/SendTestDialog';
import TriggersTab from '@/components/admin/TriggersTab';
import SendLogTab from '@/components/admin/SendLogTab';
import StatsStrip from '@/components/admin/StatsStrip';

/**
 * EmailCenter — Admin-only Email Management Center (Phase 1).
 *
 * Access: protected by useIsAdmin. Non-admins see a denied screen and are
 * bounced to the dashboard. RLS on the DB blocks their queries anyway, so
 * the UI check is just a nicer experience than "forbidden" errors.
 *
 * Sections live in separate dialogs opened from the list of notifications,
 * rather than separate tabs — keeps the info density high and the flow
 * short for the admin.
 */

// Group by category so reminders cluster together, auth stays together, etc.
const CATEGORY_ORDER = ['transactional', 'reminder', 'system', 'auth', 'marketing'];
const CATEGORY_LABELS = {
  transactional: 'מיילים טרנזקציוניים',
  reminder:      'תזכורות',
  system:        'התראות מערכת',
  auth:          'אימות והרשמה',
  marketing:     'שיווק',
};

export default function EmailCenter() {
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const { data: notifications = [], isLoading } = useEmailNotifications();

  const [editing, setEditing] = useState(null);   // notification row open in editor
  const [testing, setTesting] = useState(null);   // notification row open in tester

  const grouped = useMemo(() => {
    const byCat = {};
    for (const n of notifications) {
      (byCat[n.category] ||= []).push(n);
    }
    return CATEGORY_ORDER
      .filter(cat => byCat[cat]?.length > 0)
      .map(cat => ({ category: cat, items: byCat[cat] }));
  }, [notifications]);

  // ── Loading / Access control ─────────────────────────────────────────────
  if (isAdmin === null) return <LoadingSpinner />;

  if (isAdmin === false) {
    return (
      <div dir="rtl" className="min-h-screen flex items-center justify-center p-6" style={{ background: '#F4F7F3' }}>
        <div className="max-w-md text-center rounded-3xl p-8"
          style={{ background: 'white', border: '1.5px solid #E5E7EB' }}>
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: '#FEE2E2' }}>
            <ShieldAlert className="w-8 h-8" style={{ color: '#DC2626' }} />
          </div>
          <h2 className="text-xl font-bold mb-2" style={{ color: '#1C2E20' }}>גישה חסומה</h2>
          <p className="text-sm text-gray-600 mb-5">
            מרכז ניהול המיילים זמין לאדמינים בלבד.
          </p>
          <Button onClick={() => navigate('/')} className="rounded-xl" style={{ background: '#2D5233', color: 'white' }}>
            חזרה לדף הראשי
          </Button>
        </div>
      </div>
    );
  }

  // ── Admin view ───────────────────────────────────────────────────────────
  return (
    <div dir="rtl" className="min-h-screen pb-24" style={{ background: '#F4F7F3' }}>
      <PageHeader
        title="מרכז ניהול מיילים"
        subtitle="תבניות, טריגרים, לוג שליחה ו-Kill Switch"
        icon={Mail}
      />

      <div className="max-w-5xl mx-auto px-4 py-6">
        <KillSwitchBanner />
        <StatsStrip />

        <Tabs defaultValue="notifications" dir="rtl" className="w-full">
          <TabsList className="mb-4 w-full justify-start rounded-2xl bg-white border p-1 h-auto">
            <TabsTrigger value="notifications" className="gap-2 rounded-xl">
              <FileText className="w-4 h-4" /> תבניות
            </TabsTrigger>
            <TabsTrigger value="triggers" className="gap-2 rounded-xl">
              <Zap className="w-4 h-4" /> טריגרים ותזמון
            </TabsTrigger>
            <TabsTrigger value="log" className="gap-2 rounded-xl">
              <ListTree className="w-4 h-4" /> לוג שליחה
            </TabsTrigger>
          </TabsList>

          <TabsContent value="notifications" className="m-0">
            {isLoading ? (
              <LoadingSpinner />
            ) : grouped.length === 0 ? (
              <div className="text-center text-sm text-gray-500 py-12 rounded-2xl bg-white border">
                לא נמצאו סוגי מיילים. הרץ את ה-migration של Phase 1 ב-Supabase.
              </div>
            ) : (
              grouped.map(({ category, items }) => (
                <section key={category} className="mb-8">
                  <h2 className="text-sm font-bold mb-3 px-1" style={{ color: '#1C3620' }}>
                    {CATEGORY_LABELS[category] || category}
                    <span className="text-xs font-normal text-gray-400 mr-2">({items.length})</span>
                  </h2>
                  {items.map(n => (
                    <NotificationTypeRow
                      key={n.key}
                      notification={n}
                      onEditTemplate={setEditing}
                      onSendTest={setTesting}
                    />
                  ))}
                </section>
              ))
            )}
          </TabsContent>

          <TabsContent value="triggers" className="m-0">
            <TriggersTab />
          </TabsContent>

          <TabsContent value="log" className="m-0">
            <SendLogTab />
          </TabsContent>
        </Tabs>

        {/* Phase roadmap hint */}
        <div className="mt-8 rounded-2xl p-4 text-xs text-gray-600"
          style={{ background: '#F0F9FF', border: '1px dashed #BAE6FD' }}>
          <strong className="text-sky-900">בפאזות הבאות:</strong>
          &nbsp;Draft/Published + היסטוריית גרסאות · Webhooks (delivered/opened/clicked/bounced) · Audience conditions מתקדמות
        </div>
      </div>

      {/* Dialogs */}
      <TemplateEditorDialog
        notification={editing}
        open={!!editing}
        onClose={() => setEditing(null)}
      />
      <SendTestDialog
        notification={testing}
        open={!!testing}
        onClose={() => setTesting(null)}
      />
    </div>
  );
}
