import { toast } from 'sonner';
import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/shared/GuestContext';
import { getTheme } from '@/lib/designTokens';
import { isVessel, isOffroad } from '../shared/DateStatusUtils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateInput } from '@/components/ui/date-input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { formatDateHe } from '../shared/DateStatusUtils';
import { Plus, Check, ChevronDown, ChevronUp, Trash2, AlertCircle, Calendar } from 'lucide-react';

//  Category chips per vehicle type 
const CATEGORIES = {
  vessel: ['גוף', 'מנוע', 'חשמל', 'אינסטלציה', 'בטיחות', 'מפרשים'],
  car: ['מנוע', 'בלמים', 'צמיגים', 'חשמל', 'מרכב', 'פנים'],
  motorcycle: ['מנוע', 'שלדה', 'חשמל', 'צמיגים'],
  offroad: ['מנוע', 'שלדה', 'גלגלים', 'ציוד'],
};

const PRIORITY_CONFIG = {
  urgent: { color: '#DC2626', bg: '#FEF2F2', label: 'דחוף' },
  high:   { color: '#D97706', bg: '#FFF8E1', label: 'גבוה' },
  medium: { color: '#2563EB', bg: '#EFF6FF', label: 'בינוני' },
  low:    { color: '#6B7280', bg: '#F3F4F6', label: 'נמוך' },
};

const CARD_COLORS = [
  { key: 'yellow', bg: '#FFF9C4', border: '#F9E547' },
  { key: 'pink',   bg: '#FCE4EC', border: '#F48FB1' },
  { key: 'blue',   bg: '#E3F2FD', border: '#90CAF9' },
  { key: 'green',  bg: '#E8F5E9', border: '#A5D6A7' },
  { key: 'orange', bg: '#FFF3E0', border: '#FFB74D' },
];

function getVehicleCategories(vehicleType, nickname) {
  if (isVessel(vehicleType, nickname)) return CATEGORIES.vessel;
  if (isOffroad(vehicleType)) return CATEGORIES.offroad;
  if (['אופנוע כביש', 'קטנוע'].includes(vehicleType)) return CATEGORIES.motorcycle;
  return CATEGORIES.car;
}

//  Task Card 
function TaskCard({ task, T, onToggle, onDelete }) {
  const isDone = task.is_done;
  const isOverdue = task.due_date && !isDone && new Date(task.due_date) < new Date();
  const color = CARD_COLORS.find(c => c.key === task.color) || CARD_COLORS[0];
  const priority = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.medium;

  return (
    <div className="rounded-xl p-3.5 relative transition-all"
      style={{
        background: isDone ? '#F9FAFB' : color.bg,
        border: `1.5px solid ${isDone ? '#E5E7EB' : color.border}`,
        opacity: isDone ? 0.6 : 1,
      }} dir="rtl">
      <div className="flex items-start gap-2.5">
        {/* Checkbox */}
        <button onClick={() => onToggle(task.id, !isDone)}
          className="w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all"
          style={{ borderColor: isDone ? '#10B981' : '#D1D5DB', background: isDone ? '#10B981' : 'transparent' }}>
          {isDone && <Check className="w-3 h-3 text-white" />}
        </button>

        <div className="flex-1 min-w-0">
          {/* Title + priority */}
          <div className="flex items-center gap-1.5 mb-1">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: priority.color }} />
            <p className={`text-sm font-bold truncate ${isDone ? 'line-through' : ''}`}
              style={{ color: isDone ? '#9CA3AF' : '#1C2E20' }}>
              {task.title}
            </p>
          </div>

          {/* Category + due date */}
          <div className="flex items-center gap-2 flex-wrap">
            {task.category && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background: T.light, color: T.primary }}>
                {task.category}
              </span>
            )}
            {task.due_date && (
              <span className="text-[10px] font-bold flex items-center gap-0.5"
                style={{ color: isOverdue ? '#DC2626' : '#9CA3AF' }}>
                <Calendar className="w-2.5 h-2.5" />
                {formatDateHe(task.due_date)}
                {isOverdue && ' ⚠️'}
              </span>
            )}
          </div>

          {/* Content */}
          {task.content && !isDone && (
            <p className="text-xs mt-1 leading-relaxed" style={{ color: '#6B7280' }}>
              {task.content}
            </p>
          )}
        </div>

        {/* Delete */}
        <button onClick={() => onDelete(task.id)}
          className="w-5 h-5 rounded flex items-center justify-center shrink-0 hover:bg-red-50 transition-all">
          <Trash2 className="w-3 h-3" style={{ color: '#DC2626' }} />
        </button>
      </div>
    </div>
  );
}

