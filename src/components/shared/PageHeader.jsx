import React from 'react';
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { C } from '@/lib/designTokens';

export default function PageHeader({ title, subtitle, backPage, actions, icon: Icon, gradient }) {
  const isGradient = Boolean(gradient);
  const bg = gradient || C.card;
  const titleColor = isGradient ? '#FFFFFF' : C.text;
  const subtitleColor = isGradient ? 'rgba(255,255,255,0.75)' : C.muted;
  const chipBg = isGradient ? 'rgba(255,255,255,0.2)' : C.light;
  const iconColor = isGradient ? '#FFFFFF' : C.primary;

  return (
    <div
      className="rounded-3xl p-4 mb-5 border"
      dir="rtl"
      style={{ background: bg, borderColor: C.border, boxShadow: '0 2px 12px rgba(45,82,51,0.08)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {backPage && (
            <Link to={createPageUrl(backPage)}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors"
                style={{ background: chipBg }}>
                <ArrowRight className="h-4 w-4" style={{ color: iconColor }} />
              </div>
            </Link>
          )}
          {Icon && !backPage && (
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: chipBg }}>
              <Icon className="h-5 w-5" style={{ color: iconColor }} />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-lg font-bold truncate" style={{ color: titleColor }}>{title}</h1>
            {subtitle && <p className="text-[11px] font-medium mt-0.5" style={{ color: subtitleColor }}>{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>}
      </div>
    </div>
  );
}
