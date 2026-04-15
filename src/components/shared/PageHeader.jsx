import React from 'react';
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { C } from '@/lib/designTokens';

export default function PageHeader({ title, subtitle, backPage, actions, icon: Icon, gradient }) {
  const grad = gradient || C.grad;

  return (
    <div className="rounded-3xl p-4 mb-5 relative overflow-hidden" dir="rtl"
      style={{ background: grad, boxShadow: `0 4px 20px rgba(0,0,0,0.12)` }}>
      {/* Decorative circles */}
      <div className="absolute -top-10 -left-10 w-36 h-36 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }} />
      <div className="absolute -bottom-6 -right-6 w-24 h-24 rounded-full" style={{ background: 'rgba(255,191,0,0.1)' }} />

      <div className="relative z-10">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {backPage && (
              <Link to={createPageUrl(backPage)}>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors"
                  style={{ background: 'rgba(255,255,255,0.2)' }}>
                  <ArrowRight className="h-4 w-4 text-white" />
                </div>
              </Link>
            )}
            {Icon && !backPage && (
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: 'rgba(255,255,255,0.2)' }}>
                <Icon className="h-5 w-5 text-white" />
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-lg font-black text-white truncate">{title}</h1>
              {subtitle && <p className="text-[11px] font-medium mt-0.5" style={{ color: 'rgba(255,255,255,0.7)' }}>{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>}
        </div>
      </div>
    </div>
  );
}
