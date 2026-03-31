import React from 'react';
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function PageHeader({ title, subtitle, backPage, actions }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-6" dir="rtl">
      <div className="flex items-center gap-3 min-w-0">
        {backPage && (
          <Link to={createPageUrl(backPage)}>
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 transition-colors"
              style={{ background: '#2D5233' }}>
              <ArrowRight className="h-5 w-5 text-white" />
            </div>
          </Link>
        )}
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-black truncate" style={{ color: '#1C2E20' }}>{title}</h1>
          {subtitle && <p className="text-sm font-medium mt-0.5" style={{ color: '#7A8A7C' }}>{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>}
    </div>
  );
}
