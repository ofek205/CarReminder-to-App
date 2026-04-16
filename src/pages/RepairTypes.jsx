import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { db } from '@/lib/supabaseEntities';
import { useAuth } from '@/components/shared/GuestContext';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Edit, Trash2, Loader2, Wrench } from "lucide-react";
import PageHeader from "../components/shared/PageHeader";
import LoadingSpinner from "../components/shared/LoadingSpinner";
import EmptyState from "../components/shared/EmptyState";

export default function RepairTypes() {
  const { isGuest } = useAuth();
  const [userId, setUserId] = useState(null);
  const [showDialog, setShowDialog] = useState(false);
  const [editingType, setEditingType] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '' });
  const queryClient = useQueryClient();

  useEffect(() => {
    if (isGuest) return;
    async function init() {
      try {
        const user = await supabase.auth.getUser().then(r => r.data.user);
        setUserId(user.id);
      } catch {}
    }
    init();
  }, [isGuest]);

  const { data: repairTypes = [], isLoading } = useQuery({
    queryKey: ['repair-types', userId],
    queryFn: () => /* TODO: migrate */ [].filter && db.vehicles.filter({ owner_user_id: userId }),
    enabled: !!userId,
  });

  const openDialog = (type = null) => {
    if (type) {
      setEditingType(type);
      setForm({ name: type.name });
    } else {
      setEditingType(null);
      setForm({ name: '' });
    }
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('יש להזין שם סוג תיקון');
      return;
    }

    setSaving(true);
    const data = {
      name: form.name,
      scope: 'user',
      owner_user_id: userId,
      is_active: true,
    };

    if (editingType) {
      await base44.entities.RepairType.update(editingType.id, data);
    } else {
      await base44.entities.RepairType.create(data);
    }

    queryClient.invalidateQueries({ queryKey: ['repair-types'] });
    setShowDialog(false);
    setSaving(false);
  };

  const handleDelete = async (type) => {
    // Check if there are logs using this type
    const logs = await /* TODO: migrate */ [].filter && db.vehicles.filter({ repair_type_id: type.id });

    if (logs.length > 0) {
      // Soft delete
      if (!confirm(`קיימים ${logs.length} תיקונים המשתמשים בסוג זה. הסוג יסומן כלא פעיל ולא יהיה זמין להוספה עתידית. להמשיך?`)) {
        return;
      }
      await base44.entities.RepairType.update(type.id, { is_active: false });
    } else {
      // Hard delete
      if (!confirm('למחוק סוג תיקון זה? פעולה זו בלתי הפיכה.')) return;
      await base44.entities.RepairType.delete(type.id);
    }

    queryClient.invalidateQueries({ queryKey: ['repair-types'] });
  };

  if (isGuest) return (
    <div className="space-y-6" dir="rtl">
      <PageHeader title="ניהול סוגי תיקונים" />
      <EmptyState
        icon={Wrench}
        title="הירשם כדי לנהל סוגי תיקונים"
        description="לאחר הרשמה תוכל להגדיר סוגי תיקונים מותאמים אישית לרכב שלך"
      />
    </div>
  );

  if (!userId || isLoading) return <LoadingSpinner />;

  const activeTypes = repairTypes.filter(t => t.is_active !== false);
  const inactiveTypes = repairTypes.filter(t => t.is_active === false);

  return (
    <div className="space-y-6">
      <PageHeader
        title="ניהול סוגי תיקונים"
        subtitle={`${activeTypes.length} סוגי תיקון פעילים`}
        actions={
          <Button onClick={() => openDialog()} className="bg-red-600 hover:bg-red-700 text-white gap-2">
            <Plus className="h-4 w-4" />
            סוג תיקון חדש
          </Button>
        }
      />

      {activeTypes.length > 0 ? (
        <div className="space-y-2">
          {activeTypes.map(type => (
            <Card key={type.id} className="p-4 border border-gray-100">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-semibold text-gray-900">{type.name}</h4>
                  <p className="text-xs text-gray-400">סוג תיקון אישי</p>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openDialog(type)}
                  >
                    <Edit className="h-4 w-4 text-gray-500" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(type)}
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Wrench}
          title="אין סוגי תיקון"
          description="צור סוגי תיקון כדי לעקוב אחר תיקונים ברכבים"
        />
      )}

      {inactiveTypes.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-400 mb-3">סוגי תיקון מושבתים</h3>
          <div className="space-y-2">
            {inactiveTypes.map(type => (
              <Card key={type.id} className="p-4 border border-gray-100 opacity-50">
                <div>
                  <h4 className="font-medium text-gray-600">{type.name}</h4>
                  <p className="text-sm text-gray-400">לא פעיל</p>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>{editingType ? 'עריכת' : 'הוספת'} סוג תיקון</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>שם סוג התיקון *</Label>
              <Input
                value={form.name}
                onChange={e => setForm({ name: e.target.value })}
                placeholder="למשל: פחחות, החלפת חלון, תיקון מזגן"
                required
              />
            </div>

            <Button
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-red-600 hover:bg-red-700 text-white h-11"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingType ? 'עדכן' : 'צור סוג תיקון'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}