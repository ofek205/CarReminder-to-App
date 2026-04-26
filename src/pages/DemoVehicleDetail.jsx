import React from 'react';
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import PageHeader from "../components/shared/PageHeader";
import StatusBadge from "../components/shared/StatusBadge";
import { getDateStatus, formatDateHe } from "../components/shared/DateStatusUtils";
import {
  DEMO_VEHICLE,
  DEMO_TREATMENTS,
  DEMO_REMINDERS,
  DEMO_DOCUMENTS,
} from "../components/shared/demoVehicleData";
import {
  Gauge,
  Calendar,
  Shield,
  Wrench,
  Plus,
  Sparkles,
  FileText,
  Bell,
  CheckCircle2,
  Clock,
  Image,
  CalendarPlus,
} from "lucide-react";

//  Calendar helper 
function downloadIcs(title, dateStr) {
  if (!dateStr) return;
  const date = dateStr.replace(/-/g, ''); // YYYYMMDD
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CarReminder//HE',
    'BEGIN:VEVENT',
    `DTSTART;VALUE=DATE:${date}`,
    `DTEND;VALUE=DATE:${date}`,
    `SUMMARY:${title}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

//  helpers 
function InfoCard({ vehicle }) {
  const testStatus = getDateStatus(vehicle.test_due_date);
  const insuranceStatus = getDateStatus(vehicle.insurance_due_date);

  return (
    <Card className="p-5 border border-gray-100" dir="ltr">
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-gray-900 text-right">
            {vehicle.nickname}
            <span className="font-normal text-gray-500 text-base mr-1">
              {' | '}
              {vehicle.manufacturer} {vehicle.model} {vehicle.year}
            </span>
          </h2>
          <p className="text-sm text-gray-500 text-right">
            {vehicle.license_plate} • {vehicle.vehicle_type} • {vehicle.year}
          </p>
          <div className="flex items-center gap-1 text-sm text-gray-500 mt-1 justify-end">
            <Gauge className="h-3.5 w-3.5" />
            {vehicle.current_km.toLocaleString()} ק״מ
          </div>
          {vehicle.notes && (
            <p className="text-xs text-gray-400 mt-1 text-right">{vehicle.notes}</p>
          )}
        </div>
        <div className="w-20 h-20 rounded-2xl bg-[#E8F2EA] flex items-center justify-center text-3xl shrink-0">
          🚗
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-5">
        <div className="p-3 rounded-xl bg-gray-50 space-y-2" dir="rtl">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-gray-400" />
            <span className="text-xs text-gray-500">טסט</span>
          </div>
          <StatusBadge status={testStatus.status} label={testStatus.label} />
          <p className="text-xs text-gray-400">תאריך: {formatDateHe(vehicle.test_due_date)}</p>
          <button
            onClick={() => downloadIcs(`טסט - ${vehicle.nickname}`, vehicle.test_due_date)}
            className="flex items-center gap-1 text-xs text-[#2D5233] hover:text-[#1E3D24] font-medium mt-1 transition-colors"
          >
            <CalendarPlus className="h-3.5 w-3.5" />
            הוסף ללוח שנה
          </button>
        </div>
        <div className="p-3 rounded-xl bg-gray-50 space-y-2" dir="rtl">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-gray-400" />
            <span className="text-xs text-gray-500">ביטוח</span>
          </div>
          <StatusBadge status={insuranceStatus.status} label={insuranceStatus.label} />
          <p className="text-xs text-gray-400">{vehicle.insurance_company} • {formatDateHe(vehicle.insurance_due_date)}</p>
          <button
            onClick={() => downloadIcs(`ביטוח - ${vehicle.nickname}`, vehicle.insurance_due_date)}
            className="flex items-center gap-1 text-xs text-[#2D5233] hover:text-[#1E3D24] font-medium mt-1 transition-colors"
          >
            <CalendarPlus className="h-3.5 w-3.5" />
            הוסף ללוח שנה
          </button>
        </div>
      </div>
    </Card>
  );
}

function RemindersCard() {
  const reminderIcons = { insurance: Shield, test: Calendar, maintenance: Wrench };

  return (
    <Card className="p-5 border border-gray-100" dir="rtl">
      <div className="flex items-center gap-2 mb-4">
        <Bell className="h-5 w-5 text-blue-500" />
        <h3 className="font-semibold text-gray-900">תזכורות</h3>
        <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-xs mr-auto">
          {DEMO_REMINDERS.length} תזכורות
        </Badge>
      </div>
      <div className="space-y-2">
        {DEMO_REMINDERS.map(reminder => {
          const status = getDateStatus(reminder.date);
          const Icon = reminderIcons[reminder.type] || Bell;
          return (
            <div
              key={reminder.id}
              className="flex items-center justify-between p-3 rounded-xl bg-gray-50"
              dir="rtl"
            >
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-gray-400" />
                <span className="text-sm font-medium text-gray-800">{reminder.title}</span>
              </div>
              <StatusBadge status={status.status} label={formatDateHe(reminder.date)} />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function TreatmentsCard() {
  const completed = DEMO_TREATMENTS.filter(t => t.status === 'completed')
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const upcoming = DEMO_TREATMENTS.filter(t => t.status === 'upcoming')
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  return (
    <Card className="p-5 border border-gray-100" dir="rtl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Wrench className="h-5 w-5 text-amber-600" />
          <h3 className="font-semibold text-gray-900">טיפולים ותיקונים</h3>
        </div>
        <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-xs">
          {DEMO_TREATMENTS.length} רשומות
        </Badge>
      </div>

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Clock className="h-3.5 w-3.5 text-blue-500" />
            <span className="text-xs font-semibold text-blue-600 uppercase tracking-wide">מתוכנן</span>
          </div>
          <div className="space-y-2">
            {upcoming.map(t => (
              <TreatmentRow key={t.id} treatment={t} />
            ))}
          </div>
        </div>
      )}

      {/* Completed */}
      {completed.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
            <span className="text-xs font-semibold text-green-600 uppercase tracking-wide">בוצע</span>
          </div>
          <div className="space-y-2">
            {completed.map(t => (
              <TreatmentRow key={t.id} treatment={t} />
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function TreatmentRow({ treatment }) {
  const isMaintenance = treatment._type === 'maintenance';
  const isUpcoming = treatment.status === 'upcoming';

  return (
    <div
      className={`border rounded-xl p-3.5 ${
        isUpcoming
          ? 'border-blue-100 bg-blue-50/40'
          : isMaintenance
          ? 'border-amber-100 bg-amber-50/30'
          : 'border-red-100 bg-red-50/30'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Badge
              className={`text-xs ${
                isMaintenance
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-red-100 text-red-700'
              }`}
            >
              {isMaintenance ? 'טיפול' : 'תיקון'}
            </Badge>
            <span className="text-sm font-semibold text-gray-900">{treatment.title}</span>
          </div>
          {treatment.notes && (
            <p className="text-xs text-gray-500 mb-1">{treatment.notes}</p>
          )}
          <div className="flex items-center gap-2 text-xs text-gray-400 flex-wrap">
            <span>{formatDateHe(treatment.date)}</span>
            {treatment.cost > 0 && (
              <>
                <span>•</span>
                <span>₪{treatment.cost.toLocaleString()}</span>
              </>
            )}
            {treatment.cost === 0 && isUpcoming && (
              <>
                <span>•</span>
                <span>ללא עלות</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DocumentsCard() {
  return (
    <Card className="p-5 border border-gray-100" dir="rtl">
      <div className="flex items-center gap-2 mb-4">
        <FileText className="h-5 w-5 text-gray-500" />
        <h3 className="font-semibold text-gray-900">מסמכים</h3>
        <Badge className="bg-gray-100 text-gray-600 text-xs mr-auto">
          {DEMO_DOCUMENTS.length} מסמכים
        </Badge>
      </div>
      <div className="space-y-2">
        {DEMO_DOCUMENTS.map(doc => {
          const status = doc.expiry_date ? getDateStatus(doc.expiry_date) : null;
          const isPdf = doc.file_type === 'pdf';
          return (
            <div
              key={doc.id}
              className="flex items-center justify-between p-3 rounded-xl bg-gray-50"
              dir="rtl"
            >
              <div className="flex items-center gap-2">
                {isPdf ? (
                  <FileText className="h-3.5 w-3.5 text-red-400" />
                ) : (
                  <Image className="h-3.5 w-3.5 text-blue-400" />
                )}
                <div>
                  <p className="text-sm font-medium text-gray-800">{doc.title}</p>
                  {doc.expiry_date && (
                    <p className="text-xs text-gray-400">תפוגה: {formatDateHe(doc.expiry_date)}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {status ? (
                  <StatusBadge status={status.status} label={status.label} />
                ) : (
                  <Badge className="bg-gray-100 text-gray-500 text-xs">ללא תפוגה</Badge>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

//  Main page 
export default function DemoVehicleDetail() {
  return (
    <div>
      <PageHeader
        title={DEMO_VEHICLE.nickname}
        backPage="Dashboard"
        actions={
          <Badge className="bg-[#E8F2EA] text-[#2D5233] border border-[#D8E5D9] gap-1.5 text-xs font-semibold px-3 py-1">
            <Sparkles className="h-3 w-3" />
            לדוגמה
          </Badge>
        }
      />

      {/* Demo notice banner */}
      <div className="mb-5 rounded-2xl p-3.5 flex items-center gap-3"
        style={{ background: 'linear-gradient(135deg, #FEF3C7, #FFF8E1)', border: '1.5px solid #FDE68A' }} dir="rtl">
        <span className="text-lg">👀</span>
        <div className="flex-1">
          <p className="text-sm font-black" style={{ color: '#92400E' }}>רכב לדוגמה</p>
          <p className="text-xs" style={{ color: '#B45309' }}>כך ייראה הניהול שלך - הוסף את כלי התחבורה האמיתי שלך כדי להתחיל</p>
        </div>
      </div>

      <div className="space-y-4">
        <InfoCard vehicle={DEMO_VEHICLE} />
        <RemindersCard />
        <TreatmentsCard />
        <DocumentsCard />

        {/* CTA */}
        <Card className="p-6 border-2 border-dashed border-[#D8E5D9] rounded-2xl bg-[#FDFAF7] text-center space-y-3">
          <div className="w-14 h-14 bg-[#E8F2EA] rounded-2xl flex items-center justify-center mx-auto text-2xl">
            🚗
          </div>
          <div dir="rtl">
            <p className="font-semibold text-gray-900">מוכן להתחיל?</p>
            <p className="text-sm text-gray-500 mt-1">
              הוסף את כלי התחבורה שלך וקבל תמונה מלאה של הבדיקות, הביטוח והטיפולים - הכל במקום אחד.
            </p>
          </div>
          <Link to={createPageUrl('AddVehicle')}>
            <Button className="bg-[#2D5233] hover:bg-[#1E3D24] text-white gap-2 shadow-md mt-1">
              <Plus className="h-4 w-4" />
              הוסף את כלי התחבורה שלך
            </Button>
          </Link>
        </Card>
      </div>
    </div>
  );
}
