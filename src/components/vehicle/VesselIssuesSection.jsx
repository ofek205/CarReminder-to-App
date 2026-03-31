import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db } from '@/lib/supabaseEntities';
import { useAuth } from '@/components/shared/GuestContext';
import { getVesselAdvice } from '@/lib/aiAdvice';
import VesselIssueDialog from './VesselIssueDialog';
import {
  Anchor, Plus, Pencil, Trash2, Check, Clock, AlertTriangle,
  CheckCircle, Calendar, ChevronDown, ChevronUp, Sparkles, Loader2,
  Search,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';

// ── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_LABELS = {
  hull: 'גוף/שלד', engine: 'מנוע', electrical: 'חשמל',
  plumbing: 'אינסטלציה', safety: 'ציוד בטיחות', rigging: 'ציוד הפלגה', other: 'אחר',
};

const CATEGORY_COLORS = {
  hull: { bg: '#E0F2F1', color: '#00695C', border: '#80CBC4' },
  engine: { bg: '#FFF3E0', color: '#E65100', border: '#FFCC80' },
  electrical: { bg: '#E3F2FD', color: '#1565C0', border: '#90CAF9' },
  plumbing: { bg: '#F3E5F5', color: '#7B1FA2', border: '#CE93D8' },
  safety: { bg: '#FCE4EC', color: '#C62828', border: '#EF9A9A' },
  rigging: { bg: '#E0F7FA', color: '#00838F', border: '#80DEEA' },
  other: { bg: '#F5F5F5', color: '#616161', border: '#E0E0E0' },
};

const PRIORITY_STYLES = {
  urgent: { bg: '#FEF2F2', color: '#DC2626', label: 'דחופה' },
  high:   { bg: '#FEF3C7', color: '#D97706', label: 'גבוהה' },
  medium: { bg: '#DBEAFE', color: '#2563EB', label: 'בינונית' },
  low:    { bg: '#F3F4F6', color: '#6B7280', label: 'נמוכה' },
};

const STATUS_STYLES = {
  'open':        { bg: '#FEF3C7', color: '#D97706', label: 'פתוח',   icon: AlertTriangle },
  'in-progress': { bg: '#E0F7FA', color: '#0C7B93', label: 'בטיפול', icon: Clock },
  'done':        { bg: '#E8F5E9', color: '#2E7D32', label: 'הושלם',  icon: CheckCircle },
};

const FILTERS = [
  { key: 'all',         label: 'הכל' },
  { key: 'open',        label: 'פתוחים' },
  { key: 'in-progress', label: 'בטיפול' },
  { key: 'done',        label: 'הושלמו' },
];

const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };
const STATUS_ORDER   = { open: 0, 'in-progress': 1, done: 2 };

function fmtDate(d) {
  if (!d) return '';
  try { return format(parseISO(d), 'dd.MM.yyyy'); } catch { return d; }
}

// ── Issue Card ───────────────────────────────────────────────────────────────

