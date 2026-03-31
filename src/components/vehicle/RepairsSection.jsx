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
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Wrench, Plus, Edit, Trash2, ChevronsUpDown, Check, Upload, X, AlertTriangle } from "lucide-react";
import FileOrCameraUpload from "@/components/ui/file-or-camera-upload";
import { formatDateHe } from "../shared/DateStatusUtils";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import ConfirmDeleteDialog from "../shared/ConfirmDeleteDialog";

export default function RepairsSection({ vehicle }) {
  const [showRepairDialog, setShowRepairDialog] = useState(false);
  const [selectedRepairType, setSelectedRepairType] = useState(null);
  const [repairForm, setRepairForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [uploadingFiles, setUploadingFiles] = useState([]);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const queryClient = useQueryClient();

  const { data: user } = useQuery({
    queryKey: ['current-user'],
    queryFn: () => base44.auth.me(),
  });

  const { data: repairTypes = [] } = useQuery({
    queryKey: ['repair-types', user?.id],
    queryFn: () => base44.entities.RepairType.filter({ owner_user_id: user.id, is_active: true }),
    enabled: !!user?.id,
  });

  const { data: repairLogs = [] } = useQuery({
    queryKey: ['repair-logs', vehicle.id],
    queryFn: () => base44.entities.RepairLog.filter({ vehicle_id: vehicle.id }),
  });

  const filteredTypes = searchValue
    ? repairTypes.filter(t => t.name.toLowerCase().includes(searchValue.toLowerCase()))
    : repairTypes;

  const openRepairDialog = (existingLog = null) => {
    if (existingLog) {
      setRepairForm({
        id: existingLog.id,
        repair_type_id: existingLog.repair_type_id,
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
      const type = repairTypes.find(t => t.id === existingLog.repair_type_id);
      setSelectedRepairType(type || null);
    } else {
      setRepairForm({
        title: '',
        occurred_at: new Date().toISOString().split('T')[0],
        repaired_at: '',
        description: '',
        repaired_by: 'אני',
        garage_name: '',
        cost: '',
        is_accident: false,
        accident_details: {},
      });
      setSelectedRepairType(null);
    }
    setUploadingFiles([]);
    setShowRepairDialog(true);
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

  const handleSaveRepair = async () => {
    if (!repairForm.title?.trim()) {
      alert('יש להזין כותרת');
      return;
    }
    if (!repairForm.occurred_at) {
      alert('יש להזין תאריך אירוע');
      return;
    }

    setSaving(true);
    const repairData = {
      vehicle_id: vehicle.id,
      repair_type_id: selectedRepairType?.id,
      title: repairForm.title,
      occurred_at: repairForm.occurred_at,
      repaired_at: repairForm.repaired_at || undefined,
      description: repairForm.description || undefined,
      repaired_by: repairForm.repaired_by,
      garage_name: repairForm.garage_name || undefined,
      cost: repairForm.cost ? Number(repairForm.cost) : undefined,
      created_by_user_id: user.id,
      is_accident: repairForm.is_accident,
    };
    Object.keys(repairData).forEach(k => { if (repairData[k] === undefined || repairData[k] === '') delete repairData[k]; });

    let repairLogId;
    if (repairForm.id) {
      await base44.entities.RepairLog.update(repairForm.id, repairData);
      repairLogId = repairForm.id;
    } else {
      const newLog = await base44.entities.RepairLog.create(repairData);
      repairLogId = newLog.id;
    }

    // Save attachments
    for (const file of uploadingFiles) {
      await base44.entities.RepairAttachment.create({
        repair_log_id: repairLogId,
        file_url: file.file_url,
        file_type: file.file_type,
      });
    }

    // Save accident details if applicable
    if (repairForm.is_accident && Object.keys(repairForm.accident_details).length > 0) {
      const existingAccident = await base44.entities.AccidentDetails.filter({ repair_log_id: repairLogId });
      const accidentData = {
        repair_log_id: repairLogId,
        ...repairForm.accident_details,
      };
      if (existingAccident.length > 0) {
        await base44.entities.AccidentDetails.update(existingAccident[0].id, accidentData);
      } else {
        await base44.entities.AccidentDetails.create(accidentData);
      }
    }

    queryClient.invalidateQueries({ queryKey: ['repair-logs', vehicle.id] });
    setShowRepairDialog(false);
    setSaving(false);
    toast.success(repairForm.id ? 'תיקון עודכן בהצלחה' : 'תיקון נוסף בהצלחה');
  };

  const handleDeleteRepair = (logId) => {
    setDeleteTarget(logId);
  };

  const confirmDeleteRepair = async () => {
    const logId = deleteTarget;
    setDeleteTarget(null);
    const attachments = await base44.entities.RepairAttachment.filter({ repair_log_id: logId });
    for (const att of attachments) {
      await base44.entities.RepairAttachment.delete(att.id);
    }
    const accidentDetails = await base44.entities.AccidentDetails.filter({ repair_log_id: logId });
    for (const acc of accidentDetails) {
      await base44.entities.AccidentDetails.delete(acc.id);
    }
    await base44.entities.RepairLog.delete(logId);
    queryClient.invalidateQueries({ queryKey: ['repair-logs', vehicle.id] });
    toast.success('הפריט נמחק בהצלחה');
  };

  const sortedLogs = [...repairLogs].sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));
  const repairTypeById = Object.fromEntries(repairTypes.map(t => [t.id, t]));

  return (
    <>
      <ConfirmDeleteDialog
        open={!!deleteTarget}
        onConfirm={confirmDeleteRepair}
        onCancel={() => setDeleteTarget(null)}
      />
      <Card className="p-5 border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-red-600" />
            <h3 className="font-semibold text-gray-900">יומן תיקונים</h3>
          </div>
          <Button
            size="sm"
            onClick={() => openRepairDialog()}
            className="gap-1 text-xs bg-red-600 hover:bg-red-700 text-white"
          >
            <Plus className="h-3.5 w-3.5" />
            תיקון חדש
          </Button>
        </div>
        <div className="space-y-3">
          {sortedLogs.length === 0 ? (
            <div className="text-center py-8">
              <Wrench className="h-12 w-12 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500 mb-4">לא רשומים תיקונים עדיין</p>
              <Button
                onClick={() => openRepairDialog()}
                className="gap-2 bg-red-600 hover:bg-red-700"
              >
                <Plus className="h-4 w-4" />
                תיקון חדש
              </Button>
            </div>
          ) : (
            sortedLogs.map(log => {
              const repairType = repairTypeById[log.repair_type_id];
              return (
                <div key={log.id} className="border border-gray-200 rounded-xl p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
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
                        onClick={() => openRepairDialog(log)}
                      >
                        <Edit className="h-3.5 w-3.5 text-gray-500" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleDeleteRepair(log.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>

      <Dialog open={showRepairDialog} onOpenChange={setShowRepairDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>{repairForm.id ? 'עריכת' : 'הוספת'} תיקון</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {!selectedRepairType && !repairForm.id && (
              <div>
                <Label>סוג תיקון (אופציונלי)</Label>
                <Popover open={searchOpen} onOpenChange={setSearchOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className="w-full justify-between"
                    >
                      {selectedRepairType ? selectedRepairType.name : "בחר סוג תיקון או השאר ריק..."}
                      <ChevronsUpDown className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-full p-0" dir="rtl">
                    <Command shouldFilter={false}>
                      <CommandInput 
                        placeholder="חפש סוג תיקון..." 
                        value={searchValue}
                        onValueChange={setSearchValue}
                      />
                      {filteredTypes.length === 0 ? (
                        <CommandEmpty>
                          <p className="text-sm text-gray-500 py-4">לא נמצא סוג תיקון</p>
                        </CommandEmpty>
                      ) : (
                        <CommandGroup>
                          {filteredTypes.map(type => (
                            <CommandItem
                              key={type.id}
                              value={type.name}
                              onSelect={() => {
                                setSelectedRepairType(type);
                                setSearchOpen(false);
                                setSearchValue('');
                              }}
                            >
                              <Check
                                className={`ml-2 h-4 w-4 ${
                                  selectedRepairType?.id === type.id ? 'opacity-100' : 'opacity-0'
                                }`}
                              />
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
              <Input 
                value={repairForm.title} 
                onChange={e => setRepairForm(f => ({ ...f, title: e.target.value }))}
                placeholder="למשל: פחחות אחרי תאונה, החלפת מראה"
                required 
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>תאריך האירוע *</Label>
                <DateInput
                  value={repairForm.occurred_at}
                  onChange={e => setRepairForm(f => ({ ...f, occurred_at: e.target.value }))}
                  required
                />
              </div>
              <div>
                <Label>תאריך תיקון (אופציונלי)</Label>
                <DateInput
                  value={repairForm.repaired_at}
                  onChange={e => setRepairForm(f => ({ ...f, repaired_at: e.target.value }))}
                />
              </div>
            </div>

            <div>
              <Label>תיאור</Label>
              <Textarea 
                value={repairForm.description} 
                onChange={e => setRepairForm(f => ({ ...f, description: e.target.value }))}
                placeholder="מה קרה? מה תוקן?"
                className="min-h-[100px]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>בוצע על ידי</Label>
                <Select value={repairForm.repaired_by} onValueChange={v => setRepairForm(f => ({ ...f, repaired_by: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="אני">אני</SelectItem>
                    <SelectItem value="מוסך">מוסך</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>שם מוסך (אופציונלי)</Label>
                <Input 
                  value={repairForm.garage_name} 
                  onChange={e => setRepairForm(f => ({ ...f, garage_name: e.target.value }))}
                />
              </div>
            </div>

            <div>
              <Label>עלות (אופציונלי)</Label>
              <Input 
                type="number" 
                value={repairForm.cost} 
                onChange={e => setRepairForm(f => ({ ...f, cost: e.target.value }))}
                placeholder="₪"
              />
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
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={() => setUploadingFiles(prev => prev.filter((_, i) => i !== idx))}
                        >
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
              <Switch
                checked={repairForm.is_accident}
                onCheckedChange={v => setRepairForm(f => ({ ...f, is_accident: v }))}
              />
            </div>

            {repairForm.is_accident && (
              <div className="space-y-3 border-t pt-4">
                <h4 className="font-semibold text-sm text-gray-900">פרטי תאונה</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>שם הנהג השני</Label>
                    <Input 
                      value={repairForm.accident_details?.other_driver_name || ''} 
                      onChange={e => setRepairForm(f => ({ 
                        ...f, 
                        accident_details: { ...f.accident_details, other_driver_name: e.target.value }
                      }))}
                    />
                  </div>
                  <div>
                    <Label>טלפון</Label>
                    <Input 
                      value={repairForm.accident_details?.other_driver_phone || ''} 
                      onChange={e => setRepairForm(f => ({ 
                        ...f, 
                        accident_details: { ...f.accident_details, other_driver_phone: e.target.value }
                      }))}
                    />
                  </div>
                </div>
                <div>
                  <Label>מספר רישוי של הנהג השני</Label>
                  <Input 
                    value={repairForm.accident_details?.other_driver_license_plate || ''} 
                    onChange={e => setRepairForm(f => ({ 
                      ...f, 
                      accident_details: { ...f.accident_details, other_driver_license_plate: e.target.value }
                    }))}
                  />
                </div>
                <div>
                  <Label>מספר תביעה ביטוחית</Label>
                  <Input 
                    value={repairForm.accident_details?.insurance_claim_number || ''} 
                    onChange={e => setRepairForm(f => ({ 
                      ...f, 
                      accident_details: { ...f.accident_details, insurance_claim_number: e.target.value }
                    }))}
                  />
                </div>
                <div>
                  <Label>הערות נוספות</Label>
                  <Textarea 
                    value={repairForm.accident_details?.notes || ''} 
                    onChange={e => setRepairForm(f => ({ 
                      ...f, 
                      accident_details: { ...f.accident_details, notes: e.target.value }
                    }))}
                    className="min-h-[60px]"
                  />
                </div>
              </div>
            )}

            <Button 
              onClick={handleSaveRepair} 
              disabled={saving} 
              className="w-full bg-red-600 hover:bg-red-700 text-white h-11"
            >
              {saving ? 'שומר...' : repairForm.id ? 'עדכן תיקון' : 'שמור תיקון'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}