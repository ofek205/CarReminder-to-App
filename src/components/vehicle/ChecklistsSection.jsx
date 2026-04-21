/**
 * ChecklistsSection — simple editable pre/post trip checklists for vessels.
 *
 * Behaviour:
 *   • One tab per phase ("לפני יציאה" / "אחרי יציאה").
 *   • Each phase is a single DB row (vessel_checklists) with jsonb items.
 *   • User can: add, rename (inline), delete, reorder? (not yet), check.
 *   • "סיים ✓" stamps last_completed_at and un-checks everything for next trip.
 *   • First-time empty state offers one-click import of a recommended list
 *     derived from vehicle_type (checklistTemplates.pickTemplateForBoat).
 */

import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db } from '@/lib/supabaseEntities';
import { getDefaultsForPhase, PHASE_LABELS, PHASE_ORDER } from '@/lib/checklistTemplates';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Anchor, Plus, Trash2, Pencil, Check, X, Download, CheckCircle2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { he } from 'date-fns/locale';

const PHASES = PHASE_ORDER.map(key => ({ key, label: PHASE_LABELS[key] }));

function uid() {
  return `i_${Math.random().toString(36).slice(2, 10)}`;
}

function fmtAgo(ts) {
  if (!ts) return null;
  try { return formatDistanceToNow(new Date(ts), { addSuffix: false, locale: he }); }
  catch { return null; }
}

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
        <p className="text-xs text-slate-500">רשימות אישיות שלך לפני ואחרי יציאה לים. ניתן לערוך ולשמור.</p>
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

/* -------------------------------------------------------------------------- */
/* Phase panel                                                                */
/* -------------------------------------------------------------------------- */

function PhasePanel({ phase, vehicle, row, loading, onChange }) {
  const qc = useQueryClient();
  const items = row?.items || [];
  const [adding, setAdding] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');

  // Upsert helper: create row if missing, else update.
  const persist = async (nextItems, extra = {}) => {
    if (row) {
      await db.vessel_checklists.update(row.id, { items: nextItems, ...extra });
    } else {
      await db.vessel_checklists.create({
        vehicle_id: vehicle.id,
        account_id: vehicle.account_id,
        phase,
        items: nextItems,
        ...extra,
      });
    }
    onChange();
  };

  const mAdd = useMutation({
    mutationFn: async (text) => {
      const next = [...items, { id: uid(), text, checked: false }];
      await persist(next);
    },
  });

  const mToggle = useMutation({
    mutationFn: async (id) => {
      const next = items.map(it => it.id === id ? { ...it, checked: !it.checked } : it);
      await persist(next);
    },
  });

  const mRename = useMutation({
    mutationFn: async ({ id, text }) => {
      const next = items.map(it => it.id === id ? { ...it, text } : it);
      await persist(next);
    },
  });

  const mDelete = useMutation({
    mutationFn: async (id) => {
      const next = items.filter(it => it.id !== id);
      await persist(next);
    },
  });

  const mFinish = useMutation({
    mutationFn: async () => {
      const next = items.map(it => ({ ...it, checked: false }));
      await persist(next, { last_completed_at: new Date().toISOString() });
    },
  });

  const mImport = useMutation({
    mutationFn: async () => {
      const flat = getDefaultsForPhase(phase).map(text => ({
        id: uid(), text, checked: false,
      }));
      await persist(flat);
    },
  });

  const onAdd = (e) => {
    e?.preventDefault?.();
    const t = adding.trim();
    if (!t) return;
    mAdd.mutate(t);
    setAdding('');
  };

  const startEdit = (it) => {
    setEditingId(it.id);
    setEditText(it.text);
  };

  const saveEdit = () => {
    const t = editText.trim();
    if (t && t !== items.find(i => i.id === editingId)?.text) {
      mRename.mutate({ id: editingId, text: t });
    }
    setEditingId(null);
    setEditText('');
  };

  const checkedCount = items.filter(i => i.checked).length;
  const hasItems = items.length > 0;
  const allDone = hasItems && checkedCount === items.length;

  if (loading) {
    return <div className="text-center text-sm text-slate-400 py-6">טוען...</div>;
  }

  return (
    <div className="space-y-3">
      {/* Last completed banner */}
      {row?.last_completed_at && (
        <div className="flex items-center gap-2 text-xs text-teal-700 bg-teal-50 rounded-md px-3 py-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>בוצע לאחרונה: לפני {fmtAgo(row.last_completed_at)}</span>
        </div>
      )}

      {/* Empty state */}
      {!hasItems && (
        <div className="border-2 border-dashed rounded-lg p-6 text-center space-y-3">
          <p className="text-sm text-slate-500">הרשימה ריקה. אפשר להוסיף פריטים ידנית או לייבא רשימה מומלצת.</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => mImport.mutate()}
            disabled={mImport.isPending}
            className="gap-1"
          >
            <Download className="w-4 h-4" />
            ייבא רשימה מומלצת
          </Button>
        </div>
      )}

      {/* Items list */}
      {hasItems && (
        <ul className="space-y-2">
          {items.map(it => (
            <li
              key={it.id}
              dir="rtl"
              className="flex items-center gap-2 border rounded-md px-3 py-2 bg-white"
            >
              <Checkbox
                checked={!!it.checked}
                onCheckedChange={() => mToggle.mutate(it.id)}
              />
              {editingId === it.id ? (
                <>
                  <Input
                    autoFocus
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveEdit();
                      if (e.key === 'Escape') { setEditingId(null); setEditText(''); }
                    }}
                    className="flex-1 h-8"
                  />
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={saveEdit}>
                    <Check className="w-4 h-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => { setEditingId(null); setEditText(''); }}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </>
              ) : (
                <>
                  <span className={`flex-1 text-sm ${it.checked ? 'line-through text-slate-400' : ''}`}>
                    {it.text}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-slate-500"
                    onClick={() => startEdit(it)}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-red-500"
                    onClick={() => mDelete.mutate(it.id)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Add-item row */}
      <form onSubmit={onAdd} className="flex gap-2" dir="rtl">
        <Input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          placeholder="הוסף פריט לרשימה..."
          className="flex-1"
        />
        <Button type="submit" size="icon" disabled={!adding.trim() || mAdd.isPending}>
          <Plus className="w-4 h-4" />
        </Button>
      </form>

      {/* Finish run */}
      {hasItems && (
        <Button
          className="w-full gap-2"
          disabled={!allDone || mFinish.isPending}
          onClick={() => mFinish.mutate()}
          title={allDone ? '' : 'יש לסמן את כל הפריטים לפני סיום'}
        >
          <Check className="w-4 h-4" />
          סיים ({checkedCount}/{items.length})
        </Button>
      )}
    </div>
  );
}
