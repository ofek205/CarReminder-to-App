import { toast } from 'sonner';
import React, { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { db } from '@/lib/supabaseEntities';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/shared/GuestContext';
import { getTheme, isVesselType } from '@/lib/designTokens';
import { isVessel as isVesselCheck, isOffroad } from '../shared/DateStatusUtils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Pin, Plus, Wrench, Anchor, Trash2, Check, ChevronDown, ChevronUp, Calendar } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { DEMO_CORK_NOTES, DEMO_VESSEL_CORK_NOTES, DEMO_VEHICLE_ID, DEMO_VESSEL_ID } from '@/components/shared/demoVehicleData';

// ── Note Colors ────────────────────────────────────────────────────────────
const COLORS = {
  yellow: { bg: '#FFF9C4', border: '#F9E547', pin: '#DC2626' },
  pink:   { bg: '#FCE4EC', border: '#F48FB1', pin: '#E91E63' },
  blue:   { bg: '#E3F2FD', border: '#90CAF9', pin: '#1976D2' },
  green:  { bg: '#E8F5E9', border: '#A5D6A7', pin: '#388E3C' },
  orange: { bg: '#FFF3E0', border: '#FFB74D', pin: '#E65100' },
};

// ── Categories per vehicle type ────────────────────────────────────────────
const CATEGORIES = {
  vessel: ['גוף', 'מנוע', 'חשמל', 'אינסטלציה', 'בטיחות', 'מפרשים'],
  car: ['מנוע', 'בלמים', 'צמיגים', 'חשמל', 'מרכב', 'פנים'],
  motorcycle: ['מנוע', 'שלדה', 'חשמל', 'צמיגים'],
  offroad: ['מנוע', 'שלדה', 'גלגלים', 'ציוד'],
};

const PRIORITY_CONFIG = {
  urgent: { color: '#DC2626', bg: '#FEF2F2', label: 'דחוף', dot: '#DC2626' },
  high:   { color: '#D97706', bg: '#FFF8E1', label: 'גבוה', dot: '#D97706' },
  medium: { color: '#2563EB', bg: '#EFF6FF', label: 'בינוני', dot: '#2563EB' },
  low:    { color: '#6B7280', bg: '#F3F4F6', label: 'נמוך', dot: '#6B7280' },
};

function getVehicleCategories(vehicleType, nickname) {
  if (isVesselCheck(vehicleType, nickname)) return CATEGORIES.vessel;
  if (isOffroad(vehicleType)) return CATEGORIES.offroad;
  if (['אופנוע כביש', 'קטנוע'].includes(vehicleType)) return CATEGORIES.motorcycle;
  return CATEGORIES.car;
}

// ── Pin SVG ────────────────────────────────────────────────────────────────
function PinSvg({ color = '#DC2626' }) {
  return (
    <svg width="14" height="18" viewBox="0 0 14 18" fill="none" className="mx-auto drop-shadow-sm">
      <circle cx="7" cy="5" r="4.5" fill={color} stroke="#00000030" strokeWidth="0.5"/>
      <rect x="6" y="9.5" width="2" height="7" rx="1" fill="#9CA3AF"/>
      <circle cx="7" cy="5" r="1.8" fill="white" opacity="0.35"/>
    </svg>
  );
}

// ── Sticky Note ────────────────────────────────────────────────────────────
function StickyNote({ note, T, readOnly, onEdit, constraintsRef, tidyMode = false }) {
  const colorDef = COLORS[note.color] || COLORS.yellow;
  // Tidy mode cancels the playful random rotation + drag so notes sit
  // straight in the grid, ordered by due-date priority.
  const rotation = tidyMode ? 0 : (note.rotation || 0);
  const isOverdue = note.due_date && !note.is_done && new Date(note.due_date) < new Date();
  const priority = PRIORITY_CONFIG[note.priority] || null;
  const [isDragging, setIsDragging] = useState(false);

  return (
    <motion.div
      drag={!readOnly && !tidyMode}
      dragConstraints={constraintsRef}
      dragElastic={0.1}
      dragMomentum={false}
      onDragStart={() => setIsDragging(true)}
      onDragEnd={() => setTimeout(() => setIsDragging(false), 100)}
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: note.is_done ? 0.55 : 1, rotate: rotation }}
      whileDrag={{ scale: 1.08, rotate: 0, zIndex: 50, boxShadow: '0 12px 40px rgba(0,0,0,0.25)' }}
      onClick={() => { if (!isDragging && !readOnly) onEdit(note); }}
      className={`relative select-none ${readOnly ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'}`}
      style={{ touchAction: 'none' }}
    >
      {/* Pin */}
      <div className="absolute -top-2 left-1/2 -translate-x-1/2 z-10">
        <PinSvg color={priority ? priority.dot : colorDef.pin} />
      </div>

      {/* Note body */}
      <div className="rounded-lg pt-5 pb-3 px-3 relative"
        style={{
          background: colorDef.bg,
          border: `1.5px solid ${colorDef.border}`,
          boxShadow: '0 3px 12px rgba(0,0,0,0.1), 1px 1px 0 rgba(0,0,0,0.03)',
          minHeight: '75px',
          minWidth: '100px',
        }}>
        {/* Done indicator */}
        {note.is_done && (
          <div className="absolute top-2 left-2">
            <Check className="w-3.5 h-3.5 text-green-600" />
          </div>
        )}

        {/* Priority dot */}
        {priority && !note.is_done && (
          <div className="absolute top-2 left-2">
            <span className="w-2 h-2 rounded-full block" style={{ background: priority.dot }} />
          </div>
        )}

        {/* Title */}
        <p className="font-bold text-xs text-gray-900 leading-tight mb-1 line-clamp-2" dir="rtl"
          style={{ textDecoration: note.is_done ? 'line-through' : 'none', opacity: note.is_done ? 0.5 : 1 }}>
          {note.title}
        </p>

        {/* Category chip */}
        {note.category && !note.is_done && (
          <span className="inline-block text-[8px] font-bold px-1.5 py-0.5 rounded-full mb-1"
            style={{ background: T.light, color: T.primary }}>
            {note.category}
          </span>
        )}

        {/* Content */}
        {note.content && !note.is_done && (
          <p className="text-[10px] text-gray-600 leading-snug line-clamp-2" dir="rtl"
            style={{ opacity: 0.75 }}>
            {note.content}
          </p>
        )}

        {/* Due date */}
        {note.due_date && (
          <p className="text-[9px] font-bold mt-1.5 flex items-center gap-0.5" dir="rtl"
            style={{ color: isOverdue ? '#DC2626' : '#78909C' }}>
            <Calendar className="w-2.5 h-2.5" />
            {(() => { try { return format(parseISO(note.due_date), 'dd/MM/yy'); } catch { return ''; } })()}
            {isOverdue && ' \u26a0\ufe0f'}
          </p>
        )}
      </div>
    </motion.div>
  );
}

