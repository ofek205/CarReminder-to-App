import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, History, RotateCcw, ChevronLeft } from 'lucide-react';
import { useTemplateVersions, useRevertToVersion } from '@/hooks/useEmailAdmin';
import { toast } from 'sonner';

/**
 * VersionHistoryDialog. list of auto-snapshots for a template. Admin
 * can click any version to preview its content, and revert with a single
 * button. The revert writes a NEW snapshot so nothing is ever lost.
 */
export default function VersionHistoryDialog({ template, open, onClose }) {
  const { data: versions = [], isLoading } = useTemplateVersions(template?.id);
  const revert = useRevertToVersion();
  const [selected, setSelected] = useState(null);

  if (!template) return null;

  const handleRevert = async (snap) => {
    if (!confirm(`לחזור לגרסה מ-${new Date(snap.created_at).toLocaleString('he-IL')}?\nהגרסה הנוכחית תישמר כגרסה חדשה בהיסטוריה.`)) return;
    try {
      await revert.mutateAsync({ templateId: template.id, snapshot: snap.snapshot });
      toast.success('שוחזר בהצלחה');
      onClose?.();
    } catch (e) {
      toast.error(`נכשל: ${e.message}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose?.()}>
      <DialogContent dir="rtl" className="max-w-3xl max-h-[85vh] p-0 gap-0 flex flex-col overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <History className="w-4 h-4" />
            היסטוריית גרסאות
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-hidden grid md:grid-cols-2">
          {/* LEFT. version list */}
          <div className="overflow-y-auto border-l p-3">
            {isLoading ? (
              <div className="py-12 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
            ) : versions.length === 0 ? (
              <div className="py-12 text-center text-xs text-gray-500">
                אין גרסאות קודמות.<br />הגרסה הראשונה תישמר אוטומטית בפעם הבאה שתערך ותשמור את התבנית.
              </div>
            ) : (
              versions.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setSelected(v)}
                  className={`w-full text-right p-3 mb-2 rounded-xl border transition ${
                    selected?.id === v.id ? 'border-green-600 bg-green-50' : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}>
                  <div className="text-xs font-bold" style={{ color: '#1C2E20' }}>
                    {new Date(v.created_at).toLocaleDateString('he-IL', { dateStyle: 'medium' })}
                  </div>
                  <div className="text-[11px] text-gray-500">
                    {new Date(v.created_at).toLocaleTimeString('he-IL')}
                  </div>
                  <div className="text-xs text-gray-600 mt-1 truncate">
                    {v.snapshot?.subject || '(ללא נושא)'}
                  </div>
                </button>
              ))
            )}
          </div>

          {/* RIGHT. selected version preview */}
          <div className="overflow-y-auto p-4 bg-gray-50">
            {!selected ? (
              <div className="py-20 text-center text-sm text-gray-400">
                <ChevronLeft className="w-6 h-6 mx-auto mb-2 rotate-180" />
                בחר/י גרסה מהרשימה
              </div>
            ) : (
              <div className="space-y-3 text-xs">
                <VersionField label="נושא"      value={selected.snapshot?.subject} />
                <VersionField label="Preheader" value={selected.snapshot?.preheader} />
                <VersionField label="כותרת"     value={selected.snapshot?.title} />
                <VersionField label="גוף (HTML)" value={selected.snapshot?.body_html} mono />
                <VersionField label="CTA label" value={selected.snapshot?.cta_label} />
                <VersionField label="CTA URL"   value={selected.snapshot?.cta_url} mono />
                <VersionField label="Footer"    value={selected.snapshot?.footer_note} />
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="px-6 py-3 border-t shrink-0 bg-white gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-xl">סגירה</Button>
          <Button
            onClick={() => selected && handleRevert(selected)}
            disabled={!selected || revert.isPending}
            className="rounded-xl gap-2"
            style={{ background: '#2D5233', color: 'white' }}>
            {revert.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
            שחזור לגרסה זו
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VersionField({ label, value, mono }) {
  if (!value) return null;
  return (
    <div>
      <div className="font-bold text-gray-700 mb-1">{label}</div>
      {mono ? (
        <Textarea value={value} readOnly rows={6} dir="ltr" className="font-mono text-[10px]" />
      ) : (
        <div className="p-2 rounded-lg bg-white border whitespace-pre-wrap">{value}</div>
      )}
    </div>
  );
}
