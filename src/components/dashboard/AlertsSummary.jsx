import React from 'react';
import { Card } from "@/components/ui/card";
import { AlertTriangle, CheckCircle, Clock } from "lucide-react";
import { getDateStatus } from "../shared/DateStatusUtils";

export default function AlertsSummary({ vehicles }) {
  const { overdue, upcoming, ok } = vehicles.reduce(
    (acc, v) => {
      const test = getDateStatus(v.test_due_date);
      const ins = getDateStatus(v.insurance_due_date);
      if (test.status === 'danger' || ins.status === 'danger') acc.overdue++;
      else if (test.status === 'warn' || ins.status === 'warn') acc.upcoming++;
      else acc.ok++;
      return acc;
    },
    { overdue: 0, upcoming: 0, ok: 0 }
  );

  const items = [
    { label: 'באיחור', value: overdue, icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50' },
    { label: 'בקרוב', value: upcoming, icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50' },
    { label: 'תקין', value: ok, icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  ];

  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-4">
      {items.map(item => (
        <Card key={item.label} className="p-3 sm:p-5 border border-gray-100 shadow-sm hover:shadow-md transition-all duration-200 rounded-2xl">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-3">
            <div className={`w-9 h-9 sm:w-12 sm:h-12 rounded-xl ${item.bg} flex items-center justify-center shadow-sm shrink-0`}>
              <item.icon className={`h-5 w-5 sm:h-6 sm:w-6 ${item.color}`} />
            </div>
            <div className="text-center">
              <p className="text-2xl sm:text-3xl font-bold text-gray-900">{item.value}</p>
              <p className="text-xs text-gray-500 font-medium">{item.label}</p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}