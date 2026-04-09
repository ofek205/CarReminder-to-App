import React from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Wrench, ChevronLeft, Clock, AlertTriangle } from 'lucide-react';
import { getTheme } from '@/lib/designTokens';
import { getCatalogForVehicleType } from '../shared/MaintenanceCatalog';
import { formatDateHe } from '../shared/DateStatusUtils';

export default function MaintenanceSection({ vehicle }) {
  const T = getTheme(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);
  const catalogItems = getCatalogForVehicleType(vehicle.vehicle_type);

  // Calculate next due dates based on catalog intervals
  const now = new Date();
  const items = catalogItems.slice(0, 6).map(item => {
    const monthsInterval = item.months || 12;
    return {
      name: item.name,
      interval: item.km
        ? `כל ${item.km.toLocaleString()} ק"מ / ${monthsInterval} חודשים`
        : `כל ${monthsInterval} חודשים`,
    };
  });

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: '#fff', border: `1.5px solid ${T.border}` }} dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3" style={{ background: T.light }}>
        <div className="flex items-center gap-2">
          <Wrench className="w-4 h-4" style={{ color: T.primary }} />
          <span className="text-sm font-black" style={{ color: T.text }}>לוח תחזוקה</span>
        </div>
        <Link to={createPageUrl('MaintenanceTemplates')}
          className="text-xs font-bold flex items-center gap-1" style={{ color: T.primary }}>
          ניהול מלא <ChevronLeft className="w-3 h-3" />
        </Link>
      </div>

      {/* Catalog items */}
      {items.length === 0 ? (
        <div className="py-8 text-center">
          <Wrench className="w-8 h-8 mx-auto mb-2" style={{ color: T.muted, opacity: 0.4 }} />
          <p className="text-sm font-medium" style={{ color: T.muted }}>אין פריטי תחזוקה</p>
        </div>
      ) : (
        <div className="divide-y" style={{ borderColor: `${T.border}60` }}>
          {items.map(item => (
            <div key={item.name} className="flex items-center gap-3 px-4 py-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: T.light }}>
                <Wrench className="w-4 h-4" style={{ color: T.primary }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate" style={{ color: T.text }}>{item.name}</p>
                <p className="text-[11px]" style={{ color: T.muted }}>{item.interval}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer link */}
      <Link to={createPageUrl('MaintenanceTemplates')}>
        <div className="px-4 py-2.5 text-center text-xs font-bold" style={{ color: T.primary, borderTop: `1px solid ${T.border}60` }}>
          כל הטיפולים והתיקונים →
        </div>
      </Link>
    </div>
  );
}
