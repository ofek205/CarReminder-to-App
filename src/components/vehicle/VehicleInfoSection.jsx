import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import StatusBadge from "../shared/StatusBadge";
import { getDateStatus, formatDateHe, getVehicleTypeIcon, usesKm, usesHours, isVessel, isOffroad, getVehicleLabels } from "../shared/DateStatusUtils";
import { OFFROAD_EQUIPMENT, OFFROAD_USAGE_TYPES } from "../vehicle/VehicleTypeSelector";
import { COUNTRIES } from "../vehicle/CountryFlagSelect";
import { Gauge, Clock, Calendar, Shield, Download, ChevronDown, ChevronUp, CheckCircle2, XCircle, AlertCircle, MinusCircle, ClipboardList, Fuel, Info, Hash, Tag, Palette, Building2, Cog } from "lucide-react";
import MileageUpdateWidget from "./MileageUpdateWidget";
import { getTheme } from '@/lib/designTokens';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { toast } from "sonner";

function generateICS(title, description, eventDate, reminderDays) {
  const date = parseISO(eventDate);
  const startDateTime = format(date, "yyyyMMdd'T'080000");
  const endDateTime = format(date, "yyyyMMdd'T'090000");

  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vehicle Manager//Reminder//HE',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `DTSTART;TZID=Asia/Jerusalem:${startDateTime}`,
    `DTEND;TZID=Asia/Jerusalem:${endDateTime}`,
    `SUMMARY:${title}`, `DESCRIPTION:${description}`,
    'BEGIN:VALARM', `TRIGGER:-P${reminderDays}D`, 'ACTION:DISPLAY',
    `DESCRIPTION:${title}`, 'END:VALARM',
    'STATUS:CONFIRMED', 'SEQUENCE:0', 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

function downloadICS(filename, icsContent) {
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

function generateGoogleCalendarLink(title, description, eventDate) {
  const date = parseISO(eventDate);
  const startDateTime = format(date, "yyyyMMdd'T'080000");
  const endDateTime = format(date, "yyyyMMdd'T'090000");
  const params = new URLSearchParams({
    action: 'TEMPLATE', text: title, details: description,
    dates: `${startDateTime}/${endDateTime}`, ctz: 'Asia/Jerusalem',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function AddToCalendarButton({ dateField, vehicle, T }) {
  const [open, setOpen] = useState(false);
  const labels = getVehicleLabels(vehicle.vehicle_type, vehicle.nickname);

  const handleAddToCalendar = (eventType) => {
    if (!vehicle[dateField]) return;
    const isTest = dateField === 'test_due_date';
    const titlePrefix = isTest ? labels.testWord : 'חידוש ביטוח';
    const reminderDays = 14;
    const title = `${titlePrefix} ל${labels.vehicleWord} ${vehicle.nickname || vehicle.license_plate}`;
    let description = `תזכורת ${titlePrefix} ל${labels.vehicleWord} ${vehicle.manufacturer} ${vehicle.model} (${vehicle.license_plate}).`;
    if (!isTest && vehicle.insurance_company) description += ` חברת ביטוח: ${vehicle.insurance_company}.`;
    description += ' נוצר מהאפליקציה.';

    if (eventType === 'ics') {
      const icsContent = generateICS(title, description, vehicle[dateField], reminderDays);
      downloadICS(`${isTest ? 'test' : 'insurance'}-reminder-${vehicle.license_plate}.ics`, icsContent);
    } else {
      window.open(generateGoogleCalendarLink(title, description, vehicle[dateField]), '_blank', 'noopener,noreferrer');
    }
    toast.success('אירוע נוסף ליומן');
    setOpen(false);
  };

  if (!vehicle[dateField]) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-xl transition-all active:scale-[0.97]"
          style={{ background: T.light, color: T.primary, border: `1px solid ${T.border}` }}>
          <Calendar className="h-3 w-3" />
          הוסף ליומן
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-2" align="start">
        <div className="flex flex-col gap-1">
          <Button variant="ghost" size="sm" className="justify-end gap-2 text-sm"
            style={{ '--hover-bg': T.light }}
            onClick={() => handleAddToCalendar('google')}>
            <Calendar className="h-4 w-4" /> Google Calendar
          </Button>
          <Button variant="ghost" size="sm" className="justify-end gap-2 text-sm"
            onClick={() => handleAddToCalendar('ics')}>
            <Download className="h-4 w-4" /> הורד קובץ ICS
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Status Card (clean, white-based with colored accent) ─────────────────────
function StatusCard({ icon: Icon, label, status, dateField, vehicle, T, vesselMode, subtitle }) {
  const isMissing = !vehicle[dateField];

  const STATUS_ACCENT = {
    ok:      { color: '#16A34A', bg: '#F0FDF4', border: '#BBF7D0' },
    warn:    { color: '#D97706', bg: '#FFFBEB', border: '#FDE68A' },
    danger:  { color: '#DC2626', bg: '#FEF2F2', border: '#FECACA' },
    missing: { color: '#9CA3AF', bg: '#F9FAFB', border: '#E5E7EB' },
  };

  const st = isMissing ? 'missing' : (status.status || 'missing');
  const accent = STATUS_ACCENT[st] || STATUS_ACCENT.missing;

  return (
    <div className="rounded-2xl p-4 space-y-2.5"
      style={{ background: '#FFFFFF', border: `1.5px solid ${accent.border}`, borderRight: `4px solid ${accent.color}`, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4" style={{ color: accent.color }} />
        <span className="text-sm font-bold" style={{ color: '#374151' }}>{label}</span>
      </div>
      {subtitle && (
        <p className="text-xs font-medium" style={{ color: '#9CA3AF' }}>{subtitle}</p>
      )}

      {isMissing ? (
        <p className="text-sm font-medium" style={{ color: '#9CA3AF' }}>לא הוזן</p>
      ) : (
        <>
          <StatusBadge status={status.status} label={status.label} />
          <AddToCalendarButton dateField={dateField} vehicle={vehicle} T={T} />
        </>
      )}
    </div>
  );
}

// ── Info Row ────────────────────────────────────────────────────────────────
function InfoRow({ label, value, T }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between py-2.5 px-1"
      style={{ borderBottom: `1px solid ${T.border}40` }}>
      <span className="text-xs font-medium" style={{ color: T.muted }}>{label}</span>
      <span className="text-sm font-bold" style={{ color: T.text }}>{value}</span>
    </div>
  );
}

// ── Vessel Inspection Readiness Checklist ─────────────────────────────────────
function statusIcon(status) {
  if (status === 'ok')     return <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />;
  if (status === 'danger') return <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
  if (status === 'warn')   return <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />;
  return <MinusCircle className="h-4 w-4 text-gray-300 shrink-0" />;
}

function statusLabel(status, label, fieldMissing) {
  if (fieldMissing) return <span className="text-gray-400 text-xs">לא הוזן</span>;
  const color = status === 'ok' ? 'text-emerald-600' : status === 'danger' ? 'text-red-600' : status === 'warn' ? 'text-amber-600' : 'text-gray-400';
  return <span className={`text-xs font-medium ${color}`}>{label}</span>;
}

function VesselInspectionChecklist({ vehicle, T }) {
  const [open, setOpen] = useState(false);

  const testSt  = getDateStatus(vehicle.test_due_date);
  const insSt   = getDateStatus(vehicle.insurance_due_date);
  const pyroSt  = getDateStatus(vehicle.pyrotechnics_expiry_date);
  const extSt   = getDateStatus(vehicle.fire_extinguisher_expiry_date);
  const raftSt  = getDateStatus(vehicle.life_raft_expiry_date);

  const tracked = [
    { label: 'רישיון כושר שייט בתוקף',      st: testSt, has: !!vehicle.test_due_date, key: 'test' },
    { label: 'ביטוח צד ג׳ תוספת 14 בתוקף', st: insSt,  has: !!vehicle.insurance_due_date, key: 'ins' },
    { label: 'פירוטכניקה בתוקף',             st: pyroSt, has: !!vehicle.pyrotechnics_expiry_date, key: 'pyro' },
    { label: 'מטף כיבוי בתוקף',              st: extSt,  has: !!vehicle.fire_extinguisher_expiry_date, key: 'ext' },
    { label: 'אסדת הצלה בתוקף',              st: raftSt, has: !!vehicle.life_raft_expiry_date, key: 'raft' },
  ];

  const readyCount  = tracked.filter(i => i.has && i.st.status === 'ok').length;
  const warnCount   = tracked.filter(i => i.has && (i.st.status === 'warn' || i.st.status === 'danger')).length;
  const totalTracked = tracked.filter(i => i.has).length;

  const headerBg = warnCount > 0
    ? { bg: '#FEF3C7', border: '#FDE68A', text: '#92400E' }
    : readyCount === tracked.length
    ? { bg: T.light, border: T.border, text: T.primary }
    : { bg: T.light, border: T.border, text: T.primary };

  return (
    <div className="rounded-2xl overflow-hidden" dir="rtl"
      style={{ background: headerBg.bg, border: `1.5px solid ${headerBg.border}` }}>
      <button className="w-full flex items-center justify-between px-4 py-3.5 gap-3"
        onClick={() => setOpen(o => !o)}>
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 shrink-0" style={{ color: headerBg.text }} />
          <span className="text-sm font-bold" style={{ color: headerBg.text }}>מוכנות לבדיקת כושר שייט</span>
        </div>
        <div className="flex items-center gap-2">
          {totalTracked > 0 && (
            <span className="text-xs font-bold tabular-nums" style={{ color: headerBg.text }}>
              {readyCount}/{tracked.length}
            </span>
          )}
          {open
            ? <ChevronUp className="h-4 w-4" style={{ color: headerBg.text }} />
            : <ChevronDown className="h-4 w-4" style={{ color: headerBg.text }} />}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          <div className="space-y-2">
            {tracked.map(item => (
              <div key={item.key} className="flex items-center justify-between rounded-xl px-3 py-2.5"
                style={{ background: '#FFFFFF', border: `1px solid ${T.border}` }}>
                <div className="flex items-center gap-2 min-w-0">
                  {statusIcon(item.has ? item.st.status : 'neutral')}
                  <span className="text-xs font-medium truncate" style={{ color: T.text }}>{item.label}</span>
                </div>
                <div className="shrink-0 mr-2">
                  {statusLabel(item.st.status, item.st.label, !item.has)}
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-xl p-3" style={{ background: '#FFFFFF', border: `1.5px dashed ${T.border}` }}>
            <p className="text-[11px] font-bold mb-2 flex items-center gap-1" style={{ color: T.primary }}>
              📌 נדרש גם להביא לבדיקה:
            </p>
            <ul className="space-y-1.5 text-xs" style={{ color: T.muted }}>
              {['תעודת רישום — לכלי שייט שאורכם מעל 7 מטר',
                'בדיקת מערכות — מנוע, הגה, ציוד ניווט',
                '3 צילומי השייט — מדופן שמאל · מדופן ימין · ירכתיים',
                'רישיון השייט — לאחר תשלום ואישור בנק הדואר (ללא נספח עליון)']
                .map((text, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="mt-0.5 shrink-0" style={{ color: T.primary }}>•</span>
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-1.5 text-[11px] pt-3" style={{ color: T.muted, borderTop: `1px solid ${T.border}` }}>
            <p>⚠️ <span className="font-semibold">מומלץ לבצע לפני פקיעת הרישיון הקודם</span></p>
            <p>💡 כלי שייט <span className="font-semibold">פרטיים ומסחריים</span> — תדירות שנתית.</p>
            <p>🔁 בדיקה חוזרת כרוכה בתשלום אגרה נוספת.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export default function VehicleInfoSection({ vehicle }) {
  const T = getTheme(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);
  const testStatus = getDateStatus(vehicle.test_due_date);
  const insuranceStatus = getDateStatus(vehicle.insurance_due_date);
  const vesselMode = isVessel(vehicle.vehicle_type, vehicle.nickname);
  const offroadMode = isOffroad(vehicle.vehicle_type);
  const labels = getVehicleLabels(vehicle.vehicle_type, vehicle.nickname);
  const pyroStatus     = vesselMode ? getDateStatus(vehicle.pyrotechnics_expiry_date) : null;
  const extStatus      = vesselMode ? getDateStatus(vehicle.fire_extinguisher_expiry_date) : null;
  const lifeRaftStatus = vesselMode ? getDateStatus(vehicle.life_raft_expiry_date) : null;

  return (
    <div className="space-y-4" dir="rtl">

      {/* ── Vintage badge ── */}
      {vehicle.is_vintage && !vesselMode && (
        <div className="rounded-2xl px-4 py-3 flex items-center gap-2.5"
          style={{ background: 'linear-gradient(135deg, #F5F3FF 0%, #EDE9FE 100%)', border: '1.5px solid #DDD6FE' }}>
          <span className="text-lg">🏛️</span>
          <span className="text-sm font-bold" style={{ color: '#7C3AED' }}>רכב אספנות — טסט כל חצי שנה</span>
        </div>
      )}

      {/* ── Mileage / Engine hours ── */}
      <MileageUpdateWidget vehicle={vehicle} />

      {/* ── Test & Insurance Status ── */}
      <div className="grid grid-cols-2 gap-3">
        <StatusCard
          icon={Calendar}
          label={labels.testWord}
          status={testStatus}
          dateField="test_due_date"
          vehicle={vehicle}
          T={T}
          vesselMode={vesselMode}
        />
        <StatusCard
          icon={Shield}
          label={vesselMode ? 'ביטוח ימי' : 'ביטוח'}
          subtitle={vehicle.insurance_company}
          status={insuranceStatus}
          dateField="insurance_due_date"
          vehicle={vehicle}
          T={T}
          vesselMode={vesselMode}
        />
      </div>

      {/* ── Vessel-specific sections ── */}
      {vesselMode && (
        <>
          {/* Flag + engine info */}
          {(vehicle.flag_country || vehicle.engine_manufacturer) && (
            <div className="rounded-2xl p-4 space-y-2" style={{ background: '#fff', border: `1.5px solid ${T.border}` }}>
              {vehicle.flag_country && (() => {
                const country = COUNTRIES.find(c => c.code === vehicle.flag_country);
                return country ? (
                  <div className="flex items-center justify-between" dir="rtl">
                    <span className="text-sm font-medium" style={{ color: T.muted }}>דגל רישום</span>
                    <span className="text-sm font-bold" style={{ color: T.text }}>{country.flag} {country.name}</span>
                  </div>
                ) : null;
              })()}
              {vehicle.engine_manufacturer && (
                <div className="flex items-center justify-between" dir="rtl">
                  <span className="text-sm font-medium" style={{ color: T.muted }}>יצרן מנוע</span>
                  <span className="text-sm font-bold" style={{ color: T.text }}>{vehicle.engine_manufacturer}</span>
                </div>
              )}
            </div>
          )}
          {/* Safety equipment */}
          {(vehicle.pyrotechnics_expiry_date || vehicle.fire_extinguisher_expiry_date || vehicle.life_raft_expiry_date) && (
            <div className="rounded-2xl p-4" style={{ background: T.light, border: `1.5px solid ${T.border}` }}>
              <div className="flex items-center gap-1.5 mb-3">
                <span className="text-sm">⚓</span>
                <span className="text-sm font-bold" style={{ color: T.text }}>ציוד בטיחות</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {vehicle.pyrotechnics_expiry_date && (
                  <div className="rounded-xl p-3 space-y-2" style={{ background: T.card, border: `1px solid ${T.border}` }}>
                    <span className="text-xs font-medium flex items-center gap-1" style={{ color: T.muted }}>🔴 פירוטכניקה</span>
                    <StatusBadge status={pyroStatus.status} label={pyroStatus.label} />
                  </div>
                )}
                {vehicle.fire_extinguisher_expiry_date && (
                  <div className="rounded-xl p-3 space-y-2" style={{ background: T.card, border: `1px solid ${T.border}` }}>
                    <span className="text-xs font-medium flex items-center gap-1" style={{ color: T.muted }}>🧯 מטף כיבוי</span>
                    <StatusBadge status={extStatus.status} label={extStatus.label} />
                  </div>
                )}
                {vehicle.life_raft_expiry_date && (
                  <div className="rounded-xl p-3 space-y-2" style={{ background: T.card, border: `1px solid ${T.border}` }}>
                    <span className="text-xs font-medium flex items-center gap-1" style={{ color: T.muted }}>🛟 אסדת הצלה</span>
                    <StatusBadge status={lifeRaftStatus.status} label={lifeRaftStatus.label} />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Inspection checklist */}
          <VesselInspectionChecklist vehicle={vehicle} T={T} />
        </>
      )}

      {/* ── Off-road equipment display ── */}
      {(offroadMode || vehicle.offroad_equipment?.length > 0) && (
        <>
          {vehicle.offroad_equipment?.length > 0 && (
            <div className="rounded-2xl p-4" style={{ background: T.light, border: `1.5px solid ${T.border}` }}>
              <div className="flex items-center gap-1.5 mb-3">
                <span className="text-sm">🏔️</span>
                <span className="text-sm font-bold" style={{ color: T.text }}>ציוד שטח</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {vehicle.offroad_equipment.map(key => {
                  const eq = OFFROAD_EQUIPMENT.find(e => e.key === key);
                  return eq ? (
                    <span key={key} className="px-2.5 py-1 rounded-full text-xs font-medium"
                      style={{ background: '#fff', color: T.primary, border: `1px solid ${T.border}` }}>
                      {eq.label}
                    </span>
                  ) : null;
                })}
              </div>
            </div>
          )}
          {(vehicle.offroad_usage_type || vehicle.last_offroad_service_date) && (
            <div className="rounded-2xl p-4 space-y-2" style={{ background: '#fff', border: `1.5px solid ${T.border}` }}>
              {vehicle.offroad_usage_type && (
                <div className="flex items-center justify-between" dir="rtl">
                  <span className="text-sm font-medium" style={{ color: T.muted }}>סוג שימוש</span>
                  <span className="text-sm font-bold" style={{ color: T.text }}>
                    {OFFROAD_USAGE_TYPES.find(t => t.value === vehicle.offroad_usage_type)?.label || vehicle.offroad_usage_type}
                  </span>
                </div>
              )}
              {vehicle.last_offroad_service_date && (
                <div className="flex items-center justify-between" dir="rtl">
                  <span className="text-sm font-medium" style={{ color: T.muted }}>טיפול שטח אחרון</span>
                  <span className="text-sm font-bold" style={{ color: T.text }}>{formatDateHe(vehicle.last_offroad_service_date)}</span>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
