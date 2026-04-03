import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { validateUploadFile } from '@/lib/securityUtils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Wrench, Plus, Clock, Edit, Trash2, ChevronsUpDown, Check, Upload, X, AlertTriangle, Settings } from "lucide-react";
import { getTheme } from '@/lib/designTokens';
import FileOrCameraUpload from "@/components/ui/file-or-camera-upload";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import ConfirmDeleteDialog from "../shared/ConfirmDeleteDialog";
import { format, parseISO, addMonths, addWeeks, addDays } from 'date-fns';
import { formatDateHe, usesKm, usesHours } from "../shared/DateStatusUtils";
import StatusBadge from "../shared/StatusBadge";
import { getDateStatus } from "../shared/DateStatusUtils";
import { getCatalogForVehicleType } from "../shared/MaintenanceCatalog";
import { calcUsageAlerts } from "../shared/ReminderEngine";
import MaintenanceDialog from "./MaintenanceDialog";

const PRESET_SMALL = ['החלפת שמן', 'החלפת פילטר שמן', 'החלפת פילטר אוויר', 'החלפת פילטר מזגן'];
const PRESET_LARGE = ['החלפת פלאגים', 'החלפת ציריות', 'החלפת רצועת טיימינג', 'החלפת בולמי זעזועים', 'החלפת רצועות', 'בדיקת בלמים', 'החלפת נוזל בלמים', 'החלפת מצבר'];

function getNextDueDate(lastDate, unit, value) {
  if (!lastDate) return null;
  const d = parseISO(lastDate);
  if (unit === 'חודשים') return addMonths(d, value);
  if (unit === 'שבועות') return addWeeks(d, value);
  if (unit === 'ימים') return addDays(d, value);
  return null;
}

