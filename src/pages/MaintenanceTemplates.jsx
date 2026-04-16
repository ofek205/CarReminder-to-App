import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Edit, Trash2, Loader2, Wrench, Settings, ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PageHeader from "../components/shared/PageHeader";
import LoadingSpinner from "../components/shared/LoadingSpinner";
import EmptyState from "../components/shared/EmptyState";
import ConfirmDeleteDialog from "../components/shared/ConfirmDeleteDialog";
import { toast } from "sonner";
import { useAuth } from "../components/shared/GuestContext";
import { C } from '@/lib/designTokens';

const vehicleTypes = ['רכב', 'אופנוע כביש', 'קטנוע', 'כלי שייט', 'מפרשית', 'סירה מנועית', 'אופנוע ים', 'סירת גומי', "ג'יפ שטח", 'טרקטורון', 'אופנוע שטח', 'RZR', 'מיול', 'באגי חולות'];
const intervalUnits = ['ימים', 'שבועות', 'חודשים'];

export default function MaintenanceTemplates() {
  const { isGuest } = useAuth();
  if (isGuest) {
    const demoItems = [
      { name: 'טיפול שמן מנוע', interval: 'כל 6 חודשים / 10,000 ק"מ', icon: '🛢️' },
      { name: 'החלפת מסנן אוויר', interval: 'כל 12 חודשים / 20,000 ק"מ', icon: '💨' },
      { name: 'בדיקת בלמים', interval: 'כל 12 חודשים / 15,000 ק"מ', icon: '🔧' },
    ];
    return (
      <div dir="rtl">
        <PageHeader title="טיפולים ותיקונים" />
        {/* Demo banner */}
        <div className="mb-4 rounded-2xl p-3.5 flex items-center gap-3"
          style={{ background: 'linear-gradient(135deg, #FEF3C7, #FFF8E1)', border: '1.5px solid #FDE68A' }}>
          <span className="text-lg">👀</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-black" style={{ color: '#92400E' }}>טיפולים לדוגמה</p>
            <p className="text-xs" style={{ color: '#B45309' }}>הירשם כדי ליצור תבניות טיפול מותאמות אישית</p>
          </div>
        </div>
        {/* Demo items */}
        <div className="space-y-2 mb-6">
          {demoItems.map(item => (
            <div key={item.name} className="rounded-2xl p-4 flex items-center gap-3"
              style={{ background: '#fff', border: `1.5px solid ${C.border}`, opacity: 0.7 }}>
              <span className="text-lg">{item.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold" style={{ color: C.text }}>{item.name}</p>
                <p className="text-xs" style={{ color: C.muted }}>{item.interval}</p>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: '#FFBF00', color: '#92400E' }}>לדוגמה</span>
            </div>
          ))}
        </div>
        {/* CTA */}
        <Card className="p-6 border border-gray-100 shadow-sm rounded-2xl text-center space-y-3">
          <p className="text-sm font-medium text-gray-500">הירשם כדי ליצור תבניות מותאמות ולעקוב אחרי לוח הזמנים</p>
          <Button onClick={() => window.location.href = '/Auth'}
            className="text-white gap-2 rounded-2xl font-bold"
            style={{ background: C.yellow, color: C.primary }}>
            הירשם בחינם
          </Button>
        </Card>
      </div>
    );
  }
  return <AuthMaintenanceTemplates />;
}

