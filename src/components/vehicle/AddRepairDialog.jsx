import { toast } from 'sonner';
import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { db } from '@/lib/supabaseEntities';
import { validateUploadFile } from '@/lib/securityUtils';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2, X, Upload, Plus } from "lucide-react";
import FileOrCameraUpload from "@/components/ui/file-or-camera-upload";

export default function AddRepairDialog({ open, onClose, vehicle, repair }) {
  const queryClient = useQueryClient();
  const [currentUser, setCurrentUser] = useState(null);
  const [uploading, setUploading] = useState(false);

  const [form, setForm] = useState({
    repair_type_id: '',
    title: '',
    occurred_at: '',
    repaired_at: '',
    description: '',
    repaired_by: '',
    garage_name: '',
    cost: '',
    is_accident: false,
  });

  const [accidentDetails, setAccidentDetails] = useState({
    other_driver_name: '',
    other_driver_phone: '',
    other_driver_license_plate: '',
    insurance_claim_number: '',
    notes: '',
  });

  const [attachments, setAttachments] = useState([]);
  const [newRepairType, setNewRepairType] = useState('');
  const [showNewTypeInput, setShowNewTypeInput] = useState(false);

  useEffect(() => {
    async function loadUser() {
      const user = await base44.auth.me();
      setCurrentUser(user);
    }
    loadUser();
  }, []);

  useEffect(() => {
    if (repair) {
      setForm({
        repair_type_id: repair.repair_type_id || '',
        title: repair.title || '',
        occurred_at: repair.occurred_at || '',
        repaired_at: repair.repaired_at || '',
        description: repair.description || '',
        repaired_by: repair.repaired_by || '',
        garage_name: repair.garage_name || '',
        cost: repair.cost || '',
        is_accident: repair.is_accident || false,
      });
      
      // Load existing attachments and accident details
      if (repair.id) {
        Promise.all([
          base44.entities.RepairAttachment.filter({ repair_log_id: repair.id }),
          base44.entities.AccidentDetails.filter({ repair_log_id: repair.id }),
        ]).then(([atts, accidents]) => {
          setAttachments(atts.map(a => ({ id: a.id, file_url: a.file_url, file_type: a.file_type })));
          if (accidents.length > 0) {
            setAccidentDetails({
              other_driver_name: accidents[0].other_driver_name || '',
              other_driver_phone: accidents[0].other_driver_phone || '',
              other_driver_license_plate: accidents[0].other_driver_license_plate || '',
              insurance_claim_number: accidents[0].insurance_claim_number || '',
              notes: accidents[0].notes || '',
            });
          }
        });
      }
    } else {
      setForm({
        repair_type_id: '',
        title: '',
        occurred_at: '',
        repaired_at: '',
        description: '',
        repaired_by: '',
        garage_name: '',
        cost: '',
        is_accident: false,
      });
      setAccidentDetails({
        other_driver_name: '',
        other_driver_phone: '',
        other_driver_license_plate: '',
        insurance_claim_number: '',
        notes: '',
      });
      setAttachments([]);
    }
  }, [repair]);

  // Repair types live in the Supabase repair_types table (owned per-user,
  // RLS scoped to the current user) so this list stays in sync with what
  // the user sees/edits at /MaintenanceTemplates → תיקונים tab.
  const { data: repairTypes = [] } = useQuery({
    queryKey: ['repair-types', currentUser?.id],
    queryFn: () => db.repair_types.filter({ user_id: currentUser.id }),
    enabled: !!currentUser?.id,
  });

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      let repairLog;
      if (repair?.id) {
        await base44.entities.RepairLog.update(repair.id, data.repairData);
        repairLog = { ...repair, ...data.repairData };
      } else {
        repairLog = await base44.entities.RepairLog.create(data.repairData);
      }

      // Save attachments
      const existingAttachmentIds = attachments.filter(a => a.id).map(a => a.id);
      const currentAttachments = repair?.id ? 
        await base44.entities.RepairAttachment.filter({ repair_log_id: repair.id }) : [];
      
      // Delete removed attachments
      for (const att of currentAttachments) {
        if (!existingAttachmentIds.includes(att.id)) {
          await base44.entities.RepairAttachment.delete(att.id);
        }
      }

      // Add new attachments
      for (const att of attachments) {
        if (!att.id) {
          await base44.entities.RepairAttachment.create({
            repair_log_id: repairLog.id,
            file_url: att.file_url,
            file_type: att.file_type,
          });
        }
      }

      // Save accident details
      if (data.repairData.is_accident) {
        const existingAccidents = repair?.id ? 
          await base44.entities.AccidentDetails.filter({ repair_log_id: repair.id }) : [];
        
        if (existingAccidents.length > 0) {
          await base44.entities.AccidentDetails.update(existingAccidents[0].id, {
            ...accidentDetails,
            repair_log_id: repairLog.id,
          });
        } else {
          await base44.entities.AccidentDetails.create({
            ...accidentDetails,
            repair_log_id: repairLog.id,
          });
        }
      } else if (repair?.id) {
        // Delete accident details if unchecked
        const existingAccidents = await base44.entities.AccidentDetails.filter({ repair_log_id: repair.id });
        for (const acc of existingAccidents) {
          await base44.entities.AccidentDetails.delete(acc.id);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repairLogs'] });
      onClose();
    },
  });

  // Creates a user-owned repair type in Supabase. Same table the
  // /MaintenanceTemplates → תיקונים tab reads from, so a type added
  // here immediately shows up there too. Duplicate names are surfaced
  // gracefully (case-insensitive UNIQUE per user).
  const createRepairTypeMutation = useMutation({
    mutationFn: async (name) => {
      return db.repair_types.create({
        user_id: currentUser.id,
        name: name.trim(),
      });
    },
    onSuccess: (newType) => {
      queryClient.invalidateQueries({ queryKey: ['repair-types', currentUser?.id] });
      setForm(prev => ({ ...prev, repair_type_id: newType.id }));
      setNewRepairType('');
      setShowNewTypeInput(false);
    },
  });

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const validation = validateUploadFile(file, 'doc', 10);
    if (!validation.ok) { alert(validation.error); e.target.value = ''; return; }
    setUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setAttachments(prev => [...prev, { file_url, file_type: 'אחר' }]);
    setUploading(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    const repairData = {
      vehicle_id: vehicle.id,
      repair_type_id: form.repair_type_id === 'other' ? null : form.repair_type_id || null,
      title: form.title,
      occurred_at: form.occurred_at,
      repaired_at: form.repaired_at || null,
      description: form.description || null,
      repaired_by: form.repaired_by || null,
      garage_name: form.garage_name || null,
      cost: form.cost ? Number(form.cost) : null,
      is_accident: form.is_accident,
      created_by_user_id: repair?.created_by_user_id || currentUser.id,
    };

    saveMutation.mutate({ repairData });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>{repair ? 'עריכת תיקון' : 'תיקון חדש'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>סוג התיקון</Label>
            {!showNewTypeInput ? (
              <div className="flex gap-2">
                <Select value={form.repair_type_id} onValueChange={(v) => setForm(prev => ({ ...prev, repair_type_id: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="בחר סוג תיקון" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="other">אחר (טקסט חופשי)</SelectItem>
                    {repairTypes.map(type => (
                      <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" size="icon" onClick={() => setShowNewTypeInput(true)}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input
                  value={newRepairType}
                  onChange={(e) => setNewRepairType(e.target.value)}
                  placeholder="שם סוג תיקון חדש"
                />
                <Button
                  type="button"
                  onClick={() => createRepairTypeMutation.mutate(newRepairType)}
                  disabled={!newRepairType || createRepairTypeMutation.isPending}
                >
                  הוסף
                </Button>
                <Button type="button" variant="ghost" onClick={() => setShowNewTypeInput(false)}>
                  ביטול
                </Button>
              </div>
            )}
          </div>

          <div>
            <Label>כותרת *</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm(prev => ({ ...prev, title: e.target.value }))}
              placeholder="למשל: פחחות דלת קדמית"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>תאריך האירוע *</Label>
              <DateInput
                value={form.occurred_at}
                onChange={(e) => setForm(prev => ({ ...prev, occurred_at: e.target.value }))}
                required
              />
            </div>
            <div>
              <Label>תאריך התיקון</Label>
              <DateInput
                value={form.repaired_at}
                onChange={(e) => setForm(prev => ({ ...prev, repaired_at: e.target.value }))}
              />
            </div>
          </div>

          <div>
            <Label>תיאור</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm(prev => ({ ...prev, description: e.target.value }))}
              placeholder="פרט מה קרה ומה תוקן..."
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>בוצע על ידי</Label>
              <Select value={form.repaired_by} onValueChange={(v) => setForm(prev => ({ ...prev, repaired_by: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="בחר" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="אני">אני</SelectItem>
                  <SelectItem value="מוסך">מוסך</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>שם המוסך</Label>
              <Input
                value={form.garage_name}
                onChange={(e) => setForm(prev => ({ ...prev, garage_name: e.target.value }))}
                placeholder="אם תוקן במוסך"
              />
            </div>
          </div>

          <div>
            <Label>עלות (₪)</Label>
            <Input
              type="number"
              value={form.cost}
              onChange={(e) => setForm(prev => ({ ...prev, cost: e.target.value }))}
              placeholder="0"
            />
          </div>

          <div className="flex items-center gap-2 border border-gray-200 rounded-lg p-3">
            <Switch
              checked={form.is_accident}
              onCheckedChange={(checked) => setForm(prev => ({ ...prev, is_accident: checked }))}
            />
            <Label>זהו אירוע תאונה</Label>
          </div>

          {form.is_accident && (
            <div className="border border-amber-200 bg-amber-50 rounded-lg p-4 space-y-3">
              <h4 className="font-semibold text-sm">פרטי תאונה</h4>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  placeholder="שם הנהג השני"
                  value={accidentDetails.other_driver_name}
                  onChange={(e) => setAccidentDetails(prev => ({ ...prev, other_driver_name: e.target.value }))}
                />
                <Input
                  placeholder="טלפון"
                  value={accidentDetails.other_driver_phone}
                  onChange={(e) => setAccidentDetails(prev => ({ ...prev, other_driver_phone: e.target.value }))}
                />
                <Input
                  placeholder="מספר רישוי"
                  value={accidentDetails.other_driver_license_plate}
                  onChange={(e) => setAccidentDetails(prev => ({ ...prev, other_driver_license_plate: e.target.value }))}
                />
                <Input
                  placeholder="מספר תביעה ביטוחית"
                  value={accidentDetails.insurance_claim_number}
                  onChange={(e) => setAccidentDetails(prev => ({ ...prev, insurance_claim_number: e.target.value }))}
                />
              </div>
              <Textarea
                placeholder="הערות נוספות"
                value={accidentDetails.notes}
                onChange={(e) => setAccidentDetails(prev => ({ ...prev, notes: e.target.value }))}
                rows={2}
              />
            </div>
          )}

          <div>
            <Label>קבצים מצורפים</Label>
            <div className="space-y-2">
              {attachments.map((att, idx) => (
                <div key={idx} className="flex items-center gap-2 border border-gray-200 rounded-lg p-2">
                  <Select
                    value={att.file_type}
                    onValueChange={(v) => {
                      const updated = [...attachments];
                      updated[idx].file_type = v;
                      setAttachments(updated);
                    }}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="חשבונית">חשבונית</SelectItem>
                      <SelectItem value="תמונה">תמונה</SelectItem>
                      <SelectItem value="מסמך ביטוח">מסמך ביטוח</SelectItem>
                      <SelectItem value="אחר">אחר</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-sm text-gray-600 flex-1 truncate">קובץ {idx + 1}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setAttachments(attachments.filter((_, i) => i !== idx))}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <FileOrCameraUpload
                accept="image/*,application/pdf"
                onChange={handleFileUpload}
                disabled={uploading}
                uploading={uploading}
                label="הוסף קובץ"
              />
            </div>
          </div>

          {/* Action row — sticky bottom so it stays above the keyboard */}
          <div className="sticky bottom-0 bg-white border-t border-gray-100 -mx-6 px-6 py-3 flex gap-2"
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)' }}>
            <Button type="submit" disabled={saveMutation.isPending} className="flex-1 bg-amber-600 hover:bg-amber-700">
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : (repair ? 'עדכן' : 'שמור')}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>ביטול</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}