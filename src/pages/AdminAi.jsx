/**
 * AdminAi — unified admin "AI" screen. Consolidates the two previously
 * separate admin pages that both deal with the AI subsystem:
 *   • שימוש (usage)   → AdminAiUsage  — analytics + feature-flag toggles
 *   • הגדרות (settings) → AdminAiSettings — provider-per-feature picker
 *
 * They shared an audience (admin), a topic (AI), and were split across two
 * unrelated nav sections. This page renders them as two tabs under a single
 * nav entry. Each child is rendered with `embedded` so it drops its own
 * admin-gate + page header (this parent owns both); the child still manages
 * its own loading/empty/error states inside the tab body, so the tab bar
 * stays visible and switchable at all times.
 *
 * The standalone routes (AdminAiUsage / AdminAiSettings) stay registered in
 * pages.config so existing deep links / bookmarks don't break.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import useIsAdmin from '@/hooks/useIsAdmin';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Sparkles, ArrowRight, BarChart3, SlidersHorizontal } from 'lucide-react';
import AdminAiUsage from './AdminAiUsage';
import AdminAiSettings from './AdminAiSettings';

export default function AdminAi() {
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();

  if (isAdmin === null) {
    return <div className="p-8 text-center text-sm text-gray-500">בודק הרשאות...</div>;
  }
  if (isAdmin === false) {
    return (
      <div className="p-8 text-center" dir="rtl">
        <p className="text-sm text-gray-600 mb-4">דף זה פתוח לאדמינים בלבד.</p>
        <button onClick={() => navigate(-1)} className="px-4 py-2 rounded-lg bg-[#2D5233] text-white text-sm font-bold">חזרה</button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6" dir="rtl">
      <div className="flex items-center justify-between mb-6">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm font-bold text-[#2D5233]">
          <ArrowRight className="w-4 h-4" /> חזרה
        </button>
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-[#D97706]" />
          <h1 className="text-xl sm:text-2xl font-bold text-[#1F2937]">AI</h1>
        </div>
      </div>

      <Tabs defaultValue="usage" dir="rtl" className="w-full">
        <TabsList className="mb-4 w-full flex flex-wrap justify-start gap-1 rounded-2xl bg-white border p-1 h-auto">
          <TabsTrigger value="usage" className="gap-2 rounded-xl min-h-[40px]">
            <BarChart3 className="w-4 h-4" /> שימוש
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2 rounded-xl min-h-[40px]">
            <SlidersHorizontal className="w-4 h-4" /> הגדרות
          </TabsTrigger>
        </TabsList>

        <TabsContent value="usage">
          <AdminAiUsage embedded />
        </TabsContent>
        <TabsContent value="settings">
          <AdminAiSettings embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}
