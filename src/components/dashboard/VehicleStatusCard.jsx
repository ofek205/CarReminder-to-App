import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import StatusBadge from "../shared/StatusBadge";
import { getDateStatus, getVehicleTypeIcon, usesKm, getVehicleLabels, isVessel } from "../shared/DateStatusUtils";
import { getCatalogForVehicleType, getMaintenanceStatus } from "../shared/MaintenanceCatalog";
import { getTheme } from '@/lib/designTokens';
import { ChevronRight, Gauge, Clock, Wrench } from "lucide-react";

function getNextMaintenanceInfo(vehicle, maintenanceLogs, allTemplates) {
  const catalog = getCatalogForVehicleType(vehicle.vehicle_type);
  const today = new Date();

  let nearest = null; // { date, status }

  catalog.forEach((item) => {
    const matchedLogs = maintenanceLogs.filter((log) => {
      const tmpl = allTemplates.find((t) => t.id === log.template_id);
      return tmpl?.name === item.name;
    }).sort((a, b) => new Date(b.performed_at) - new Date(a.performed_at));

    const lastLog = matchedLogs[0];
    if (!lastLog || !lastLog.performed_at || !item.months) return;

    const nextDate = new Date(lastLog.performed_at);
    nextDate.setMonth(nextDate.getMonth() + item.months);

    if (!nearest || nextDate < nearest.date) {
      const diffDays = Math.floor((nextDate - today) / (1000 * 60 * 60 * 24));
      let status;
      if (diffDays < 0) status = 'danger';else
      if (diffDays <= 30) status = 'warning';else
      status = 'ok';
      nearest = { date: nextDate, diffDays, status };
    }
  });

  if (!nearest) return { status: 'neutral', label: 'אין מידע' };

  const { date, diffDays, status } = nearest;
  let label;
  if (diffDays < 0) {
    label = `עבר לפני ${Math.abs(diffDays)} ימים`;
  } else if (diffDays === 0) {
    label = 'היום';
  } else if (diffDays <= 30) {
    label = `בעוד ${diffDays} ימים`;
  } else {
    const d = date.toLocaleDateString('he-IL', { month: 'short', year: '2-digit' });
    label = d;
  }

  return { status, label };
}

export default function VehicleStatusCard({ vehicle }) {
  // Maintenance data disabled - not yet migrated from Base44
  const { data: maintenanceLogs = [] } = useQuery({
    queryKey: ['maintenance-logs-dash', vehicle.id],
    queryFn: async () => {
      try {
        // TODO: migrate MaintenanceLog entity to Supabase
        return [];
      } catch (e) { return []; }
    },
  });

  const { data: allTemplates = [] } = useQuery({
    queryKey: ['templates-all-dash'],
    queryFn: async () => {
      try {
        // TODO: migrate MaintenanceTemplate entity to Supabase
        return [];
      } catch (e) { return []; }
    },
  });

  const testStatus = getDateStatus(vehicle.test_due_date);
  const insuranceStatus = getDateStatus(vehicle.insurance_due_date);
  const maintStatus = getNextMaintenanceInfo(vehicle, maintenanceLogs, allTemplates);
  const icon = getVehicleTypeIcon(vehicle.vehicle_type);
  const labels = getVehicleLabels(vehicle.vehicle_type, vehicle.nickname);
  const T = getTheme(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);
  const vesselMode = isVessel(vehicle.vehicle_type, vehicle.nickname);

  return (
    <Link to={createPageUrl(`VehicleDetail?id=${vehicle.id}`)}>
      <Card className="p-4 sm:p-5 hover:shadow-lg transition-all duration-300 border border-gray-100 group cursor-pointer card-hover rounded-2xl">
        <div className="flex items-start justify-between">
          <ChevronRight className="h-5 w-5 text-gray-300 transition-colors mt-1 shrink-0" style={{ '--tw-text-opacity': 1 }} />
          <div className="flex items-center gap-3 flex-1 min-w-0 ml-2">
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-gray-900 text-right leading-snug">
                {vehicle.nickname && <span className="block truncate">{vehicle.nickname}</span>}
                {[vehicle.manufacturer, vehicle.model, vehicle.year].filter(Boolean).length > 0 &&
                  <span className="font-normal text-gray-500 text-sm block truncate">
                    {[vehicle.manufacturer, vehicle.model, vehicle.year].filter(Boolean).join(' ')}
                  </span>
                }
              </h3>
              <p className="text-xs text-gray-400 mt-0.5 text-right">{vehicle.license_plate}</p>
              <div className="flex items-center gap-2 mt-1.5 justify-end flex-wrap">
                {usesKm(vehicle.vehicle_type, vehicle.nickname) && vehicle.current_km &&
                <span className="text-xs text-gray-500 flex items-center gap-1">
                    <Gauge className="h-3 w-3" />
                    {vehicle.current_km.toLocaleString()} ק״מ
                  </span>
                }
                {vehicle.current_engine_hours &&
                <span className="text-xs text-gray-500 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {vehicle.current_engine_hours} שעות
                  </span>
                }
              </div>
            </div>
            {vehicle.vehicle_photo ?
            <img src={vehicle.vehicle_photo} alt="" loading="lazy" decoding="async" className="bg-gray-100 rounded-xl w-14 h-14 sm:w-16 sm:h-16 object-cover shrink-0" /> :
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-gray-50 flex items-center justify-center text-2xl shrink-0">
                {icon}
              </div>
            }
          </div>
        </div>
        <div className="flex gap-2 sm:gap-3 mt-3 flex-wrap justify-end">
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-400">{labels.testWord}:</span>
            <StatusBadge status={testStatus.status} label={testStatus.label} />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-400">{labels.insuranceWord || 'ביטוח'}:</span>
            <StatusBadge status={insuranceStatus.status} label={insuranceStatus.label} />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-400">טיפול הבא:</span>
            <StatusBadge status={maintStatus.status} label={maintStatus.label} />
          </div>
        </div>
      </Card>
    </Link>);
}