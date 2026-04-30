/**
 * ChecklistEditor. dedicated page for editing the TEMPLATE of one phase.
 *
 * URL: /ChecklistEditor?vehicleId=<uuid>&phase=engine|pre|post
 *
 * Product rules (from latest planning pass):
 *   • Entering this page = editing. There is no read-only mode. the
 *     landing Hub is where people "view" the template via phase cards.
 *   • Items and sections are reorder-able via drag handles. A long press
 *     on the grip icon activates drag; on desktop, click-hold works too.
 *   • Items are numbered (1., 2., 3.) within each section to help the
 *     user keep track during real-world execution.
 *   • All changes are live (auto-saved on every mutation). No save button.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { createPageUrl } from '@/utils';
import { db } from '@/lib/supabaseEntities';
import { PHASE_LABELS, getDefaultSections } from '@/lib/checklistTemplates';
import {
  ArrowRight, Plus, Trash2, Pencil, Check, X, FolderPlus, Download, Anchor, GripVertical,
} from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

import {
  DndContext, closestCenter, PointerSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, useSortable, verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const THEME = {
  primary: '#0C7B93',
  grad:    'linear-gradient(135deg, #065A6E 0%, #0C7B93 100%)',
  tint:    '#E0F7FA',
};

function uid() { return `i_${Math.random().toString(36).slice(2, 10)}`; }

function normalizeTemplate(raw) {
  if (!raw) return { sections: [] };
  if (raw.sections && Array.isArray(raw.sections)) {
    return {
      sections: raw.sections.map(s => ({
        id: s.id || uid(),
        name: s.name || 'ללא שם',
        items: (s.items || []).map(it => ({ id: it.id || uid(), text: it.text || '' })),
      })),
    };
  }
  if (Array.isArray(raw)) {
    return {
      sections: raw.length
        ? [{ id: uid(), name: 'כללי', items: raw.map(it => ({ id: uid(), text: it.text || '' })) }]
        : [],
    };
  }
  return { sections: [] };
}

/* -------------------------------------------------------------------------- */