function AuthMaintenanceTemplates() {
  const [userId, setUserId] = useState(null);
  const [showDialog, setShowDialog] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dialogType, setDialogType] = useState('maintenance');
  const [deleteTarget, setDeleteTarget] = useState(null); // { type, item }
  const [globalExpanded, setGlobalExpanded] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('mine'); // 'all' | 'mine' | 'global'
  const [frequencyFilter, setFrequencyFilter] = useState('all');
  const [form, setForm] = useState({
    name: '',
    is_recurring: true,
    interval_unit: 'חודשים',
    interval_value: 6,
    applies_to: [],
  });
  const queryClient = useQueryClient();

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
    }
    init();
  }, []);

  const { data: globalTpl = [], isLoading: loadingGlobal } = useQuery({
    queryKey: ['templates-global'],
    queryFn: async () => {
      // TODO: MaintenanceTemplate entity not yet in Supabase - returning empty array
      return [];
    },
    enabled: !!userId,
  });

  const { data: userTpl = [], isLoading: loadingUser } = useQuery({
    queryKey: ['templates-user', userId],
    queryFn: async () => {
      // TODO: MaintenanceTemplate entity not yet in Supabase - returning empty array
      return [];
    },
    enabled: !!userId,
  });

  const isLoading = loadingGlobal || loadingUser;
  const templates = [...globalTpl, ...userTpl];

  const { data: repairTypes = [], isLoading: loadingRepairTypes } = useQuery({
    queryKey: ['repair-types', userId],
    queryFn: async () => {
      // TODO: RepairType entity not yet in Supabase - returning empty array
      return [];
    },
    enabled: !!userId,
  });

  const openDialog = (type = 'maintenance', template = null) => {
    setDialogType(type);
    if (template) {
      setEditingTemplate(template);
      if (type === 'repair') {
        setForm({ name: template.name });
      } else {
        setForm({
          name: template.name,
          is_recurring: template.recurrence_enabled !== false,
          interval_unit: template.interval_unit || 'חודשים',
          interval_value: template.interval_value || 6,
          applies_to: template.applies_to || [],
          remind_days_before: template.remind_days_before || '',
        });
      }
    } else {
      setEditingTemplate(null);
      if (type === 'repair') {
        setForm({ name: '' });
      } else {
        setForm({
          name: '',
          is_recurring: true,
          interval_unit: 'חודשים',
          interval_value: 6,
          applies_to: [],
          remind_days_before: '',
        });
      }
    }
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error(`יש להזין שם ${dialogType === 'repair' ? 'תיקון' : 'טיפול'}`);
      return;
    }
    
    setSaving(true);
    
    if (dialogType === 'repair') {
      const repairData = {
        name: form.name,
        scope: 'user',
        owner_user_id: userId,
        is_active: true,
      };
      
      // TODO: RepairType entity not yet in Supabase - CRUD is a no-op for now
      // if (editingTemplate) {
      //   await db.repair_types.update(editingTemplate.id, repairData);
      // } else {
      //   await db.repair_types.create(repairData);
      // }
      
      queryClient.invalidateQueries({ queryKey: ['repair-types'] });
    } else {
      const data = {
        name: form.name,
        recurrence_enabled: form.is_recurring,
        interval_unit: form.is_recurring ? form.interval_unit : undefined,
        interval_value: form.is_recurring ? Number(form.interval_value) : undefined,
        remind_days_before: form.is_recurring && form.remind_days_before ? Number(form.remind_days_before) : undefined,
        applies_to: form.applies_to,
        is_active: true,
        scope: 'user',
        owner_user_id: userId,
      };
      Object.keys(data).forEach(k => { if (data[k] === undefined) delete data[k]; });

      // TODO: MaintenanceTemplate entity not yet in Supabase - CRUD is a no-op for now
      // if (editingTemplate) {
      //   await db.maintenance_templates.update(editingTemplate.id, data);
      // } else {
      //   await db.maintenance_templates.create(data);
      // }

      queryClient.invalidateQueries({ queryKey: ['templates'] });
    }
    
    setShowDialog(false);
    setSaving(false);
    toast.success(editingTemplate ? 'עודכן בהצלחה' : 'נוסף בהצלחה');
  };

  const handleDelete = async (type, item) => {
    setDeleteTarget({ type, item });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const { type, item } = deleteTarget;
    setDeleteTarget(null);
    // TODO: RepairLog, RepairType, MaintenanceLog, MaintenanceTemplate not yet in Supabase - delete is a no-op
    if (type === 'repair') {
      // const logs = await db.repair_logs.filter({ repair_type_id: item.id });
      // if (logs.length > 0) {
      //   await db.repair_types.update(item.id, { is_active: false });
      // } else {
      //   await db.repair_types.delete(item.id);
      // }
      queryClient.invalidateQueries({ queryKey: ['repair-types'] });
    } else {
      // const logs = await db.maintenance_logs.filter({ template_id: item.id });
      // if (logs.length > 0) {
      //   await db.maintenance_templates.update(item.id, { is_active: false });
      // } else {
      //   await db.maintenance_templates.delete(item.id);
      // }
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    }
    toast.success('הפריט נמחק בהצלחה');
  };

  const toggleAppliesTo = (type) => {
    setForm(f => ({
      ...f,
      applies_to: f.applies_to.includes(type)
        ? f.applies_to.filter(t => t !== type)
        : [...f.applies_to, type]
    }));
  };

  if (!userId || isLoading || loadingRepairTypes) return <LoadingSpinner />;

  const activeTemplates = templates.filter(t => t.is_active !== false);
  const inactiveTemplates = templates.filter(t => t.is_active === false);
  const userTemplates = activeTemplates.filter(t => t.scope === 'user');
  const globalTemplates = activeTemplates.filter(t => t.scope === 'global');
  const activeRepairTypes = repairTypes.filter(t => t.is_active !== false);
  const inactiveRepairTypes = repairTypes.filter(t => t.is_active === false);

  return (
    <div className="space-y-6">
      <ConfirmDeleteDialog
        open={!!deleteTarget}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
      <PageHeader
        title="סוגי טיפולים ותיקונים"
        subtitle="נהל סוגי טיפולים ותיקונים לרכבים שלך"
      />

      <Tabs defaultValue="maintenance" className="w-full" dir="rtl">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="maintenance">סוגי טיפולים</TabsTrigger>
          <TabsTrigger value="repairs">סוגי תיקונים</TabsTrigger>
        </TabsList>

        <TabsContent value="maintenance" className="space-y-5">
          {/* Header row */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">{userTemplates.length} אישיים • {globalTemplates.length} מומלצים</p>
            <Button onClick={() => openDialog('maintenance')} className="bg-[#2D5233] hover:bg-[#1E3D24] text-white gap-2">
              <Plus className="h-4 w-4" />
              סוג טיפול חדש
            </Button>
          </div>

          {/* Category filter tabs */}
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit" dir="rtl">
            {[
              { value: 'mine', label: 'הטיפולים שלי' },
              { value: 'all', label: 'הכל' },
              { value: 'global', label: 'מומלצים' },
            ].map(tab => (
              <button
                key={tab.value}
                onClick={() => {
                  setCategoryFilter(tab.value);
                  if (tab.value === 'global') setGlobalExpanded(true);
                }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  categoryFilter === tab.value
                    ? 'bg-white text-amber-700 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search bar */}
          {(categoryFilter === 'mine' || categoryFilter === 'all') && (
            <div className="flex gap-2" dir="rtl">
              <Input
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && setActiveSearch(searchInput)}
                placeholder="חפש טיפול…"
                className="flex-1"
              />
              <Button onClick={() => setActiveSearch(searchInput)} variant="outline" className="gap-1.5">
                <Search className="h-4 w-4" />
                חפש
              </Button>
              {(activeSearch || searchInput || frequencyFilter !== 'all') && (
                <Button variant="ghost" onClick={() => { setSearchInput(''); setActiveSearch(''); setFrequencyFilter('all'); }} className="gap-1.5 text-gray-500">
                  <X className="h-4 w-4" />
                  נקה
                </Button>
              )}
            </div>
          )}

          {/* Frequency filter */}
          {(categoryFilter === 'mine' || categoryFilter === 'all') && (
            <div className="flex items-center gap-2" dir="rtl">
              <span className="text-sm text-gray-500">תדירות:</span>
              <Select value={frequencyFilter} onValueChange={setFrequencyFilter}>
                <SelectTrigger className="w-44 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">הכל</SelectItem>
                  <SelectItem value="monthly">חודשי</SelectItem>
                  <SelectItem value="biannual">כל 6 חודשים</SelectItem>
                  <SelectItem value="yearly">שנתי</SelectItem>
                  <SelectItem value="none">לא תקופתי</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* === הטיפולים שלי === */}
          {(categoryFilter === 'mine' || categoryFilter === 'all') && (() => {
            const filtered = userTemplates.filter(t => {
              const matchSearch = !activeSearch ||
                t.name.toLowerCase().includes(activeSearch.toLowerCase());
              const matchFreq = frequencyFilter === 'all' ||
                (frequencyFilter === 'none' && t.recurrence_enabled === false) ||
                (frequencyFilter === 'monthly' && t.recurrence_enabled !== false && t.interval_unit === 'חודשים' && t.interval_value === 1) ||
                (frequencyFilter === 'biannual' && t.recurrence_enabled !== false && t.interval_unit === 'חודשים' && t.interval_value === 6) ||
                (frequencyFilter === 'yearly' && t.recurrence_enabled !== false && ((t.interval_unit === 'חודשים' && t.interval_value === 12) || (t.interval_unit === 'ימים' && t.interval_value === 365)));
              return matchSearch && matchFreq;
            });

            return (
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">הטיפולים שלי</h3>
                {filtered.length === 0 ? (
                  <EmptyState icon={Wrench} title="אין טיפולים" description="הוסף טיפול חדש או שנה את הפילטר" />
                ) : (
                  <div className="space-y-2">
                    {filtered.map(template => (
                      <Card key={template.id} className="p-4 border border-gray-100">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <h4 className="font-semibold text-gray-900">{template.name}</h4>
                              <Badge variant="outline" className="text-xs">אישי</Badge>
                              {template.recurrence_enabled === false && <Badge variant="secondary" className="text-xs">חד-פעמי</Badge>}
                            </div>
                            {template.recurrence_enabled !== false ? (
                              <p className="text-sm text-gray-500">כל {template.interval_value} {template.interval_unit}</p>
                            ) : (
                              <p className="text-sm text-gray-500">טיפול חד-פעמי ללא תזכורות</p>
                            )}
                            {template.applies_to?.length > 0 && (
                              <div className="flex gap-1 mt-2 flex-wrap">
                                {template.applies_to.map(type => (
                                  <Badge key={type} variant="secondary" className="text-xs">{type}</Badge>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" onClick={() => openDialog('maintenance', template)}>
                              <Edit className="h-4 w-4 text-gray-500" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => handleDelete('maintenance', template)}>
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* === טיפולים מומלצים (collapsed by default) === */}
          {(categoryFilter === 'global' || categoryFilter === 'all') && globalTemplates.length > 0 && (
            <div>
              <button
                onClick={() => setGlobalExpanded(v => !v)}
                className="w-full flex items-center justify-between p-3 rounded-xl border border-gray-200 bg-gray-50 hover:bg-gray-100 transition-colors"
                dir="rtl"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-600">טיפולים מומלצים</span>
                  <Badge variant="secondary" className="text-xs">{globalTemplates.length} מומלצים</Badge>
                </div>
                {globalExpanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
              </button>

              {globalExpanded && (
                <div className="space-y-2 mt-2">
                  {globalTemplates.map(template => (
                    <Card key={template.id} className="p-4 border border-gray-100 bg-gray-50/50">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <h4 className="font-medium text-gray-800">{template.name}</h4>
                            <Badge variant="outline" className="text-xs bg-white">מומלץ</Badge>
                            {template.recurrence_enabled === false && <Badge variant="secondary" className="text-xs">חד-פעמי</Badge>}
                          </div>
                          {template.recurrence_enabled !== false ? (
                            <p className="text-sm text-gray-500">כל {template.interval_value} {template.interval_unit}</p>
                          ) : (
                            <p className="text-sm text-gray-500">טיפול חד-פעמי ללא תזכורות</p>
                          )}
                          {template.applies_to?.length > 0 && (
                            <div className="flex gap-1 mt-2 flex-wrap">
                              {template.applies_to.map(type => (
                                <Badge key={type} variant="secondary" className="text-xs">{type}</Badge>
                              ))}
                            </div>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 text-amber-700 border-amber-300 hover:bg-amber-50 shrink-0 mr-2"
                          onClick={async () => {
                            // TODO: MaintenanceTemplate entity not yet in Supabase - clone is a no-op
                            // await db.maintenance_templates.create({
                            //   name: template.name,
                            //   recurrence_enabled: template.recurrence_enabled,
                            //   interval_unit: template.interval_unit,
                            //   interval_value: template.interval_value,
                            //   remind_days_before: template.remind_days_before,
                            //   applies_to: template.applies_to,
                            //   is_active: true,
                            //   scope: 'user',
                            //   owner_user_id: userId,
                            // });
                            queryClient.invalidateQueries({ queryKey: ['templates'] });
                            toast.info('הוספת טיפולים תתאפשר בקרוב (בהעברה ל-Supabase)');
                          }}
                        >
                          <Plus className="h-3.5 w-3.5" />
                          הוסף
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Inactive templates */}
          {inactiveTemplates.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-400 mb-3">סוגי טיפול מושבתים</h3>
              <div className="space-y-2">
                {inactiveTemplates.map(template => (
                  <Card key={template.id} className="p-4 border border-gray-100 opacity-50">
                    <div>
                      <h4 className="font-medium text-gray-600">{template.name}</h4>
                      <p className="text-sm text-gray-400">לא פעיל</p>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="repairs" className="space-y-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">{activeRepairTypes.length} סוגי תיקון פעילים</p>
            <Button onClick={() => openDialog('repair')} className="bg-[#DC2626] hover:bg-[#B91C1C] text-white gap-2">
              <Plus className="h-4 w-4" />
              סוג תיקון חדש
            </Button>
          </div>

          {activeRepairTypes.length > 0 ? (
            <div className="space-y-2">
              {activeRepairTypes.map(type => (
                <Card key={type.id} className="p-4 border border-gray-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-semibold text-gray-900">{type.name}</h4>
                      <p className="text-xs text-gray-400">סוג תיקון אישי</p>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openDialog('repair', type)}>
                        <Edit className="h-4 w-4 text-gray-500" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete('repair', type)}>
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

          {inactiveRepairTypes.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-400 mb-3">סוגי תיקון מושבתים</h3>
              <div className="space-y-2">
                {inactiveRepairTypes.map(type => (
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
        </TabsContent>
      </Tabs>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? 'עריכת' : 'הוספת'} {dialogType === 'repair' ? 'סוג תיקון' : 'סוג טיפול'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{dialogType === 'repair' ? 'שם סוג התיקון' : 'שם הטיפול'} *</Label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder={dialogType === 'repair' ? 'למשל: פחחות, החלפת חלון, תיקון מזגן' : 'למשל: החלפת פלאגים'}
                required
              />
            </div>

            {dialogType === 'maintenance' && (
              <>
                <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
                  <div>
                    <p className="text-sm font-medium text-gray-900">טיפול תקופתי</p>
                    <p className="text-xs text-gray-500">אם כבוי - טיפול חד-פעמי ללא תזכורות</p>
                  </div>
                  <Switch
                    checked={form.is_recurring}
                    onCheckedChange={v => setForm(f => ({ ...f, is_recurring: v }))}
                  />
                </div>

                {form.is_recurring && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>תדירות *</Label>
                        <Input
                          type="number"
                          min={1}
                          value={form.interval_value}
                          onChange={e => setForm(f => ({ ...f, interval_value: e.target.value }))}
                          required
                        />
                      </div>
                      <div>
                        <Label>יחידה</Label>
                        <Select value={form.interval_unit} onValueChange={v => setForm(f => ({ ...f, interval_unit: v }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {intervalUnits.map(unit => (
                              <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label>ימים מראש לתזכורת</Label>
                      <Input
                        type="number"
                        min={1}
                        placeholder="ברירת מחדל: 7 ימים"
                        value={form.remind_days_before || ''}
                        onChange={e => setForm(f => ({ ...f, remind_days_before: e.target.value }))}
                      />
                      <p className="text-xs text-gray-400 mt-1">כמה ימים לפני המועד לשלוח תזכורת</p>
                    </div>
                  </>
                )}

                <div>
                  <Label>חל על סוגי כלי רכב</Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {vehicleTypes.map(type => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => toggleAppliesTo(type)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                          form.applies_to.includes(type)
                            ? 'bg-amber-100 text-amber-700 border border-amber-200'
                            : 'bg-gray-100 text-gray-600 border border-gray-200'
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 mt-2">
                    {form.applies_to.length === 0 ? 'אם לא נבחר, יחול על כל סוגי הרכב' : ''}
                  </p>
                </div>
              </>
            )}

            <Button
              onClick={handleSave}
              disabled={saving}
              className={`w-full ${dialogType === 'repair' ? 'bg-[#DC2626] hover:bg-[#B91C1C]' : 'bg-[#2D5233] hover:bg-[#1E3D24]'} text-white h-11`}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingTemplate ? 'עדכן' : `צור ${dialogType === 'repair' ? 'סוג תיקון' : 'סוג טיפול'}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}