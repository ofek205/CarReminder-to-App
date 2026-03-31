import React from 'react';
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { ChevronRight, Gauge, Sparkles, Plus } from "lucide-react";
import StatusBadge from "../shared/StatusBadge";
import { getDateStatus } from "../shared/DateStatusUtils";
import { DEMO_VEHICLE, DEMO_TREATMENTS } from "../shared/demoVehicleData";

/**
 * DemoVehicleCard - shows the demo vehicle on the guest dashboard.
 * Mirrors the layout of VehicleStatusCard but uses static demo data.
 */
export default function DemoVehicleCard({ onAddVehicleClick }) {
  const vehicle = DEMO_VEHICLE;
  const testStatus = getDateStatus(vehicle.test_due_date);
  const insuranceStatus = getDateStatus(vehicle.insurance_due_date);

  // Next upcoming treatment
  const nextUpcoming = DEMO_TREATMENTS
    .filter(t => t.status === 'upcoming')
    .sort((a, b) => new Date(a.date) - new Date(b.date))[0];
  const maintStatus = nextUpcoming ? getDateStatus(nextUpcoming.date) : null;

  return (
    <div className="space-y-2">
      {/* Demo label strip */}
      <div className="flex items-center gap-2 px-1" dir="rtl">
        <Sparkles className="h-3.5 w-3.5 text-[#2D5233]" />
        <p className="text-xs text-[#2D5233] font-medium">
          רכב לדוגמה - כך נראה מסך הבית שלי עם הרכב שלך
        </p>
      </div>

      {/* Card - navigates to demo detail */}
      <Link to={createPageUrl('DemoVehicleDetail')}>
        <Card className="p-4 sm:p-5 hover:shadow-lg transition-all duration-300 border border-[#D8E5D9] border-dashed group cursor-pointer rounded-2xl bg-[#FDFAF7]">
          <div className="flex items-start justify-between">
            <ChevronRight className="h-5 w-5 text-gray-300 group-hover:text-[#2D5233] transition-colors mt-1 shrink-0" />
            <div className="flex items-center gap-3 flex-1 min-w-0 ml-2">
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-gray-900 text-right leading-snug">
                  <span className="block truncate">{vehicle.nickname}</span>
                  <span className="font-normal text-gray-500 text-sm block truncate">
                    {vehicle.manufacturer} {vehicle.model} {vehicle.year}
                  </span>
                </h3>
                <p className="text-xs text-gray-400 mt-0.5 text-right" dir="ltr">{vehicle.license_plate}</p>
                <div className="flex items-center gap-2 mt-1.5 justify-end">
                  <span className="text-xs text-gray-500 flex items-center gap-1">
                    <Gauge className="h-3 w-3" />
                    {vehicle.current_km.toLocaleString()} ק״מ
                  </span>
                </div>
              </div>
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-[#E8F2EA] flex items-center justify-center text-2xl shrink-0">
                🚗
              </div>
            </div>
          </div>

          <div className="flex gap-2 sm:gap-3 mt-3 flex-wrap justify-end">
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-400">טסט:</span>
              <StatusBadge status={testStatus.status} label={testStatus.label} />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-400">ביטוח:</span>
              <StatusBadge status={insuranceStatus.status} label={insuranceStatus.label} />
            </div>
            {maintStatus && (
              <div className="flex items-center gap-1">
                <span className="text-xs text-gray-400">טיפול הבא:</span>
                <StatusBadge status={maintStatus.status} label={maintStatus.label} />
              </div>
            )}
          </div>
        </Card>
      </Link>

      {/* CTA to add real vehicle */}
      <div className="flex justify-center pt-1">
        <Link to={createPageUrl('AddVehicle')}>
          <Button
            variant="outline"
            size="sm"
            className="text-[#2D5233] border-[#2D5233] gap-2 text-xs hover:bg-[#E8F2EA]"
          >
            <Plus className="h-3.5 w-3.5" />
            הוסף את הרכב שלך
          </Button>
        </Link>
      </div>
    </div>
  );
}