export default function MaintenanceSection({ vehicle }) {
  const T = getTheme(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);
  const [showLogDialog, setShowLogDialog] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [logForm, setLogForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [logType, setLogType] = useState('maintenance'); // 'maintenance' or 'repair'
  const [uploadingFiles, setUploadingFiles] = useState([]);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const queryClient = useQueryClient();

  const { data: user } = useQuery({
    queryKey: ['current-user'],
    queryFn: () => base44.auth.me(),
  });

  const { data: globalTemplates = [] } = useQuery({
    queryKey: ['templates-global'],
    queryFn: () => base44.entities.MaintenanceTemplate.filter({ scope: 'global', is_active: true }),
    enabled: !!user,
  });

  const { data: userTemplates = [] } = useQuery({
    queryKey: ['templates-user', user?.id],
    queryFn: () => base44.entities.MaintenanceTemplate.filter({ scope: 'user', owner_user_id: user.id, is_active: true }),
    enabled: !!user,
  });

  const allTemplates = [...globalTemplates, ...userTemplates];

  const templates = allTemplates;

  const { data: maintenanceLogs = [] } = useQuery({
    queryKey: ['maintenance-logs', vehicle.id],
    queryFn: () => base44.entities.MaintenanceLog.filter({ vehicle_id: vehicle.id }),
    enabled: !!vehicle?.id,
  });

  const { data: repairLogs = [] } = useQuery({
    queryKey: ['repair-logs', vehicle.id],
    queryFn: () => base44.entities.RepairLog.filter({ vehicle_id: vehicle.id }),
    enabled: !!vehicle?.id,
  });

  const { data: repairTypes = [] } = useQuery({
    queryKey: ['repair-types', user?.id],
    queryFn: () => base44.entities.RepairType.filter({ owner_user_id: user.id, is_active: true }),
    enabled: !!user?.id,
  });

  const catalogItems = getCatalogForVehicleType(vehicle.vehicle_type);

  // Usage-based (km/hours) maintenance alerts
  const usageAlerts = calcUsageAlerts({ vehicle, logs: maintenanceLogs, catalog: catalogItems });

  const relevantTemplates = templates.filter(t =>
    !t.applies_to || t.applies_to.length === 0 || t.applies_to.includes(vehicle.vehicle_type)
  );

  const filteredTemplates = searchValue
    ? relevantTemplates.filter(t => t.name.toLowerCase().includes(searchValue.toLowerCase()))
    : relevantTemplates;

  const recommendedTemplates = filteredTemplates.filter(t => t.scope === 'global');
  const myTemplates = filteredTemplates.filter(t => t.scope === 'user');

  const getLastLog = (templateId) => {
    const tLogs = maintenanceLogs.filter(l => l.template_id === templateId).sort((a, b) =>
      new Date(b.performed_at) - new Date(a.performed_at)
    );
    return tLogs[0] || null;
  };

  // Combine logs with type indicator
  const allLogs = [
    ...maintenanceLogs.map(log => ({ ...log, _type: 'maintenance' })),
    ...repairLogs.map(log => ({ ...log, _type: 'repair' }))
  ];

  const openLogDialog = (type = 'maintenance', template = null, existingLog = null) => {
    setLogType(type);
    setSelectedTemplate(template);
    setUploadingFiles([]);
    
    if (existingLog) {
      if (type === 'repair') {
        setLogForm({
          id: existingLog.id,
          title: existingLog.title,
          occurred_at: existingLog.occurred_at,
          repaired_at: existingLog.repaired_at || '',
          description: existingLog.description || '',
          repaired_by: existingLog.repaired_by || 'אני',
          garage_name: existingLog.garage_name || '',
          cost: existingLog.cost || '',
          is_accident: existingLog.is_accident || false,
          accident_details: {},
        });
        const repairType = repairTypes.find(t => t.id === existingLog.repair_type_id);
        setSelectedTemplate(repairType || null);
      } else {
        setLogForm({
          id: existingLog.id,
          performed_at: existingLog.performed_at,
          performed_by: existingLog.performed_by,
          cost: existingLog.cost || '',
          notes: existingLog.notes || '',
          km_at_service: existingLog.km_at_service || '',
          engine_hours_at_service: existingLog.engine_hours_at_service || '',
          service_type: existingLog.service_type || 'small',
          selected_items: existingLog.selected_items || [],
          custom_item_input: '',
        });
      }
    } else {
      if (type === 'repair') {
        setLogForm({
          title: '',
          occurred_at: format(new Date(), 'yyyy-MM-dd'),
          repaired_at: '',
          description: '',
          repaired_by: 'אני',
          garage_name: '',
          cost: '',
          is_accident: false,
          accident_details: {},
        });
      } else {
        setLogForm({
          performed_at: format(new Date(), 'yyyy-MM-dd'),
          performed_by: 'אני',
          cost: '',
          notes: '',
          km_at_service: vehicle.current_km || '',
          engine_hours_at_service: vehicle.current_engine_hours || '',
          service_type: '',
          selected_items: [],
          custom_item_input: '',
        });
      }
    }
    setShowLogDialog(true);
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    for (const file of files) {
      const validation = validateUploadFile(file, 'doc', 10);
      if (!validation.ok) { alert(validation.error); continue; }
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setUploadingFiles(prev => [...prev, { file_url, file_type: 'אחר', fileName: file.name }]);
    }
  };

  const handleSaveLog = async () => {
    setSaving(true);
    
    if (logType === 'repair') {
      if (!logForm.title?.trim() || !logForm.occurred_at) {
        alert('יש להזין כותרת ותאריך אירוע');
        setSaving(false);
        return;
      }
      
      const repairData = {
        vehicle_id: vehicle.id,
        repair_type_id: selectedTemplate?.id,
        title: logForm.title,
        occurred_at: logForm.occurred_at,
        repaired_at: logForm.repaired_at || undefined,
        description: logForm.description || undefined,
        repaired_by: logForm.repaired_by,
        garage_name: logForm.garage_name || undefined,
        cost: logForm.cost ? Number(logForm.cost) : undefined,
        created_by_user_id: user.id,
        is_accident: logForm.is_accident,
      };
      Object.keys(repairData).forEach(k => { if (repairData[k] === undefined || repairData[k] === '') delete repairData[k]; });
      
      let repairLogId;
      if (logForm.id) {
        await base44.entities.RepairLog.update(logForm.id, repairData);
        repairLogId = logForm.id;
      } else {
        const newLog = await base44.entities.RepairLog.create(repairData);
        repairLogId = newLog.id;
      }
      
      for (const file of uploadingFiles) {
        await base44.entities.RepairAttachment.create({
          repair_log_id: repairLogId,
          file_url: file.file_url,
          file_type: file.file_type,
        });
      }
      
      if (logForm.is_accident && Object.keys(logForm.accident_details).length > 0) {
        const existingAccident = await base44.entities.AccidentDetails.filter({ repair_log_id: repairLogId });
        const accidentData = { repair_log_id: repairLogId, ...logForm.accident_details };
        if (existingAccident.length > 0) {
          await base44.entities.AccidentDetails.update(existingAccident[0].id, accidentData);
        } else {
          await base44.entities.AccidentDetails.create(accidentData);
        }
      }
      
      queryClient.invalidateQueries({ queryKey: ['repair-logs', vehicle.id] });
    } else {
      // אם זו תבנית מהמאגר ללא ID, צור תבנית משתמש
      let templateId = selectedTemplate?.id;
      if (selectedTemplate?._catalog && !templateId) {
        const newTemplate = await base44.entities.MaintenanceTemplate.create({
          name: selectedTemplate.name,
          recurrence_enabled: true,
          interval_unit: 'חודשים',
          interval_value: selectedTemplate.months,
          is_active: true,
          scope: 'user',
          owner_user_id: user.id,
        });
        templateId = newTemplate.id;
        queryClient.invalidateQueries({ queryKey: ['templates-all'] });
      }
      // אם אין תבנית, צור תבנית גנרית לפי סוג הטיפול
      if (!templateId) {
        const genericName = logForm.service_type === 'large' ? 'טיפול גדול' : 'טיפול קטן';
        const existing = await base44.entities.MaintenanceTemplate.filter({ scope: 'user', owner_user_id: user.id, name: genericName });
        if (existing.length > 0) {
          templateId = existing[0].id;
        } else {
          const newTemplate = await base44.entities.MaintenanceTemplate.create({
            name: genericName,
            recurrence_enabled: false,
            is_active: true,
            scope: 'user',
            owner_user_id: user.id,
          });
          templateId = newTemplate.id;
        }
      }
      const data = {
        vehicle_id: vehicle.id,
        template_id: templateId,
        performed_at: logForm.performed_at,
        performed_by: logForm.performed_by,
        cost: logForm.cost ? Number(logForm.cost) : undefined,
        notes: logForm.notes || undefined,
        km_at_service: logForm.km_at_service ? Number(logForm.km_at_service) : undefined,
        engine_hours_at_service: logForm.engine_hours_at_service ? Number(logForm.engine_hours_at_service) : undefined,
        service_type: logForm.service_type || 'small',
        selected_items: logForm.selected_items?.length > 0 ? logForm.selected_items : undefined,
      };
      Object.keys(data).forEach(k => { if (data[k] === undefined || data[k] === '') delete data[k]; });
      
      if (logForm.id) {
        await base44.entities.MaintenanceLog.update(logForm.id, data);
      } else {
        await base44.entities.MaintenanceLog.create(data);
      }
      
      queryClient.invalidateQueries({ queryKey: ['maintenance-logs', vehicle.id] });
    }
    
    setShowLogDialog(false);
    setSaving(false);
    toast.success(logForm.id ? 'עודכן בהצלחה' : (logType === 'repair' ? 'תיקון נוסף בהצלחה' : 'טיפול נוסף בהצלחה'));
  };

  const handleDeleteLog = (log) => {
    setDeleteTarget(log);
  };

  const confirmDeleteLog = async () => {
    const log = deleteTarget;
    setDeleteTarget(null);
    if (log._type === 'repair') {
      const attachments = await base44.entities.RepairAttachment.filter({ repair_log_id: log.id });
      for (const att of attachments) {
        await base44.entities.RepairAttachment.delete(att.id);
      }
      const accidentDetails = await base44.entities.AccidentDetails.filter({ repair_log_id: log.id });
      for (const acc of accidentDetails) {
        await base44.entities.AccidentDetails.delete(acc.id);
      }
      await base44.entities.RepairLog.delete(log.id);
      queryClient.invalidateQueries({ queryKey: ['repair-logs', vehicle.id] });
    } else {
      await base44.entities.MaintenanceLog.delete(log.id);
      queryClient.invalidateQueries({ queryKey: ['maintenance-logs', vehicle.id] });
    }
    toast.success('הפריט נמחק בהצלחה');
  };

  const sortedLogs = [...allLogs].sort((a, b) => {
    const dateA = a._type === 'repair' ? a.occurred_at : a.performed_at;
    const dateB = b._type === 'repair' ? b.occurred_at : b.performed_at;
    return new Date(dateB) - new Date(dateA);
  });

  return (
    <>
      <ConfirmDeleteDialog
        open={!!deleteTarget}
        onConfirm={confirmDeleteLog}
        onCancel={() => setDeleteTarget(null)}
      />
      {/* Usage-based alerts */}
      {usageAlerts.length > 0 && (
        <div className="space-y-2 mb-4" dir="rtl">
          {usageAlerts.map(alert => (
            <div
              key={alert.maintenanceName}
              className={`flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm ${
                alert.status === 'danger'
                  ? 'bg-red-50 border border-red-200 text-red-800'
                  : 'bg-amber-50 border border-amber-200 text-amber-800'
              }`}
            >
              <AlertTriangle className={`h-4 w-4 shrink-0 ${alert.status === 'danger' ? 'text-red-500' : 'text-amber-500'}`} />
              <div className="flex-1">
                <span className="font-medium">{alert.maintenanceName}</span>
                <span className="mx-1 text-xs opacity-70">-</span>
                <span className="text-xs">
                  {alert.status === 'danger' ? 'עבר מועד' : 'טיפול בקרוב'} ({alert.usageSinceService.toLocaleString()} / {alert.intervalUsage.toLocaleString()} {alert.unit})
                </span>
              </div>
              <span className={`text-xs font-bold ${alert.status === 'danger' ? 'text-red-600' : 'text-amber-600'}`}>
                {alert.percentUsed}%
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-2xl p-5" dir="ltr"
        style={{ background: '#FFFFFF', border: `1.5px solid ${T.border}`, boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-2">
            <button
              onClick={() => openLogDialog('maintenance')}
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl transition-all active:scale-[0.97]"
              style={{ background: T.yellow, color: T.primary === '#0C7B93' ? '#FFFFFF' : T.text }}>
              <Plus className="h-3.5 w-3.5" />
              טיפול
            </button>
            <button
              onClick={() => openLogDialog('repair')}
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl transition-all active:scale-[0.97]"
              style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' }}>
              <Plus className="h-3.5 w-3.5" />
              תיקון
            </button>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: T.light }}>
              <Wrench className="h-4 w-4" style={{ color: T.primary }} />
            </div>
            <h3 className="font-bold text-sm" style={{ color: T.text }}>יומן טיפולים ותיקונים</h3>
          </div>
        </div>
        <div className="space-y-3">
          {sortedLogs.length === 0 ? (
            <div className="text-center py-10" dir="rtl">
              <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
                style={{ background: T.light }}>
                <Wrench className="h-8 w-8" style={{ color: T.primary, opacity: 0.5 }} />
              </div>
              <p className="text-sm font-medium mb-1" style={{ color: T.text }}>לא בוצעו טיפולים או תיקונים עדיין</p>
              <p className="text-xs mb-5" style={{ color: T.muted }}>הוסף טיפולים ותיקונים כדי לעקוב אחרי התחזוקה</p>
              <div className="flex justify-center gap-2">
                <button onClick={() => openLogDialog('maintenance')}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-2xl font-bold text-sm transition-all active:scale-[0.98]"
                  style={{ background: T.yellow, color: T.primary === '#0C7B93' ? '#FFFFFF' : T.text }}>
                  <Plus className="h-4 w-4" />
                  טיפול חדש
                </button>
                <button onClick={() => openLogDialog('repair')}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-2xl font-bold text-sm transition-all active:scale-[0.98]"
                  style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' }}>
                  <Plus className="h-4 w-4" />
                  תיקון חדש
                </button>
              </div>
            </div>
          ) : (
            sortedLogs.map(log => {
              if (log._type === 'repair') {
                const repairType = repairTypes.find(t => t.id === log.repair_type_id);
                return (
                  <div key={`repair-${log.id}`} className="border border-red-100 rounded-xl p-4 hover:bg-red-50/50 transition-colors" dir="rtl">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge className="bg-red-100 text-red-700 text-xs">תיקון</Badge>
                          <h4 className="text-sm font-semibold text-gray-900">{log.title}</h4>
                          {log.is_accident && (
                            <Badge variant="destructive" className="text-xs gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              תאונה
                            </Badge>
                          )}
                          {repairType && (
                            <Badge variant="outline" className="text-xs">{repairType.name}</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                          <span className="font-medium">{formatDateHe(log.occurred_at)}</span>
                          {log.repaired_by && (
                            <>
                              <span>•</span>
                              <span>{log.repaired_by}</span>
                            </>
                          )}
                          {log.garage_name && (
                            <>
                              <span>•</span>
                              <span>{log.garage_name}</span>
                            </>
                          )}
                        </div>
                        {log.description && (
                          <p className="text-sm text-gray-700 leading-relaxed mb-1">{log.description}</p>
                        )}
                        {log.cost && (
                          <p className="text-xs text-gray-400">עלות: ₪{log.cost.toLocaleString()}</p>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => openLogDialog('repair', null, log)}
                        >
                          <Edit className="h-3.5 w-3.5 text-gray-500" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleDeleteLog(log)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              } else {
                const template = allTemplates.find(t => t.id === log.template_id);
                const nextDue = template && template.recurrence_enabled !== false && template.interval_unit && template.interval_value
                  ? getNextDueDate(log.performed_at, template.interval_unit, template.interval_value)
                  : null;
                const nextDueStr = nextDue ? format(nextDue, 'yyyy-MM-dd') : null;
                const status = nextDueStr ? getDateStatus(nextDueStr) : null;

                return (
                  <div key={`maintenance-${log.id}`} className="border border-amber-100 rounded-xl p-4 hover:bg-amber-50/50 transition-colors" dir="rtl">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <Badge className="bg-amber-100 text-amber-700 text-xs">טיפול</Badge>
                          {log.service_type === 'large' ? (
                            <Badge className="bg-orange-100 text-orange-700 text-xs">טיפול גדול</Badge>
                          ) : (
                            <Badge className="bg-blue-100 text-blue-700 text-xs">טיפול קטן</Badge>
                          )}
                          <h4 className="text-sm font-semibold text-gray-900">{template?.name || 'טיפול'}</h4>
                          {status && (
                            <StatusBadge status={status.status} label={`הבא: ${status.label}`} />
                          )}
                        </div>
                        {log.selected_items?.length > 0 && (
                          <p className="text-xs text-gray-600 mb-2">
                            <span className="font-medium">בוצע: </span>
                            {log.selected_items.join(', ')}
                          </p>
                        )}
                        <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                          <span className="font-medium">{formatDateHe(log.performed_at)}</span>
                          <span>•</span>
                          {usesKm(vehicle.vehicle_type, vehicle.nickname) && log.km_at_service && (
                            <>
                              <span>{log.km_at_service.toLocaleString()} ק״מ</span>
                              <span>•</span>
                            </>
                          )}
                          {usesHours(vehicle.vehicle_type, vehicle.nickname) && log.engine_hours_at_service && (
                            <>
                              <span>{log.engine_hours_at_service} שעות</span>
                              <span>•</span>
                            </>
                          )}
                          <span>{log.performed_by}</span>
                        </div>
                        {log.notes && (
                          <p className="text-sm text-gray-700 leading-relaxed mb-1">{log.notes}</p>
                        )}
                        {log.cost && (
                          <p className="text-xs text-gray-400">עלות: ₪{log.cost.toLocaleString()}</p>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => openLogDialog('maintenance', template, log)}
                        >
                          <Edit className="h-3.5 w-3.5 text-gray-500" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleDeleteLog(log)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              }
            })
          )}
        </div>
      </div>

      {/* Repair dialog (unchanged) */}
      <Dialog open={showLogDialog && logType === 'repair'} onOpenChange={v => { if (!v) setShowLogDialog(false); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>{logForm.id ? 'עריכת' : 'הוספת'} תיקון</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {!selectedTemplate && !logForm.id && (
              <div>
                <Label>סוג תיקון (אופציונלי)</Label>
                <Popover open={searchOpen} onOpenChange={setSearchOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" className="w-full justify-between">
                      {selectedTemplate ? selectedTemplate.name : "בחר סוג תיקון או השאר ריק..."}
                      <ChevronsUpDown className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-full p-0" dir="rtl">
                    <Command shouldFilter={false}>
                      <CommandInput placeholder="חפש סוג תיקון..." value={searchValue} onValueChange={setSearchValue} />
                      {repairTypes.filter(t => searchValue ? t.name.toLowerCase().includes(searchValue.toLowerCase()) : true).length === 0 ? (
                        <CommandEmpty><p className="text-sm text-gray-500 py-4">לא נמצא סוג תיקון</p></CommandEmpty>
                      ) : (
                        <CommandGroup>
                          {repairTypes.filter(t => searchValue ? t.name.toLowerCase().includes(searchValue.toLowerCase()) : true).map(type => (
                            <CommandItem key={type.id} value={type.name} onSelect={() => { setSelectedTemplate(type); setSearchOpen(false); setSearchValue(''); }}>
                              <Check className={`ml-2 h-4 w-4 ${selectedTemplate?.id === type.id ? 'opacity-100' : 'opacity-0'}`} />
                              {type.name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            )}
            <div>
              <Label>כותרת *</Label>
              <Input value={logForm.title} onChange={e => setLogForm(f => ({ ...f, title: e.target.value }))} placeholder="למשל: פחחות אחרי תאונה, החלפת מראה" required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>תאריך האירוע *</Label>
                <DateInput value={logForm.occurred_at} onChange={e => setLogForm(f => ({ ...f, occurred_at: e.target.value }))} required />
              </div>
              <div>
                <Label>תאריך תיקון (אופציונלי)</Label>
                <DateInput value={logForm.repaired_at} onChange={e => setLogForm(f => ({ ...f, repaired_at: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>תיאור</Label>
              <Textarea value={logForm.description} onChange={e => setLogForm(f => ({ ...f, description: e.target.value }))} placeholder="מה קרה? מה תוקן?" className="min-h-[100px]" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>בוצע על ידי</Label>
                <Select value={logForm.repaired_by} onValueChange={v => setLogForm(f => ({ ...f, repaired_by: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="אני">אני</SelectItem>
                    <SelectItem value="מוסך">מוסך</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>שם מוסך (אופציונלי)</Label>
                <Input value={logForm.garage_name} onChange={e => setLogForm(f => ({ ...f, garage_name: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>עלות (אופציונלי)</Label>
              <Input type="number" value={logForm.cost} onChange={e => setLogForm(f => ({ ...f, cost: e.target.value }))} placeholder="₪" />
            </div>
            <div>
              <Label>קבצים מצורפים</Label>
              <div className="mt-2">
                <FileOrCameraUpload
                  accept="image/*,.pdf"
                  multiple
                  onChange={handleFileUpload}
                  label="העלה קבצים (תמונות, חשבוניות)"
                />
                {uploadingFiles.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {uploadingFiles.map((file, idx) => (
                      <div key={idx} className="flex items-center justify-between text-xs bg-gray-50 p-2 rounded">
                        <span>{file.fileName}</span>
                        <Button type="button" variant="ghost" size="icon" className="h-5 w-5" onClick={() => setUploadingFiles(prev => prev.filter((_, i) => i !== idx))}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-yellow-50 border border-yellow-200">
              <div>
                <p className="text-sm font-medium text-gray-900">זה אירוע תאונה?</p>
                <p className="text-xs text-gray-500">אם כן, אפשר להוסיף פרטי הנהג השני וביטוח</p>
              </div>
              <Switch checked={logForm.is_accident} onCheckedChange={v => setLogForm(f => ({ ...f, is_accident: v }))} />
            </div>
            {logForm.is_accident && (
              <div className="space-y-3 border-t pt-4">
                <h4 className="font-semibold text-sm text-gray-900">פרטי תאונה</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>שם הנהג השני</Label>
                    <Input value={logForm.accident_details?.other_driver_name || ''} onChange={e => setLogForm(f => ({ ...f, accident_details: { ...f.accident_details, other_driver_name: e.target.value } }))} />
                  </div>
                  <div>
                    <Label>טלפון</Label>
                    <Input value={logForm.accident_details?.other_driver_phone || ''} onChange={e => setLogForm(f => ({ ...f, accident_details: { ...f.accident_details, other_driver_phone: e.target.value } }))} />
                  </div>
                </div>
                <div>
                  <Label>מספר רישוי של הנהג השני</Label>
                  <Input value={logForm.accident_details?.other_driver_license_plate || ''} onChange={e => setLogForm(f => ({ ...f, accident_details: { ...f.accident_details, other_driver_license_plate: e.target.value } }))} />
                </div>
                <div>
                  <Label>מספר תביעה ביטוחית</Label>
                  <Input value={logForm.accident_details?.insurance_claim_number || ''} onChange={e => setLogForm(f => ({ ...f, accident_details: { ...f.accident_details, insurance_claim_number: e.target.value } }))} />
                </div>
                <div>
                  <Label>הערות נוספות</Label>
                  <Textarea value={logForm.accident_details?.notes || ''} onChange={e => setLogForm(f => ({ ...f, accident_details: { ...f.accident_details, notes: e.target.value } }))} className="min-h-[60px]" />
                </div>
              </div>
            )}
            <Button onClick={handleSaveLog} disabled={saving} className="w-full bg-red-600 hover:bg-red-700 text-white h-11">
              {saving ? <Clock className="h-4 w-4 animate-spin" /> : logForm.id ? 'עדכן תיקון' : 'שמור תיקון'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* New maintenance dialog */}
      <MaintenanceDialog
        open={showLogDialog && logType === 'maintenance'}
        onOpenChange={v => { if (!v) setShowLogDialog(false); }}
        vehicle={vehicle}
        logForm={logForm}
        setLogForm={setLogForm}
        saving={saving}
        onSave={handleSaveLog}
        user={user}
      />
    </>
  );
}