//  Main Component 
export default function TasksSection({ vehicle }) {
  const T = getTheme(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);
  const { isGuest, guestCorkNotes, addGuestCorkNote, updateGuestCorkNote, removeGuestCorkNote } = useAuth();
  const queryClient = useQueryClient();
  const categories = getVehicleCategories(vehicle.vehicle_type, vehicle.nickname);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [form, setForm] = useState({ title: '', content: '', category: '', priority: 'medium', color: 'yellow', due_date: '' });

  // Fetch tasks from cork_notes table (reuse existing table)
  const { data: dbTasks = [] } = useQuery({
    queryKey: ['tasks-v2', vehicle.id],
    queryFn: async () => {
      try {
        const { supabase } = await import('@/lib/supabase');
        const { data } = await supabase.from('cork_notes').select('*').eq('vehicle_id', vehicle.id).order('created_date', { ascending: false });
        return data || [];
      } catch { return []; }
    },
    enabled: !isGuest && !!vehicle.id,
  });

  const guestTasks = isGuest ? (guestCorkNotes || []).filter(n => n.vehicle_id === vehicle.id) : [];
  const allTasks = isGuest ? guestTasks : dbTasks;
  const openTasks = allTasks.filter(t => !t.is_done);
  const doneTasks = allTasks.filter(t => t.is_done);

  const openDialog = () => {
    setForm({ title: '', content: '', category: '', priority: 'medium', color: 'yellow', due_date: '' });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) { toast.error('יש להזין כותרת'); return; }
    // cork_notes table only has: vehicle_id, title, content, color, due_date, is_done, rotation
    // category and priority are kept in-memory / guest mode only (not DB columns yet)
    const dbTask = {
      vehicle_id: vehicle.id,
      title: form.title.trim(),
      content: form.content.trim() || null,
      color: form.color,
      due_date: form.due_date || null,
      is_done: false,
    };
    const task = {
      ...dbTask,
      category: form.category || null,
      priority: form.priority,
    };
    if (isGuest) {
      addGuestCorkNote({ ...task, id: `task_${Date.now()}`, created_date: new Date().toISOString() });
    } else {
      try {
        const { supabase } = await import('@/lib/supabase');
        await supabase.from('cork_notes').insert(dbTask);
        queryClient.invalidateQueries({ queryKey: ['tasks-v2', vehicle.id] });
        const { notifyVehicleChange } = await import('@/lib/notifyVehicleChange');
        notifyVehicleChange(vehicle.id, 'task_added', `נוספה משימה: ${dbTask.title}`);
      } catch (err) { toast.error('שגיאה: ' + (err?.message || 'נסה שוב')); return; }
    }
    setDialogOpen(false);
  };

  const toggleDone = async (id, done) => {
    if (isGuest) {
      updateGuestCorkNote(id, { is_done: done });
    } else {
      try {
        const { supabase } = await import('@/lib/supabase');
        await supabase.from('cork_notes').update({ is_done: done }).eq('id', id);
        queryClient.invalidateQueries({ queryKey: ['tasks-v2', vehicle.id] });
        const { notifyVehicleChange } = await import('@/lib/notifyVehicleChange');
        notifyVehicleChange(vehicle.id, done ? 'task_completed' : 'task_reopened',
          done ? 'משימה סומנה כבוצעה' : 'משימה נפתחה מחדש');
      } catch {}
    }
  };

  const deleteTask = async (id) => {
    if (isGuest) {
      removeGuestCorkNote(id);
    } else {
      try {
        const { supabase } = await import('@/lib/supabase');
        await supabase.from('cork_notes').delete().eq('id', id);
        queryClient.invalidateQueries({ queryKey: ['tasks-v2', vehicle.id] });
      } catch {}
    }
  };

  return (
    <>
      <div className="rounded-2xl overflow-hidden" style={{ background: '#fff', border: `1.5px solid ${T.border}` }} dir="rtl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3" style={{ background: T.light }}>
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4" style={{ color: T.primary }} />
            <span className="text-sm font-black" style={{ color: T.text }}>משימות ותקלות</span>
            {openTasks.length > 0 && (
              <span className="text-xs font-bold px-1.5 py-0.5 rounded-full" style={{ background: T.primary, color: '#fff' }}>
                {openTasks.length}
              </span>
            )}
          </div>
          <button onClick={openDialog}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-[0.95]"
            style={{ background: T.primary, color: '#fff' }}>
            חדש <Plus className="w-3 h-3" />
          </button>
        </div>

        {/* Open tasks */}
        {openTasks.length === 0 && doneTasks.length === 0 ? (
          <div className="py-6 text-center px-4">
            <div className="w-12 h-12 rounded-2xl mx-auto mb-2 flex items-center justify-center" style={{ background: T.light }}>
              <Check className="w-6 h-6" style={{ color: T.primary, opacity: 0.4 }} />
            </div>
            <p className="text-sm font-bold mb-1" style={{ color: T.text }}>אין משימות פתוחות</p>
            <p className="text-xs mb-3" style={{ color: T.muted }}>הוסף תקלות או משימות לטיפול</p>
            <button onClick={openDialog}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition-all active:scale-[0.95]"
              style={{ background: T.primary, color: '#fff' }}>
              הוסף משימה <Plus className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="p-3 space-y-2">
            {openTasks.map(task => (
              <TaskCard key={task.id} task={task} T={T} onToggle={toggleDone} onDelete={deleteTask} />
            ))}
          </div>
        )}

        {/* Done tasks - collapsed */}
        {doneTasks.length > 0 && (
          <>
            <button onClick={() => setShowDone(o => !o)}
              className="w-full flex items-center justify-between px-4 py-2 text-xs font-bold transition-all hover:bg-gray-50"
              style={{ color: T.muted, borderTop: `1px solid ${T.border}40` }}>
              <span>הושלמו ({doneTasks.length})</span>
              {showDone ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {showDone && (
              <div className="p-3 pt-0 space-y-2">
                {doneTasks.map(task => (
                  <TaskCard key={task.id} task={task} T={T} onToggle={toggleDone} onDelete={deleteTask} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Add Task Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-right">משימה חדשה</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            {/* Title */}
            <div>
              <Label>כותרת *</Label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="למשל: ניקוי תחתית, החלפת אנודות..." />
            </div>

            {/* Category chips */}
            <div>
              <Label className="mb-1.5 block">קטגוריה</Label>
              <div className="flex flex-wrap gap-1.5">
                {categories.map(cat => (
                  <button key={cat} type="button"
                    onClick={() => setForm(f => ({ ...f, category: f.category === cat ? '' : cat }))}
                    className="px-2.5 py-1 rounded-full text-xs font-medium border transition-all active:scale-[0.95]"
                    style={{
                      background: form.category === cat ? T.light : '#fff',
                      borderColor: form.category === cat ? T.primary : '#E5E7EB',
                      color: form.category === cat ? T.primary : '#6B7280',
                    }}>
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Priority + Color row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1.5 block">עדיפות</Label>
                <div className="flex gap-1.5">
                  {Object.entries(PRIORITY_CONFIG).map(([key, cfg]) => (
                    <button key={key} type="button"
                      onClick={() => setForm(f => ({ ...f, priority: key }))}
                      className="flex-1 py-1.5 rounded-lg text-[10px] font-bold text-center transition-all border"
                      style={{
                        background: form.priority === key ? cfg.bg : '#fff',
                        borderColor: form.priority === key ? cfg.color : '#E5E7EB',
                        color: cfg.color,
                      }}>
                      {cfg.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label className="mb-1.5 block">צבע</Label>
                <div className="flex gap-1.5">
                  {CARD_COLORS.map(c => (
                    <button key={c.key} type="button"
                      onClick={() => setForm(f => ({ ...f, color: c.key }))}
                      className="w-7 h-7 rounded-lg border-2 transition-all"
                      style={{
                        background: c.bg,
                        borderColor: form.color === c.key ? c.border : 'transparent',
                        boxShadow: form.color === c.key ? `0 0 0 2px ${c.border}` : 'none',
                      }} />
                  ))}
                </div>
              </div>
            </div>

            {/* Due date */}
            <div>
              <Label>תאריך יעד</Label>
              <DateInput value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
            </div>

            {/* Notes */}
            <div>
              <Label>פירוט</Label>
              <Textarea value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                placeholder="פרטים נוספים..." rows={2} />
            </div>

            <Button onClick={handleSave} className="w-full h-11 rounded-2xl font-bold"
              style={{ background: T.primary, color: '#fff' }}>
              הוסף משימה
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
