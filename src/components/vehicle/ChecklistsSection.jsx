/**
 * ChecklistsSection. sectioned, editable pre/engine/post checklists.
 *
 * Internal data shape (jsonb on vessel_checklists.items):
 *   {
 *     sections: [
 *       { id, name, collapsed?, items: [{ id, text, checked }] }
 *     ]
 *   }
 *
 * Backward-compat: if the DB row stores a flat array (old shape),
 * normalizeStored wraps it into a single 'כללי' section.
 */

import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db } from '@/lib/supabaseEntities';
import {
  getDefaultSections,
  PHASE_LABELS,
  PHASE_ORDER,
  ENGINE_TYPE_LABELS,
} from '@/lib/checklistTemplates';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';

import {
  Anchor, Plus, Trash2, Pencil, Check, X, Download, CheckCircle2,
  ChevronDown, ChevronLeft, Ship, Wrench, FolderPlus, PartyPopper,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { he } from 'date-fns/locale';

const PHASES = PHASE_ORDER.map(key => ({ key, label: PHASE_LABELS[key] }));

function uid() { return `i_${Math.random().toString(36).slice(2, 10)}`; }

function fmtAgo(ts) {
  if (!ts) return null;
  try { return formatDistanceToNow(new Date(ts), { addSuffix: false, locale: he }); }
  catch { return null; }
}

/**
 * Normalize stored items into `{ sections: [...] }`.
 * Accepts three legacy shapes:
 *   1. new: { sections: [...] }
 *   2. old flat: [{ id, text, checked }]
 *   3. empty / null
 */
function normalizeStored(raw) {
  if (!raw) return { sections: [] };
  if (Array.isArray(raw)) {
    // old flat shape → wrap in single 'כללי' section
    return {
      sections: raw.length
        ? [{ id: uid(), name: 'כללי', items: raw.map(it => ({
            id: it.id || uid(),
            text: it.text || '',
            checked: !!it.checked,
          })) }]
        : [],
    };
  }
  if (raw.sections && Array.isArray(raw.sections)) {
    return {
      sections: raw.sections.map(s => ({
        id: s.id || uid(),
        name: s.name || 'ללא שם',
        collapsed: !!s.collapsed,
        items: (s.items || []).map(it => ({
          id: it.id || uid(),
          text: it.text || '',
          checked: !!it.checked,
        })),
      })),
    };
  }
  return { sections: [] };
}

function buildFromDefaults(phase, engineType) {
  return {
    sections: getDefaultSections(phase, engineType).map(s => ({
      id: uid(),
      name: s.name,
      collapsed: false,
      items: s.items.map(text => ({ id: uid(), text, checked: false })),
    })),
  };
}

function totalStats(data) {
  let total = 0, done = 0;
  for (const s of data.sections || []) {
    total += (s.items || []).length;
    done += (s.items || []).filter(i => i.checked).length;
  }
  return { total, done };
}

// 
// Root section
// 

export default function ChecklistsSection({ vehicle }) {
  const qc = useQueryClient();
  const [activePhase, setActivePhase] = useState('engine');

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['vessel_checklists', vehicle.id],
    queryFn: () => db.vessel_checklists.filter({ vehicle_id: vehicle.id }),
    enabled: !!vehicle?.id,
  });

  const byPhase = useMemo(() => {
    const map = {};
    for (const r of rows) map[r.phase] = r;
    return map;
  }, [rows]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['vessel_checklists', vehicle.id] });

  return (
    <Card className="shadow-sm" dir="rtl">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Anchor className="w-5 h-5 text-teal-600" />
          צ'ק ליסטים
        </CardTitle>
        <p className="text-xs text-slate-500">
          רשימות מקצועיות לפני הנעה, לפני יציאה ובסיום. ניתן לערוך, להוסיף ולסדר לפי הצורך.
        </p>
      </CardHeader>
      <CardContent>
        <Tabs value={activePhase} onValueChange={setActivePhase} dir="rtl">
          <TabsList className="w-full grid grid-cols-3">
            {PHASES.map(p => (
              <TabsTrigger key={p.key} value={p.key}>{p.label}</TabsTrigger>
            ))}
          </TabsList>
          {PHASES.map(p => (
            <TabsContent key={p.key} value={p.key} className="mt-4">
              <PhasePanel
                phase={p.key}
                vehicle={vehicle}
                row={byPhase[p.key]}
                loading={isLoading}
                onChange={invalidate}
              />
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}

// 
// Phase panel
// 

function PhasePanel({ phase, vehicle, row, loading, onChange }) {
  const qc = useQueryClient();
  const data = useMemo(() => normalizeStored(row?.items), [row]);
  const { total, done } = totalStats(data);
  const hasItems = total > 0;
  const allDone = hasItems && done === total;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const [engineDialogOpen, setEngineDialogOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // section id pending delete

  // Persistence helper. always writes the whole sections object back.
  const persist = async (next, extra = {}) => {
    if (row) {
      await db.vessel_checklists.update(row.id, { items: next, ...extra });
    } else {
      await db.vessel_checklists.create({
        vehicle_id: vehicle.id,
        account_id: vehicle.account_id,
        phase,
        items: next,
        ...extra,
      });
    }
    onChange();
  };

  //  Section-level ops 
  const updateSections = (updater, extra = {}) =>
    persist({ ...data, sections: updater(data.sections) }, extra);

  const toggleItem = (sectionId, itemId) => updateSections(secs =>
    secs.map(s => s.id !== sectionId ? s : {
      ...s,
      items: s.items.map(it => it.id === itemId ? { ...it, checked: !it.checked } : it),
    })
  );

  const renameItem = (sectionId, itemId, text) => updateSections(secs =>
    secs.map(s => s.id !== sectionId ? s : {
      ...s,
      items: s.items.map(it => it.id === itemId ? { ...it, text } : it),
    })
  );

  const deleteItem = (sectionId, itemId) => updateSections(secs =>
    secs.map(s => s.id !== sectionId ? s : {
      ...s,
      items: s.items.filter(it => it.id !== itemId),
    })
  );

  const addItem = (sectionId, text) => updateSections(secs =>
    secs.map(s => s.id !== sectionId ? s : {
      ...s,
      items: [...s.items, { id: uid(), text, checked: false }],
    })
  );

  const toggleCollapse = (sectionId) => updateSections(secs =>
    secs.map(s => s.id !== sectionId ? s : { ...s, collapsed: !s.collapsed })
  );

  const renameSection = (sectionId, name) => updateSections(secs =>
    secs.map(s => s.id !== sectionId ? s : { ...s, name })
  );

  const deleteSection = (sectionId) => updateSections(secs =>
    secs.filter(s => s.id !== sectionId)
  );

  const addSection = (name) => updateSections(secs =>
    [...secs, { id: uid(), name, collapsed: false, items: [] }]
  );

  //  Finish run: clear all checks + stamp last_completed_at 
  const finishRun = () => updateSections(
    secs => secs.map(s => ({ ...s, items: s.items.map(it => ({ ...it, checked: false })) })),
    { last_completed_at: new Date().toISOString() }
  );

  //  Import defaults: for engine phase, ensure engine_type is set 
  const loadDefaults = async (engineTypeForPhase) => {
    const next = buildFromDefaults(phase, engineTypeForPhase);
    await persist(next);
    // persist engine_type on vehicle so next import remembers it
    if (phase === 'engine' && engineTypeForPhase && engineTypeForPhase !== vehicle.engine_type) {
      try {
        await db.vehicles.update(vehicle.id, { engine_type: engineTypeForPhase });
        qc.invalidateQueries({ queryKey: ['vehicles'] });
        qc.invalidateQueries({ queryKey: ['vehicle', vehicle.id] });
      } catch (e) {
        if (import.meta.env.DEV) console.warn('[checklists] engine_type save failed:', e?.message);
      }
    }
  };

  const onImportClick = () => {
    if (phase === 'engine') {
      if (vehicle.engine_type === 'outboard' || vehicle.engine_type === 'inboard') {
        loadDefaults(vehicle.engine_type);
      } else {
        setEngineDialogOpen(true);
      }
    } else {
      loadDefaults();
    }
  };

  const onChangeEngineType = () => setEngineDialogOpen(true);

  if (loading) {
    return <div className="text-center text-sm text-slate-400 py-6">טוען...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Engine type badge (engine phase only) */}
      {phase === 'engine' && vehicle.engine_type && (
        <div className="flex items-center justify-between text-xs bg-slate-50 border rounded-md px-3 py-2">
          <div className="flex items-center gap-2 text-slate-700">
            <Wrench className="w-4 h-4 text-teal-600" />
            <span>סוג מנוע:</span>
            <Badge variant="secondary">
              {ENGINE_TYPE_LABELS[vehicle.engine_type] || vehicle.engine_type}
            </Badge>
          </div>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onChangeEngineType}>
            שנה
          </Button>
        </div>
      )}

      {/* Last completed */}
      {row?.last_completed_at && (
        <div className="flex items-center gap-2 text-xs text-teal-700 bg-teal-50 rounded-md px-3 py-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>בוצע לאחרונה: לפני {fmtAgo(row.last_completed_at)}</span>
        </div>
      )}

      {/* Global progress */}
      {hasItems && (
        <div className="space-y-1">
          <div className="flex justify-between items-center text-xs text-slate-600">
            <span>{done} מתוך {total} סומנו</span>
            <span className="font-semibold">{pct}%</span>
          </div>
          <Progress value={pct} className="h-2" />
          {allDone && (
            <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 rounded-md px-3 py-2 mt-2">
              <PartyPopper className="w-4 h-4" />
              <span>כל הכבוד, הכול סומן. ניתן לסיים את הבדיקה.</span>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!hasItems && (
        <div className="border-2 border-dashed rounded-lg p-6 text-center space-y-3">
          <p className="text-sm text-slate-500">אין עדיין פריטים. אפשר לייבא רשימה מומלצת או לבנות מאפס.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" size="sm" onClick={onImportClick} className="gap-1">
              <Download className="w-4 h-4" />
              ייבא רשימה מומלצת
            </Button>
            <Button
              variant="outline" size="sm" className="gap-1"
              onClick={() => {
                const name = window.prompt('שם הקטגוריה החדשה:', '');
                if (name && name.trim()) addSection(name.trim());
              }}
            >
              <FolderPlus className="w-4 h-4" />
              הוסף קטגוריה
            </Button>
          </div>
        </div>
      )}

      {/* Sections */}
      {data.sections.map(section => (
        <SectionBlock
          key={section.id}
          section={section}
          onToggleCollapse={() => toggleCollapse(section.id)}
          onRename={(name) => renameSection(section.id, name)}
          onAskDelete={() => setConfirmDelete(section.id)}
          onToggleItem={(itemId) => toggleItem(section.id, itemId)}
          onRenameItem={(itemId, text) => renameItem(section.id, itemId, text)}
          onDeleteItem={(itemId) => deleteItem(section.id, itemId)}
          onAddItem={(text) => addItem(section.id, text)}
        />
      ))}

      {/* Footer controls (when has items) */}
      {hasItems && (
        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            className="gap-1 w-full"
            onClick={() => {
              const name = window.prompt('שם הקטגוריה החדשה:', '');
              if (name && name.trim()) addSection(name.trim());
            }}
          >
            <FolderPlus className="w-4 h-4" />
            הוסף קטגוריה
          </Button>
          <Button
            className="w-full gap-2"
            disabled={!allDone}
            onClick={finishRun}
            title={allDone ? '' : 'יש לסמן את כל הפריטים לפני סיום'}
          >
            <Check className="w-4 h-4" />
            סיים בדיקה ({done}/{total})
          </Button>
        </div>
      )}

      {/* Engine type picker */}
      <EngineTypePicker
        open={engineDialogOpen}
        current={vehicle.engine_type}
        onClose={() => setEngineDialogOpen(false)}
        onPick={(type) => { setEngineDialogOpen(false); loadDefaults(type); }}
      />

      {/* Confirm delete category */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>למחוק את הקטגוריה?</AlertDialogTitle>
            <AlertDialogDescription>
              כל הפריטים בקטגוריה יימחקו. פעולה זו לא ניתנת לביטול.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { const id = confirmDelete; setConfirmDelete(null); if (id) deleteSection(id); }}
              className="bg-red-600 hover:bg-red-700"
            >
              מחק
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// 
// Section block (collapsible)
// 

function SectionBlock({
  section, onToggleCollapse, onRename, onAskDelete,
  onToggleItem, onRenameItem, onDeleteItem, onAddItem,
}) {
  const [adding, setAdding] = useState('');
  const [editingSecName, setEditingSecName] = useState(false);
  const [nameBuf, setNameBuf] = useState(section.name);
  const [editingItemId, setEditingItemId] = useState(null);
  const [itemBuf, setItemBuf] = useState('');

  const total = section.items.length;
  const done = section.items.filter(i => i.checked).length;
  const collapsed = !!section.collapsed;

  const saveSecName = () => {
    const n = nameBuf.trim();
    if (n && n !== section.name) onRename(n);
    setEditingSecName(false);
  };

  const startEditItem = (it) => {
    setEditingItemId(it.id);
    setItemBuf(it.text);
  };

  const saveItemEdit = () => {
    const t = itemBuf.trim();
    if (t && t !== section.items.find(i => i.id === editingItemId)?.text) {
      onRenameItem(editingItemId, t);
    }
    setEditingItemId(null);
    setItemBuf('');
  };

  const handleAdd = (e) => {
    e?.preventDefault?.();
    const t = adding.trim();
    if (!t) return;
    onAddItem(t);
    setAdding('');
  };

  return (
    <div className="border rounded-lg bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border-b">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="text-slate-500 hover:text-slate-700"
          aria-label={collapsed ? 'הרחב' : 'כווץ'}
        >
          {collapsed ? <ChevronLeft className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {editingSecName ? (
          <div className="flex-1 flex gap-1">
            <Input
              autoFocus
              value={nameBuf}
              onChange={(e) => setNameBuf(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveSecName();
                if (e.key === 'Escape') { setEditingSecName(false); setNameBuf(section.name); }
              }}
              className="h-7 text-sm"
            />
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={saveSecName}>
              <Check className="w-3.5 h-3.5" />
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="flex-1 flex items-center gap-2 text-right font-semibold text-sm text-slate-800"
          >
            <span>{section.name}</span>
            <Badge variant="outline" className="text-xs font-normal">
              {done}/{total}
            </Badge>
          </button>
        )}

        {!editingSecName && (
          <>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-slate-500"
              onClick={() => { setEditingSecName(true); setNameBuf(section.name); }}>
              <Pencil className="w-3.5 h-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500"
              onClick={onAskDelete}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </>
        )}
      </div>

      {/* Body */}
      {!collapsed && (
        <div className="p-3 space-y-2">
          {section.items.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-2">אין עדיין פריטים בקטגוריה.</p>
          )}

          <ul className="space-y-1.5">
            {section.items.map(it => (
              <li key={it.id} dir="rtl"
                className="flex items-center gap-2 border rounded-md px-3 py-2 bg-white">
                <Checkbox
                  checked={!!it.checked}
                  onCheckedChange={() => onToggleItem(it.id)}
                />
                {editingItemId === it.id ? (
                  <>
                    <Input autoFocus value={itemBuf}
                      onChange={(e) => setItemBuf(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveItemEdit();
                        if (e.key === 'Escape') { setEditingItemId(null); setItemBuf(''); }
                      }}
                      className="flex-1 h-8" />
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={saveItemEdit}>
                      <Check className="w-4 h-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8"
                      onClick={() => { setEditingItemId(null); setItemBuf(''); }}>
                      <X className="w-4 h-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <span className={`flex-1 text-sm ${it.checked ? 'line-through text-slate-400' : ''}`}>
                      {it.text}
                    </span>
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
              </li>
            ))}
          </ul>

          <form onSubmit={handleAdd} className="flex gap-2 pt-1" dir="rtl">
            <Input value={adding} onChange={(e) => setAdding(e.target.value)}
              placeholder="הוסף פריט לקטגוריה..." className="flex-1 h-9" />
            <Button type="submit" size="icon" disabled={!adding.trim()} className="h-9 w-9">
              <Plus className="w-4 h-4" />
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}

// 
// Engine-type picker dialog
// 

function EngineTypePicker({ open, current, onClose, onPick }) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>איזה סוג מנוע יש בכלי?</DialogTitle>
          <DialogDescription>
            הבדיקות לפני הנעה שונות בין מנוע חיצוני לפנימי. הבחירה תישמר בכלי לשימוש חוזר.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 py-2">
          <EngineOption
            active={current === 'outboard'}
            title="מנוע חיצוני"
            subtitle="Outboard. מותקן על ראי הסירה, עם kill switch וזרימת מים מפתח הקירור."
            onClick={() => onPick('outboard')}
          />
          <EngineOption
            active={current === 'inboard'}
            title="מנוע פנימי"
            subtitle="Inboard. חדר מנוע עם blower, מערכת קירור במים מלוח, פילטר ינוק (strainer)."
            onClick={() => onPick('inboard')}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>ביטול</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EngineOption({ active, title, subtitle, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-right border rounded-lg p-4 transition hover:border-teal-500 hover:bg-teal-50
        ${active ? 'border-teal-600 bg-teal-50' : 'border-slate-200 bg-white'}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <Ship className="w-4 h-4 text-teal-600" />
        <span className="font-semibold text-sm">{title}</span>
        {active && <Badge variant="secondary" className="text-[10px]">נבחר</Badge>}
      </div>
      <p className="text-xs text-slate-500 leading-relaxed">{subtitle}</p>
    </button>
  );
}