export default function ChecklistEditor() {
  const [params] = useSearchParams();
  const vehicleId = params.get('vehicleId');
  const templateIdParam = params.get('templateId');
  const phaseParam = params.get('phase');
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [data, setData] = useState(null);
  const [row, setRow] = useState(null);
  const [vehicle, setVehicle] = useState(null);
  const [bootError, setBootError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteSection, setConfirmDeleteSection] = useState(null);
  const [newSectionOpen, setNewSectionOpen] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');
  const [editingTemplateName, setEditingTemplateName] = useState(false);
  const [templateNameBuf, setTemplateNameBuf] = useState('');

  useEffect(() => {
    if (!vehicleId || (!phaseParam && !templateIdParam)) return;
    (async () => {
      try {
        const vrows = await db.vehicles.filter({ id: vehicleId });
        const v = vrows?.[0];
        if (!v) throw new Error('כלי לא נמצא');
        setVehicle(v);

        // Prefer exact templateId lookup (for custom templates). Fall
        // back to (vehicle, phase) for the 3 built-in phases.
        let tpl = null;
        if (templateIdParam) {
          const rows = await db.vessel_checklists.filter({ id: templateIdParam });
          tpl = rows?.[0] || null;
        } else {
          const rows = await db.vessel_checklists.filter({ vehicle_id: vehicleId, phase: phaseParam });
          tpl = rows?.[0] || null;
        }
        setRow(tpl);
        setData(normalizeTemplate(tpl?.items));
      } catch (e) {
        console.error('[editor boot]', e);
        setBootError('טעינת התבנית נכשלה');
      }
    })();
  }, [vehicleId, phaseParam, templateIdParam]);

  const persist = async (next, extra = {}) => {
    if (!vehicle) return;
    setSaving(true);
    try {
      if (row) {
        await db.vessel_checklists.update(row.id, { items: next, ...extra });
      } else {
        const created = await db.vessel_checklists.create({
          vehicle_id: vehicle.id,
          account_id: vehicle.account_id,
          phase: phaseParam || 'custom',
          items: next,
          ...extra,
        });
        setRow(created);
      }
      qc.invalidateQueries({ queryKey: ['vessel_checklists', vehicleId] });
    } catch (e) {
      toast.error('שמירה נכשלה');
    } finally {
      setSaving(false);
    }
  };

  // Rename a CUSTOM template (system phases derive their name from PHASE_LABELS).
  const renameTemplate = async (newName) => {
    const n = (newName || '').trim();
    if (!n || !row) return;
    try {
      await db.vessel_checklists.update(row.id, { name: n });
      setRow({ ...row, name: n });
      qc.invalidateQueries({ queryKey: ['vessel_checklists', vehicleId] });
    } catch (e) {
      toast.error('שינוי השם נכשל');
    }
  };

  const updateSections = async (updater) => {
    const next = { ...data, sections: updater(data.sections) };
    setData(next);
    await persist(next);
  };

  //  Mutations 
  // Defaults only make sense for the 3 built-in phases. Custom templates
  // start empty by design (the user named them for a reason).
  const effectivePhase = row?.phase || phaseParam || 'custom';
  const isCustom = effectivePhase === 'custom';

  const importDefaults = async () => {
    if (isCustom) return; // no defaults for user templates
    const sections = getDefaultSections(effectivePhase, vehicle?.engine_type || 'outboard').map(s => ({
      id: uid(),
      name: s.name,
      items: s.items.map(text => ({ id: uid(), text })),
    }));
    await updateSections(() => sections);
    toast.success('הרשימה המומלצת נטענה');
  };

  const addSection = async (name) => {
    const clean = (name || '').trim();
    if (!clean) return;
    await updateSections(prev => [...prev, { id: uid(), name: clean, items: [] }]);
  };
  const deleteSection = (sectionId) => updateSections(prev => prev.filter(s => s.id !== sectionId));
  const renameSection = (sectionId, name) => updateSections(prev => prev.map(s => s.id === sectionId ? { ...s, name } : s));
  const addItem = (sectionId, text) => updateSections(prev => prev.map(s => s.id !== sectionId ? s : {
    ...s, items: [...s.items, { id: uid(), text }]
  }));
  const deleteItem = (sectionId, itemId) => updateSections(prev => prev.map(s => s.id !== sectionId ? s : {
    ...s, items: s.items.filter(i => i.id !== itemId)
  }));
  const renameItem = (sectionId, itemId, text) => updateSections(prev => prev.map(s => s.id !== sectionId ? s : {
    ...s, items: s.items.map(i => i.id === itemId ? { ...i, text } : i)
  }));

  //  Drag-and-drop for sections 
  const sensors = useSensors(
    // Desktop: pointer. activationConstraint.distance prevents accidental
    // drags when the user meant to click a button.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Mobile: touch. 200ms press delay so tapping an edit/delete button
    // doesn't trigger a drag.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onSectionDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    updateSections(prev => {
      const oldIdx = prev.findIndex(s => s.id === active.id);
      const newIdx = prev.findIndex(s => s.id === over.id);
      if (oldIdx < 0 || newIdx < 0) return prev;
      return arrayMove(prev, oldIdx, newIdx);
    });
  };

  const onItemDragEnd = (sectionId) => (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    updateSections(prev => prev.map(s => {
      if (s.id !== sectionId) return s;
      const oldIdx = s.items.findIndex(i => i.id === active.id);
      const newIdx = s.items.findIndex(i => i.id === over.id);
      if (oldIdx < 0 || newIdx < 0) return s;
      return { ...s, items: arrayMove(s.items, oldIdx, newIdx) };
    }));
  };

  //  Render
  // Need a vehicle AND at least one of (templateId OR phase) to know
  // which template to load. Either is fine; the loader picks the right
  // lookup strategy.
  if (!vehicleId || (!phaseParam && !templateIdParam)) {
    return <div className="p-6 text-center text-sm text-slate-500">פרמטרים חסרים</div>;
  }
  if (bootError) {
    return <div className="p-6 text-center text-sm text-red-600">{bootError}</div>;
  }
  if (!data) return <LoadingSpinner />;

  const isEmpty = data.sections.length === 0;

  return (
    <div dir="rtl" className="pb-24">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white border-b border-slate-200">
        <div className="px-4 py-3">
          <button
            onClick={() => navigate(`${createPageUrl('ChecklistHub')}?vehicleId=${vehicleId}`)}
            className="flex items-center gap-1 text-sm font-bold text-slate-500 hover:text-slate-700">
            <ArrowRight className="w-4 h-4" />
            חזרה
          </button>
          <div className="mt-2">
            {editingTemplateName ? (
              <div className="flex items-center gap-2">
                <Input
                  value={templateNameBuf}
                  onChange={(e) => setTemplateNameBuf(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      renameTemplate(templateNameBuf);
                      setEditingTemplateName(false);
                    } else if (e.key === 'Escape') {
                      setEditingTemplateName(false);
                    }
                  }}
                  autoFocus
                  className="h-8 text-sm flex-1"
                  maxLength={60}
                />
                <Button size="icon" variant="ghost" className="h-8 w-8"
                  onClick={() => { renameTemplate(templateNameBuf); setEditingTemplateName(false); }}>
                  <Check className="w-4 h-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8"
                  onClick={() => setEditingTemplateName(false)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <h1 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                <Anchor className="w-5 h-5" style={{ color: THEME.primary }} />
                <span>עריכת: {isCustom ? (row?.name || 'צ\'ק ליסט') : PHASE_LABELS[effectivePhase]}</span>
                {isCustom && row && (
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-slate-500"
                    onClick={() => { setTemplateNameBuf(row.name || ''); setEditingTemplateName(true); }}
                    aria-label="שנה שם">
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                )}
              </h1>
            )}
            <p className="text-[11px] text-slate-500 mt-0.5">
              החזק את האייקון <GripVertical className="inline w-3 h-3 align-text-bottom" /> וגרור לשינוי סדר. השינויים נשמרים אוטומטית.
            </p>
          </div>
          {saving && <p className="text-[10px] text-amber-600 mt-1">שומר…</p>}
        </div>
      </div>

      {/* Empty state */}
      {isEmpty && (
        <div className="px-4 pt-8 text-center">
          <p className="text-sm text-slate-500">אין עדיין פריטים בתבנית.</p>
          <div className="mt-4 flex flex-col gap-2">
            {/* "רשימה מומלצת" is meaningful only for the 3 built-in phases.
                Custom templates start blank by design. */}
            {!isCustom && (
              <Button onClick={importDefaults} className="gap-2" style={{ background: THEME.primary }}>
                <Download className="w-4 h-4" />
                טען רשימה מומלצת
              </Button>
            )}
            <Button variant="outline" onClick={() => setNewSectionOpen(true)} className="gap-2">
              <FolderPlus className="w-4 h-4" />
              {isCustom ? 'הוסף קטגוריה ראשונה' : 'בנה מאפס'}
            </Button>
          </div>
        </div>
      )}

      {/* Sections with DnD */}
      {!isEmpty && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onSectionDragEnd}>
          <SortableContext
            items={data.sections.map(s => s.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="px-4 pt-4 space-y-5">
              {data.sections.map((section) => (
                <SortableSection
                  key={section.id}
                  section={section}
                  onRename={(name) => renameSection(section.id, name)}
                  onDelete={() => setConfirmDeleteSection(section.id)}
                  onAddItem={(text) => addItem(section.id, text)}
                  onRenameItem={(itemId, text) => renameItem(section.id, itemId, text)}
                  onDeleteItem={(itemId) => deleteItem(section.id, itemId)}
                  sensors={sensors}
                  onItemDragEnd={onItemDragEnd(section.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Footer: add section */}
      {!isEmpty && (
        <div className="px-4 mt-6">
          <Button variant="outline" onClick={() => setNewSectionOpen(true)}
            className="w-full gap-2">
            <FolderPlus className="w-4 h-4" />
            הוסף קטגוריה
          </Button>
        </div>
      )}

      {/* New section dialog */}
      <Dialog open={newSectionOpen} onOpenChange={(v) => { if (!v) setNewSectionOpen(false); }}>
        <DialogContent dir="rtl" className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>קטגוריה חדשה</DialogTitle>
            <DialogDescription>דוגמאות: מנוע ראשי, חשמל, סיפון, ניווט</DialogDescription>
          </DialogHeader>
          <Input
            value={newSectionName}
            onChange={(e) => setNewSectionName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { addSection(newSectionName); setNewSectionName(''); setNewSectionOpen(false); } }}
            placeholder="שם הקטגוריה"
            autoFocus
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setNewSectionOpen(false); setNewSectionName(''); }}>
              ביטול
            </Button>
            <Button
              onClick={() => { addSection(newSectionName); setNewSectionName(''); setNewSectionOpen(false); }}
              disabled={!newSectionName.trim()}
              style={{ background: THEME.primary, color: '#fff' }}>
              הוסף
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete-section confirm */}
      <AlertDialog open={!!confirmDeleteSection} onOpenChange={(v) => !v && setConfirmDeleteSection(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>למחוק את הקטגוריה?</AlertDialogTitle>
            <AlertDialogDescription>כל הפריטים בקטגוריה יימחקו.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { const id = confirmDeleteSection; setConfirmDeleteSection(null); if (id) deleteSection(id); }}
              className="bg-red-600 hover:bg-red-700">
              מחק
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Section block (sortable)                                                   */
/* -------------------------------------------------------------------------- */

function SortableSection({ section, onRename, onDelete, onAddItem, onRenameItem, onDeleteItem, sensors, onItemDragEnd }) {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: section.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const [editingName, setEditingName] = useState(false);
  const [nameBuf, setNameBuf] = useState(section.name);
  const [adding, setAdding] = useState('');

  const saveName = () => {
    const n = nameBuf.trim();
    if (n && n !== section.name) onRename(n);
    setEditingName(false);
  };

  const submitAdd = (e) => {
    e?.preventDefault?.();
    const t = adding.trim();
    if (!t) return;
    onAddItem(t);
    setAdding('');
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div className="flex items-center gap-1 mb-2">
        {/* Drag handle */}
        <button
          type="button"
          className="text-slate-400 hover:text-slate-600 touch-none cursor-grab active:cursor-grabbing p-1"
          aria-label="גרור קטגוריה"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="w-4 h-4" />
        </button>

        {editingName ? (
          <>
            <Input value={nameBuf}
              onChange={e => setNameBuf(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setEditingName(false); setNameBuf(section.name); } }}
              autoFocus
              className="h-7 text-sm flex-1" />
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={saveName}>
              <Check className="w-3.5 h-3.5" />
            </Button>
          </>
        ) : (
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 flex-1">
            {section.name}
          </h2>
        )}
        {!editingName && (
          <>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-slate-500"
              onClick={() => setEditingName(true)}>
              <Pencil className="w-3.5 h-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" onClick={onDelete}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </>
        )}
      </div>

      {/* Items list with nested DnD */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onItemDragEnd}>
        <SortableContext items={section.items.map(i => i.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-1.5">
            {section.items.map((it, idx) => (
              <SortableItem
                key={it.id}
                item={it}
                number={idx + 1}
                onRename={(text) => onRenameItem(it.id, text)}
                onDelete={() => onDeleteItem(it.id)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <form onSubmit={submitAdd} className="mt-2 flex gap-2" dir="rtl">
        <Input value={adding} onChange={e => setAdding(e.target.value)}
          placeholder="הוסף פריט..." className="flex-1 h-9" />
        <Button type="submit" size="icon" disabled={!adding.trim()} className="h-9 w-9"
          style={{ background: THEME.primary, color: 'white' }}>
          <Plus className="w-4 h-4" />
        </Button>
      </form>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Item row (sortable)                                                        */
/* -------------------------------------------------------------------------- */

function SortableItem({ item, number, onRename, onDelete }) {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: item.id });

  const [editing, setEditing] = useState(false);
  const [buf, setBuf] = useState(item.text);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const saveEdit = () => {
    const t = buf.trim();
    if (t) onRename(t);
    setEditing(false);
  };

  return (
    <li ref={setNodeRef} style={style}
      className="flex items-center gap-2 border rounded-md px-2 py-2 bg-white" dir="rtl">
      {/* Drag handle */}
      <button
        type="button"
        className="text-slate-400 hover:text-slate-600 touch-none cursor-grab active:cursor-grabbing p-0.5 shrink-0"
        aria-label="גרור פריט"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="w-4 h-4" />
      </button>

      {/* Number badge (1., 2., 3., …) */}
      <span className="shrink-0 w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-[11px] font-bold flex items-center justify-center">
        {number}
      </span>

      {editing ? (
        <>
          <Input autoFocus value={buf}
            onChange={e => setBuf(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') { setEditing(false); setBuf(item.text); } }}
            className="flex-1 h-8" />
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={saveEdit}>
            <Check className="w-4 h-4" />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8"
            onClick={() => { setEditing(false); setBuf(item.text); }}>
            <X className="w-4 h-4" />
          </Button>
        </>
      ) : (
        <>
          <span className="flex-1 text-sm text-slate-800 min-w-0 break-words">{item.text}</span>
          <Button size="icon" variant="ghost" className="h-8 w-8 text-slate-500 shrink-0"
            onClick={() => setEditing(true)}>
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500 shrink-0"
            onClick={onDelete}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </>
      )}
    </li>
  );
}
