/**
 * ChecklistEditor — dedicated page for editing the TEMPLATE of one phase.
 *
 * URL: /ChecklistEditor?vehicleId=<uuid>&phase=engine|pre|post
 *
 * Product rules (from planning session):
 *   • Viewing ≠ editing. An explicit toggle at the top switches modes.
 *   • In VIEW mode: no trash/pencil/add buttons. Just sections + items.
 *   • In EDIT mode: rename sections/items, delete, add item, add section,
 *     import defaults (only if the template is empty).
 *   • Changes are auto-saved on blur / toggle-off. There is no "save"
 *     button — editing a template is inherently live.
 *
 * The template drives future run snapshots; existing runs keep their own
 * frozen items and aren't affected when the template changes.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createPageUrl } from '@/utils';
import { db } from '@/lib/supabaseEntities';
import { PHASE_LABELS, getDefaultSections } from '@/lib/checklistTemplates';
import { ArrowRight, Plus, Trash2, Pencil, Check, X, FolderPlus, Download, Anchor, Eye, Edit3 } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

const THEME = {
  primary: '#0C7B93',
  grad:    'linear-gradient(135deg, #065A6E 0%, #0C7B93 100%)',
  tint:    '#E0F7FA',
};

function uid() { return `i_${Math.random().toString(36).slice(2, 10)}`; }

/** Normalise whatever the DB holds into the canonical { sections: [...] } shape. */
function normalizeTemplate(raw) {
  if (!raw) return { sections: [] };
  if (raw.sections && Array.isArray(raw.sections)) {
    return {
      sections: raw.sections.map(s => ({
        id: s.id || uid(),
        name: s.name || 'ללא שם',
        items: (s.items || []).map(it => ({
          id: it.id || uid(),
          text: it.text || '',
        })),
      })),
    };
  }
  // Legacy flat shape
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
  const phase = params.get('phase');
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [data, setData] = useState(null);                    // { sections: [...] }
  const [row, setRow] = useState(null);                      // vessel_checklists row
  const [vehicle, setVehicle] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [bootError, setBootError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteSection, setConfirmDeleteSection] = useState(null);
  const [newSectionOpen, setNewSectionOpen] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');

  // Load vehicle + existing template on mount
  useEffect(() => {
    if (!vehicleId || !phase) return;
    (async () => {
      try {
        const vrows = await db.vehicles.filter({ id: vehicleId });
        const v = vrows?.[0];
        if (!v) throw new Error('כלי לא נמצא');
        setVehicle(v);
        const tplRows = await db.vessel_checklists.filter({ vehicle_id: vehicleId, phase });
        const tpl = tplRows?.[0] || null;
        setRow(tpl);
        setData(normalizeTemplate(tpl?.items));
      } catch (e) {
        console.error('[editor boot]', e);
        setBootError('טעינת התבנית נכשלה');
      }
    })();
  }, [vehicleId, phase]);

  // Persist the whole template. Create the row on first save if absent.
  const persist = async (next) => {
    if (!vehicle) return;
    setSaving(true);
    try {
      if (row) {
        await db.vessel_checklists.update(row.id, { items: next });
      } else {
        const created = await db.vessel_checklists.create({
          vehicle_id: vehicle.id,
          account_id: vehicle.account_id,
          phase,
          items: next,
        });
        setRow(created);
      }
      qc.invalidateQueries({ queryKey: ['vessel_checklists', vehicleId] });
    } catch (e) {
      toast.error('שמירה נכשלה');
      if (import.meta.env.DEV) console.warn('[editor save]', e?.message);
    } finally {
      setSaving(false);
    }
  };

  const updateSections = async (updater) => {
    const next = { ...data, sections: updater(data.sections) };
    setData(next);
    await persist(next);
  };

  const importDefaults = async () => {
    const sections = getDefaultSections(phase, vehicle?.engine_type || 'outboard').map(s => ({
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

  const deleteSection = async (sectionId) =>
    updateSections(prev => prev.filter(s => s.id !== sectionId));

  const renameSection = async (sectionId, name) =>
    updateSections(prev => prev.map(s => s.id === sectionId ? { ...s, name } : s));

  const addItem = async (sectionId, text) =>
    updateSections(prev => prev.map(s => s.id !== sectionId ? s : {
      ...s, items: [...s.items, { id: uid(), text }]
    }));

  const deleteItem = async (sectionId, itemId) =>
    updateSections(prev => prev.map(s => s.id !== sectionId ? s : {
      ...s, items: s.items.filter(i => i.id !== itemId)
    }));

  const renameItem = async (sectionId, itemId, text) =>
    updateSections(prev => prev.map(s => s.id !== sectionId ? s : {
      ...s, items: s.items.map(i => i.id === itemId ? { ...i, text } : i)
    }));

  if (!vehicleId || !phase) {
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
          <div className="mt-2 flex items-center justify-between">
            <div>
              <h1 className="font-black text-lg text-slate-800 flex items-center gap-2">
                <Anchor className="w-5 h-5" style={{ color: THEME.primary }} />
                {PHASE_LABELS[phase]}
              </h1>
              <p className="text-[11px] text-slate-500 mt-0.5">תבנית הצ'ק ליסט שלך</p>
            </div>

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <span className={`text-xs font-bold flex items-center gap-1 ${editMode ? 'text-teal-700' : 'text-slate-500'}`}>
                {editMode ? <><Edit3 className="w-3.5 h-3.5" /> מצב עריכה</> : <><Eye className="w-3.5 h-3.5" /> צפייה</>}
              </span>
              <Switch checked={editMode} onCheckedChange={setEditMode} />
            </label>
          </div>
          {saving && <p className="text-[10px] text-amber-600 mt-1">שומר…</p>}
        </div>
      </div>

      {/* Empty state */}
      {isEmpty && (
        <div className="px-4 pt-8 text-center">
          <p className="text-sm text-slate-500">אין עדיין פריטים בתבנית.</p>
          <div className="mt-4 flex flex-col gap-2">
            <Button onClick={importDefaults} className="gap-2" style={{ background: THEME.primary }}>
              <Download className="w-4 h-4" />
              טען רשימה מומלצת
            </Button>
            <Button variant="outline" onClick={() => setNewSectionOpen(true)} className="gap-2">
              <FolderPlus className="w-4 h-4" />
              בנה מאפס
            </Button>
          </div>
        </div>
      )}

      {/* Sections */}
      <div className="px-4 pt-4 space-y-5">
        {data.sections.map(section => (
          <SectionBlock
            key={section.id}
            section={section}
            editMode={editMode}
            onRename={(name) => renameSection(section.id, name)}
            onDelete={() => setConfirmDeleteSection(section.id)}
            onAddItem={(text) => addItem(section.id, text)}
            onRenameItem={(itemId, text) => renameItem(section.id, itemId, text)}
            onDeleteItem={(itemId) => deleteItem(section.id, itemId)}
          />
        ))}
      </div>

      {/* Footer actions (edit mode only) */}
      {editMode && !isEmpty && (
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

function SectionBlock({ section, editMode, onRename, onDelete, onAddItem, onRenameItem, onDeleteItem }) {
  const [editingName, setEditingName] = useState(false);
  const [nameBuf, setNameBuf] = useState(section.name);
  const [adding, setAdding] = useState('');
  const [editingItemId, setEditingItemId] = useState(null);
  const [itemBuf, setItemBuf] = useState('');

  const saveName = () => {
    const n = nameBuf.trim();
    if (n && n !== section.name) onRename(n);
    setEditingName(false);
  };

  const startEditItem = (it) => { setEditingItemId(it.id); setItemBuf(it.text); };
  const saveEditItem = () => {
    const t = itemBuf.trim();
    if (t) onRenameItem(editingItemId, t);
    setEditingItemId(null);
    setItemBuf('');
  };

  const submitAdd = (e) => {
    e?.preventDefault?.();
    const t = adding.trim();
    if (!t) return;
    onAddItem(t);
    setAdding('');
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {editingName ? (
          <>
            <Input value={nameBuf}
              onChange={e => setNameBuf(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setEditingName(false); setNameBuf(section.name); } }}
              autoFocus
              className="h-7 text-sm" />
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={saveName}>
              <Check className="w-3.5 h-3.5" />
            </Button>
          </>
        ) : (
          <h2 className="text-xs font-black uppercase tracking-wide text-slate-500 flex-1">
            {section.name}
          </h2>
        )}
        {editMode && !editingName && (
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

      <ul className="space-y-1.5">
        {section.items.map(it => (
          <li key={it.id}
            className="flex items-center gap-2 border rounded-md px-3 py-2 bg-white" dir="rtl">
            {editingItemId === it.id ? (
              <>
                <Input autoFocus value={itemBuf}
                  onChange={e => setItemBuf(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveEditItem(); if (e.key === 'Escape') { setEditingItemId(null); setItemBuf(''); } }}
                  className="flex-1 h-8" />
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={saveEditItem}>
                  <Check className="w-4 h-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8"
                  onClick={() => { setEditingItemId(null); setItemBuf(''); }}>
                  <X className="w-4 h-4" />
                </Button>
              </>
            ) : (
              <>
                <span className="flex-1 text-sm text-slate-800">{it.text}</span>
                {editMode && (
                  <>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-slate-500"
                      onClick={() => startEditItem(it)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500"
                      onClick={() => onDeleteItem(it.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </>
                )}
              </>
            )}
          </li>
        ))}
      </ul>

      {editMode && (
        <form onSubmit={submitAdd} className="mt-2 flex gap-2" dir="rtl">
          <Input value={adding} onChange={e => setAdding(e.target.value)}
            placeholder="הוסף פריט..." className="flex-1 h-9" />
          <Button type="submit" size="icon" disabled={!adding.trim()} className="h-9 w-9"
            style={{ background: THEME.primary, color: 'white' }}>
            <Plus className="w-4 h-4" />
          </Button>
        </form>
      )}
    </div>
  );
}