// ── Add/Edit Dialog ────────────────────────────────────────────────────────
function NoteDialog({ open, onClose, note, onSave, onDelete, categories, T }) {
  const isEdit = !!note?.id;
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [color, setColor] = useState('yellow');
  const [dueDate, setDueDate] = useState('');
  const [isDone, setIsDone] = useState(false);
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState('medium');
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (open) {
      setTitle(note?.title || '');
      setContent(note?.content || '');
      setColor(note?.color || 'yellow');
      setDueDate(note?.due_date || '');
      setIsDone(note?.is_done || false);
      setCategory(note?.category || '');
      setPriority(note?.priority || 'medium');
    }
  }, [open, note]);

  const handleSave = async () => {
    if (!title.trim()) { toast.error('הכנס כותרת לפתק'); return; }
    setSaving(true);
    try {
      await onSave({
        ...(note || {}),
        title: title.trim(),
        content: content.trim(),
        color,
        due_date: dueDate || null,
        is_done: isDone,
        category: category || null,
        priority,
      });
    } catch (e) {
      console.error('Note save error:', e);
    }
    setSaving(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm mx-4" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-lg font-black">
            {isEdit ? 'עריכת פתק' : 'פתק חדש'} 📌
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          <Input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="כותרת..."
            className="font-bold"
            maxLength={50}
          />
          <Textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="פירוט (אופציונלי)..."
            rows={2}
            maxLength={200}
            className="text-sm resize-none"
          />

          {/* Category chips */}
          {categories.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-600 mb-1.5">קטגוריה</p>
              <div className="flex flex-wrap gap-1.5">
                {categories.map(cat => (
                  <button key={cat} type="button"
                    onClick={() => setCategory(category === cat ? '' : cat)}
                    className="px-2.5 py-1 rounded-full text-xs font-medium border transition-all active:scale-[0.95]"
                    style={{
                      background: category === cat ? T.light : '#fff',
                      borderColor: category === cat ? T.primary : '#E5E7EB',
                      color: category === cat ? T.primary : '#6B7280',
                    }}>
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Priority + Color row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-bold text-gray-600 mb-1.5">עדיפות</p>
              <div className="flex gap-1">
                {Object.entries(PRIORITY_CONFIG).map(([key, cfg]) => (
                  <button key={key} type="button"
                    onClick={() => setPriority(key)}
                    className="flex-1 py-1.5 rounded-lg text-[10px] font-bold text-center transition-all border"
                    style={{
                      background: priority === key ? cfg.bg : '#fff',
                      borderColor: priority === key ? cfg.color : '#E5E7EB',
                      color: cfg.color,
                    }}>
                    {cfg.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-bold text-gray-600 mb-1.5">צבע</p>
              <div className="flex gap-1.5">
                {Object.entries(COLORS).map(([key, c]) => (
                  <button key={key} type="button" onClick={() => setColor(key)}
                    className="w-7 h-7 rounded-lg transition-all border-2 flex items-center justify-center"
                    style={{
                      background: c.bg,
                      borderColor: color === key ? c.border : 'transparent',
                      boxShadow: color === key ? `0 0 0 2px ${c.border}` : 'none',
                    }}>
                    {color === key && <Check className="w-3 h-3" style={{ color: c.pin }} />}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Due date */}
          <div>
            <p className="text-xs font-bold text-gray-600 mb-1.5">תאריך יעד (אופציונלי)</p>
            <Input
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              className="text-sm"
              dir="ltr"
            />
          </div>

          {/* Done toggle (edit only) */}
          {isEdit && (
            <button type="button" onClick={() => setIsDone(!isDone)}
              className="flex items-center gap-2.5 w-full p-3 rounded-xl transition-all"
              style={{ background: isDone ? '#E8F5E9' : '#F9FAFB', border: `1.5px solid ${isDone ? '#4CAF50' : '#E5E7EB'}` }}>
              <div className="w-5 h-5 rounded-md border-2 flex items-center justify-center"
                style={{ borderColor: isDone ? '#4CAF50' : '#D1D5DB', background: isDone ? '#4CAF50' : 'white' }}>
                {isDone && <Check className="w-3 h-3 text-white" />}
              </div>
              <span className="text-sm font-bold" style={{ color: isDone ? '#2E7D32' : '#6B7280' }}>
                {isDone ? 'בוצע! \u2713' : 'סמן כבוצע'}
              </span>
            </button>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <Button onClick={handleSave} disabled={saving || !title.trim()}
              className="flex-1 h-11 rounded-xl font-bold text-sm"
              style={{ background: T.primary, color: 'white' }}>
              {saving ? '...' : isEdit ? 'שמור שינויים' : '\ud83d\udccc הצמד פתק'}
            </Button>
            {isEdit && onDelete && (
              <Button onClick={() => { onDelete(note.id); onClose(); }} variant="outline"
                className="h-11 rounded-xl text-red-500 border-red-200 hover:bg-red-50 px-3">
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main CorkBoard Component ───────────────────────────────────────────────
export default function CorkBoard({ vehicle, isGuest = false, readOnly = false }) {
  const { user, guestCorkNotes, addGuestCorkNote, updateGuestCorkNote, removeGuestCorkNote } = useAuth();
  const queryClient = useQueryClient();
  const boardRef = useRef(null);
  const T = getTheme(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);
  const isVessel = isVesselType(vehicle.vehicle_type, vehicle.nickname);
  const ThemeIcon = isVessel ? Anchor : Wrench;
  const categories = getVehicleCategories(vehicle.vehicle_type, vehicle.nickname);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingNote, setEditingNote] = useState(null);
  const [showDone, setShowDone] = useState(false);
  // Tidy mode: sort by due-date, straighten rotations, disable drag.
  // User toggles this via the "סדר אוטומטי" button in the header.
  const [tidyMode, setTidyMode] = useState(false);

  // ── Data ──
  const { data: authNotes = [] } = useQuery({
    queryKey: ['cork-notes', vehicle.id],
    queryFn: () => db.cork_notes.filter({ vehicle_id: vehicle.id }),
    enabled: !isGuest && !!vehicle.id,
  });

  // Demo notes for demo vehicles
  const demoNotes = vehicle.id === DEMO_VEHICLE_ID ? DEMO_CORK_NOTES
    : vehicle.id === DEMO_VESSEL_ID ? DEMO_VESSEL_CORK_NOTES
    : [];

  const guestNotesForVehicle = (guestCorkNotes || []).filter(n => n.vehicle_id === vehicle.id);
  const allNotes = isGuest
    ? (guestNotesForVehicle.length > 0 ? guestNotesForVehicle : demoNotes)
    : authNotes;

  // When tidy mode is on, sort open notes: overdue first, then nearest
  // due-date, then high-priority items, then the rest by creation order.
  const sortForTidy = (notes) => {
    if (!tidyMode) return notes;
    const priorityRank = { high: 0, medium: 1, low: 2 };
    return [...notes].sort((a, b) => {
      const aDate = a.due_date ? new Date(a.due_date).getTime() : Infinity;
      const bDate = b.due_date ? new Date(b.due_date).getTime() : Infinity;
      if (aDate !== bDate) return aDate - bDate;
      const aPri = priorityRank[a.priority] ?? 99;
      const bPri = priorityRank[b.priority] ?? 99;
      if (aPri !== bPri) return aPri - bPri;
      return new Date(a.created_date || 0) - new Date(b.created_date || 0);
    });
  };

  const openNotes = sortForTidy(allNotes.filter(n => !n.is_done));
  const doneNotes = allNotes.filter(n => n.is_done);

  const randomRotation = () => Math.round((Math.random() - 0.5) * 6);

  // ── CRUD ──
  const handleSave = async (noteData) => {
    // DB columns: vehicle_id, title, content, color, due_date, is_done, rotation
    // category + priority don't exist in DB yet - stored in guest/localStorage only
    const dbFields = {
      title: noteData.title, content: noteData.content,
      color: noteData.color, due_date: noteData.due_date, is_done: noteData.is_done,
    };

    if (isGuest) {
      if (noteData.id) {
        updateGuestCorkNote(noteData.id, noteData);
      } else {
        addGuestCorkNote({
          ...noteData,
          vehicle_id: vehicle.id,
          rotation: randomRotation(),
        });
      }
    } else {
      try {
        if (noteData.id) {
          await db.cork_notes.update(noteData.id, dbFields);
        } else {
          await db.cork_notes.create({
            vehicle_id: vehicle.id,
            ...dbFields,
            rotation: randomRotation(),
          });
        }
        queryClient.invalidateQueries({ queryKey: ['cork-notes', vehicle.id] });
      } catch (e) {
        toast.error('שגיאה בשמירת הפתק');
        console.error(e);
      }
    }
  };

  const handleDelete = async (noteId) => {
    if (isGuest) {
      removeGuestCorkNote(noteId);
    } else {
      try {
        await db.cork_notes.delete(noteId);
        queryClient.invalidateQueries({ queryKey: ['cork-notes', vehicle.id] });
      } catch {
        toast.error('שגיאה במחיקה');
      }
    }
  };

  const openAdd = () => { setEditingNote(null); setDialogOpen(true); };
  const openEdit = (note) => { setEditingNote(note); setDialogOpen(true); };
  const canAdd = !readOnly && allNotes.length < 20;

  return (
    <div className="rounded-3xl overflow-hidden" style={{ border: `1.5px solid ${T.border}` }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3" style={{ background: T.light }}>
        <div className="flex items-center gap-2" dir="rtl">
          <Pin className="w-4 h-4" style={{ color: T.primary }} />
          <div>
            <h3 className="font-bold text-base leading-tight" style={{ color: T.text }}>לוח פתקים</h3>
            <p className="text-[10px] font-medium" style={{ color: T.muted }}>תקלות, משימות ותזכורות לטיפול</p>
          </div>
          {openNotes.length > 0 && (
            <span className="text-xs font-bold px-2 py-0.5 rounded-full"
              style={{ background: T.primary, color: '#fff' }}>
              {openNotes.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {allNotes.length > 1 && (
            <Button onClick={() => setTidyMode(t => !t)} size="sm"
              className="h-8 rounded-xl font-bold text-xs gap-1"
              style={tidyMode
                ? { background: T.primary, color: 'white' }
                : { background: '#fff', color: T.primary, border: `1px solid ${T.border}` }}
              title={tidyMode ? 'חזור למצב חופשי' : 'סדר לפי תאריך יעד'}>
              {tidyMode ? '✓ מסודר' : '↕ סדר אוטומטי'}
            </Button>
          )}
          {canAdd && (
            <Button onClick={openAdd} size="sm" className="h-8 rounded-xl font-bold text-xs gap-1"
              style={{ background: T.primary, color: 'white' }}>
              <Plus className="w-3.5 h-3.5" /> חדש
            </Button>
          )}
        </div>
      </div>

      {/* Cork board surface - open notes */}
      <div ref={boardRef} className="relative p-4" dir="rtl"
        style={{
          minHeight: openNotes.length === 0 && doneNotes.length === 0 ? '200px' : '120px',
          background: `
            radial-gradient(ellipse at 20% 50%, #C4956A 0%, transparent 50%),
            radial-gradient(ellipse at 80% 30%, #D4A574 0%, transparent 50%),
            radial-gradient(ellipse at 50% 80%, #B8860B 0%, transparent 50%),
            linear-gradient(135deg, #C09060 0%, #B8860B 35%, #C4956A 65%, #D4A574 100%)
          `,
        }}>
        {/* Cork grain texture */}
        <div className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `
              radial-gradient(circle at 25% 25%, rgba(255,255,255,0.06) 1px, transparent 1px),
              radial-gradient(circle at 75% 75%, rgba(0,0,0,0.04) 1px, transparent 1px)
            `,
            backgroundSize: '18px 18px, 14px 14px',
          }} />

        {/* Theme decoration */}
        <div className="absolute top-3 left-3 pointer-events-none" style={{ opacity: 0.1 }}>
          <ThemeIcon className="w-14 h-14 text-white" />
        </div>

        {/* Notes grid - open only */}
        {openNotes.length === 0 && doneNotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3 relative z-10">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,0.25)' }}>
              <Pin className="w-7 h-7" style={{ color: 'rgba(255,255,255,0.8)' }} />
            </div>
            <p className="text-sm font-bold" style={{ color: 'rgba(255,255,255,0.85)' }}>
              {readOnly ? 'אין פתקים עדיין' : 'הצמד את הפתק הראשון!'}
            </p>
            {canAdd && (
              <Button onClick={openAdd} size="sm"
                className="rounded-xl font-bold gap-1.5 mt-1"
                style={{ background: 'rgba(255,255,255,0.3)', color: 'white', border: '1px solid rgba(255,255,255,0.4)' }}>
                <Plus className="w-4 h-4" /> פתק חדש
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 relative z-10">
            {openNotes.map(note => (
              <StickyNote
                key={note.id}
                note={note}
                T={T}
                readOnly={readOnly}
                onEdit={openEdit}
                constraintsRef={boardRef}
                tidyMode={tidyMode}
              />
            ))}

            {/* Add button as last grid item */}
            {canAdd && (
              <motion.button
                onClick={openAdd}
                whileTap={{ scale: 0.95 }}
                className="rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-2 py-6 transition-all"
                style={{
                  borderColor: 'rgba(255,255,255,0.4)',
                  background: 'rgba(255,255,255,0.1)',
                  minHeight: '75px',
                }}>
                <Plus className="w-5 h-5" style={{ color: 'rgba(255,255,255,0.7)' }} />
                <span className="text-xs font-bold" style={{ color: 'rgba(255,255,255,0.7)' }}>פתק חדש</span>
              </motion.button>
            )}
          </div>
        )}
      </div>

      {/* Done notes - collapsed section */}
      {doneNotes.length > 0 && (
        <>
          <button onClick={() => setShowDone(o => !o)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-bold transition-all hover:bg-gray-50"
            style={{ color: T.muted, background: '#fff', borderTop: `1px solid ${T.border}40` }}
            dir="rtl">
            <span>הושלמו ({doneNotes.length})</span>
            {showDone ? <ChevronUp className="w-4 h-4" style={{ color: T.primary }} /> : <ChevronDown className="w-4 h-4" style={{ color: T.primary }} />}
          </button>
          {showDone && (
            <div className="p-3 grid grid-cols-2 sm:grid-cols-3 gap-3" dir="rtl"
              style={{ background: '#F9FAFB', borderTop: `1px solid ${T.border}20` }}>
              {doneNotes.map(note => (
                <StickyNote
                  key={note.id}
                  note={note}
                  T={T}
                  readOnly={readOnly}
                  onEdit={openEdit}
                  constraintsRef={boardRef}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Dialog */}
      <NoteDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditingNote(null); }}
        note={editingNote}
        onSave={handleSave}
        onDelete={handleDelete}
        categories={categories}
        T={T}
      />
    </div>
  );
}