function IssueCard({ issue, onEdit, onDelete, onToggleComplete }) {
  const [expanded, setExpanded] = useState(false);
  const [adviceLoading, setAdviceLoading] = useState(false);
  const [advice, setAdvice] = useState(null);
  const [adviceError, setAdviceError] = useState(null);

  const status = STATUS_STYLES[issue.status] || STATUS_STYLES['open'];
  const priority = PRIORITY_STYLES[issue.priority] || PRIORITY_STYLES['medium'];
  const catStyle = CATEGORY_COLORS[issue.category] || CATEGORY_COLORS['other'];
  const StatusIcon = status.icon;

  const isDone = issue.status === 'done';
  const targetDays = issue.target_date ? Math.ceil((new Date(issue.target_date) - new Date()) / 86400000) : null;
  const isOverdue = targetDays !== null && targetDays < 0 && !isDone;

  const handleAdvice = async () => {
    setAdviceLoading(true);
    setAdviceError(null);
    const result = await getVesselAdvice(issue.title, issue.category, issue.description);
    if (result.advice) setAdvice(result.advice);
    else setAdviceError(result.error);
    setAdviceLoading(false);
  };

  return (
    <div
      className={`rounded-2xl mb-3 overflow-hidden transition-all ${isDone ? 'opacity-70' : ''}`}
      style={{
        background: '#fff',
        border: `1px solid ${isOverdue ? '#FECACA' : '#B2EBF2'}`,
        boxShadow: isOverdue ? '0 2px 12px rgba(220,38,38,0.08)' : '0 2px 12px rgba(12,123,147,0.06)',
      }}
      dir="rtl"
    >
      {/* Main row */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Toggle complete button */}
          <button
            onClick={() => onToggleComplete(issue)}
            className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 transition-all active:scale-95"
            style={{
              background: isDone ? '#E8F5E9' : '#E0F7FA',
              border: `1.5px solid ${isDone ? '#A5D6A7' : '#B2EBF2'}`,
            }}
          >
            {isDone ? (
              <CheckCircle className="w-4 h-4" style={{ color: '#2E7D32' }} />
            ) : (
              <div className="w-3.5 h-3.5 rounded-full border-2" style={{ borderColor: '#0C7B93' }} />
            )}
          </button>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className={`font-bold text-sm ${isDone ? 'line-through' : ''}`} style={{ color: '#0A3D4D' }}>
                {issue.title}
              </h4>
            </div>

            {/* Tags row */}
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              {/* Status badge */}
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-lg flex items-center gap-1"
                style={{ background: status.bg, color: status.color }}>
                <StatusIcon className="w-3 h-3" />
                {status.label}
              </span>

              {/* Priority badge */}
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-lg"
                style={{ background: priority.bg, color: priority.color }}>
                {priority.label}
              </span>

              {/* Category tag */}
              {issue.category && (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-lg"
                  style={{ background: catStyle.bg, color: catStyle.color, border: `1px solid ${catStyle.border}` }}>
                  {CATEGORY_LABELS[issue.category]}
                </span>
              )}

              {/* Target date */}
              {issue.target_date && !isDone && (
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-lg flex items-center gap-1`}
                  style={{
                    background: isOverdue ? '#FEF2F2' : '#F0F9FF',
                    color: isOverdue ? '#DC2626' : '#0369A1',
                  }}>
                  <Calendar className="w-3 h-3" />
                  {fmtDate(issue.target_date)}
                </span>
              )}
            </div>

            {/* Date info */}
            <p className="text-[11px] mt-1" style={{ color: '#6B9EA8' }}>
              נוצר {fmtDate(issue.created_date)}
              {issue.completed_date && ` · הושלם ${fmtDate(issue.completed_date)}`}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => setExpanded(!expanded)}
              className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
              style={{ background: expanded ? '#E0F7FA' : 'transparent' }}>
              {expanded ? <ChevronUp className="w-4 h-4" style={{ color: '#0C7B93' }} /> : <ChevronDown className="w-4 h-4" style={{ color: '#6B9EA8' }} />}
            </button>
            <button onClick={() => onEdit(issue)}
              className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-gray-50">
              <Pencil className="w-3.5 h-3.5" style={{ color: '#6B9EA8' }} />
            </button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-red-50">
                  <Trash2 className="w-3.5 h-3.5" style={{ color: '#EF4444' }} />
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent dir="rtl">
                <AlertDialogHeader>
                  <AlertDialogTitle>מחיקת תקלה</AlertDialogTitle>
                  <AlertDialogDescription>האם למחוק את "{issue.title}"? לא ניתן לבטל.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="flex-row-reverse gap-2">
                  <AlertDialogAction onClick={() => onDelete(issue.id)} className="bg-red-600 hover:bg-red-700">מחק</AlertDialogAction>
                  <AlertDialogCancel>ביטול</AlertDialogCancel>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>

      {/* Expanded section */}
      {expanded && (
        <div className="px-4 pb-4 pt-0 border-t" style={{ borderColor: '#E0F7FA' }}>
          {/* Description */}
          {issue.description && (
            <p className="text-sm mt-3 leading-relaxed" style={{ color: '#0A3D4D' }}>
              {issue.description}
            </p>
          )}

          {/* AI Advice section */}
          <div className="mt-3">
            {!advice && !adviceError && (
              <button
                onClick={handleAdvice}
                disabled={adviceLoading}
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all active:scale-[0.98] disabled:opacity-50"
                style={{ background: '#E0F7FA', color: '#0C7B93', border: '1px solid #B2EBF2' }}>
                {adviceLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                {adviceLoading ? 'מקבל ייעוץ...' : 'קבל ייעוץ AI'}
              </button>
            )}

            {advice && (
              <div className="rounded-xl p-3 mt-2" style={{ background: '#F0FDFA', border: '1px solid #99F6E4' }}>
                <div className="flex items-center gap-1.5 mb-2">
                  <Sparkles className="w-3.5 h-3.5" style={{ color: '#0D9488' }} />
                  <span className="text-xs font-bold" style={{ color: '#0D9488' }}>ייעוץ AI</span>
                </div>
                <p className="text-sm leading-relaxed" style={{ color: '#134E4A' }}>{advice}</p>
              </div>
            )}

            {adviceError && (
              <div className="rounded-xl p-3 mt-2" style={{ background: '#FEF2F2', border: '1px solid #FECACA' }}>
                <p className="text-xs" style={{ color: '#DC2626' }}>{adviceError}</p>
                <button onClick={handleAdvice} className="text-xs underline mt-1" style={{ color: '#DC2626' }}>
                  נסה שוב
                </button>
              </div>
            )}

            {/* Google search fallback */}
            <a
              href={`https://www.google.com/search?q=${encodeURIComponent(`${issue.title} כלי שייט ${CATEGORY_LABELS[issue.category] || ''} תיקון`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs font-medium mt-2 hover:underline"
              style={{ color: '#0C7B93' }}>
              <Search className="w-3 h-3" />
              חפש באינטרנט
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ onAdd }) {
  return (
    <div className="text-center py-8" dir="rtl">
      <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
        style={{ background: '#E0F7FA' }}>
        <Anchor className="w-8 h-8" style={{ color: '#0C7B93', opacity: 0.5 }} />
      </div>
      <h4 className="font-bold text-sm mb-1" style={{ color: '#0A3D4D' }}>אין תקלות רשומות</h4>
      <p className="text-xs mb-4" style={{ color: '#6B9EA8' }}>
        הוסף תקלות ופגמים כדי לעקוב אחרי מצב כלי השייט
      </p>
      <button
        onClick={onAdd}
        className="px-5 py-2.5 rounded-2xl font-bold text-sm transition-all active:scale-[0.98] text-white"
        style={{ background: '#0C7B93', boxShadow: '0 4px 12px rgba(12,123,147,0.25)' }}>
        <Plus className="w-4 h-4 inline ml-1" />
        הוסף תקלה ראשונה
      </button>
    </div>
  );
}

// ── Main Section Component ───────────────────────────────────────────────────

export default function VesselIssuesSection({ vehicle, isGuest }) {
  const queryClient = useQueryClient();
  const { user, guestVesselIssues, addGuestVesselIssue, updateGuestVesselIssue, removeGuestVesselIssue } = useAuth();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingIssue, setEditingIssue] = useState(null);
  const [filter, setFilter] = useState('all');

  // ── Data loading ─────────────────────────────────────────────────────────
  const { data: authIssues = [], isLoading } = useQuery({
    queryKey: ['vessel_issues', vehicle.id],
    queryFn: () => db.vessel_issues.filter({ vehicle_id: vehicle.id }),
    enabled: !isGuest && !!vehicle.id,
    staleTime: 0,
  });

  const issues = isGuest
    ? (guestVesselIssues || []).filter(i => i.vehicle_id === vehicle.id)
    : authIssues;

  // ── Sort: status order → priority order → date desc ─────────────────────
  const sorted = [...issues].sort((a, b) => {
    const sDiff = (STATUS_ORDER[a.status] || 0) - (STATUS_ORDER[b.status] || 0);
    if (sDiff !== 0) return sDiff;
    const pDiff = (PRIORITY_ORDER[a.priority] || 2) - (PRIORITY_ORDER[b.priority] || 2);
    if (pDiff !== 0) return pDiff;
    return (b.created_date || '').localeCompare(a.created_date || '');
  });

  const filtered = filter === 'all' ? sorted : sorted.filter(i => i.status === filter);

  // ── Counts ──────────────────────────────────────────────────────────────
  const counts = { all: issues.length, open: 0, 'in-progress': 0, done: 0 };
  issues.forEach(i => { if (counts[i.status] !== undefined) counts[i.status]++; });

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleSave = async (formData) => {
    if (isGuest) {
      if (editingIssue) {
        updateGuestVesselIssue(editingIssue.id, formData);
      } else {
        addGuestVesselIssue({ ...formData, vehicle_id: vehicle.id });
      }
    } else {
      if (editingIssue) {
        await db.vessel_issues.update(editingIssue.id, formData);
      } else {
        await db.vessel_issues.create({
          ...formData,
          vehicle_id: vehicle.id,
          account_id: vehicle.account_id,
          created_date: new Date().toISOString(),
        });
      }
      queryClient.invalidateQueries({ queryKey: ['vessel_issues', vehicle.id] });
    }
  };

  const handleDelete = async (id) => {
    if (isGuest) {
      removeGuestVesselIssue(id);
    } else {
      await db.vessel_issues.delete(id);
      queryClient.invalidateQueries({ queryKey: ['vessel_issues', vehicle.id] });
    }
  };

  const handleToggleComplete = async (issue) => {
    const newStatus = issue.status === 'done' ? 'open' : 'done';
    const changes = {
      status: newStatus,
      completed_date: newStatus === 'done' ? new Date().toISOString().split('T')[0] : null,
    };
    if (isGuest) {
      updateGuestVesselIssue(issue.id, changes);
    } else {
      await db.vessel_issues.update(issue.id, changes);
      queryClient.invalidateQueries({ queryKey: ['vessel_issues', vehicle.id] });
    }
  };

  const openAdd = () => { setEditingIssue(null); setDialogOpen(true); };
  const openEdit = (issue) => { setEditingIssue(issue); setDialogOpen(true); };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="rounded-2xl overflow-hidden"
      style={{ background: '#fff', border: '1px solid #B2EBF2', boxShadow: '0 2px 16px rgba(12,123,147,0.08)' }}>

      {/* Header */}
      <div className="p-4 flex items-center justify-between"
        style={{ background: 'linear-gradient(135deg, #E0F7FA 0%, #fff 100%)' }}
        dir="rtl">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: '#0C7B93', boxShadow: '0 4px 12px rgba(12,123,147,0.25)' }}>
            <Anchor className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-black text-sm" style={{ color: '#0A3D4D' }}>תקלות ופגמים</h3>
            <p className="text-[11px] font-medium" style={{ color: '#6B9EA8' }}>
              {counts.open > 0 ? `${counts.open} פתוחים` : 'אין תקלות פתוחות'}
              {counts['in-progress'] > 0 && ` · ${counts['in-progress']} בטיפול`}
            </p>
          </div>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-bold text-xs transition-all active:scale-[0.98] text-white"
          style={{ background: '#0C7B93', boxShadow: '0 3px 10px rgba(12,123,147,0.25)' }}>
          <Plus className="w-3.5 h-3.5" />
          חדשה
        </button>
      </div>

      {/* Filter tabs */}
      {issues.length > 0 && (
        <div className="px-4 pt-3 pb-1 flex gap-1.5 flex-wrap" dir="rtl">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
              style={{
                background: filter === f.key ? '#0C7B93' : '#F0F9FF',
                color: filter === f.key ? '#fff' : '#0C7B93',
              }}>
              {f.label}
              {counts[f.key] > 0 && ` (${counts[f.key]})`}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="p-4 pt-2">
        {isLoading ? (
          <div className="text-center py-6">
            <Loader2 className="w-6 h-6 animate-spin mx-auto" style={{ color: '#0C7B93' }} />
          </div>
        ) : issues.length === 0 ? (
          <EmptyState onAdd={openAdd} />
        ) : filtered.length === 0 ? (
          <p className="text-center py-6 text-xs" style={{ color: '#6B9EA8' }} dir="rtl">
            אין תקלות בסטטוס זה
          </p>
        ) : (
          filtered.map(issue => (
            <IssueCard
              key={issue.id}
              issue={issue}
              onEdit={openEdit}
              onDelete={handleDelete}
              onToggleComplete={handleToggleComplete}
            />
          ))
        )}
      </div>

      {/* Dialog */}
      <VesselIssueDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        issue={editingIssue}
        onSave={handleSave}
      />
    </div>
  );
}
