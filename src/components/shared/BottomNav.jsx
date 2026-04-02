import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Home, Car, FileText, User } from 'lucide-react';

const tabs = [
  { label: 'ראשי',   icon: Home,     path: 'Dashboard' },
  { label: 'רכבים',  icon: Car,      path: 'Vehicles'  },
  { label: 'מסמכים', icon: FileText, path: 'Documents' },
  { label: 'פרופיל', icon: User,     path: 'UserProfile' },
];

export default function BottomNav() {
  const location = useLocation();

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden"
      style={{ background: '#FFFFFF', borderTop: '1.5px solid #D8E5D9', boxShadow: '0 -6px 28px rgba(0,0,0,0.10)' }}>
      <div className="flex justify-around items-end max-w-md mx-auto px-2 pt-2 pb-3">
        {tabs.map(tab => {
          const active = location.pathname.includes(createPageUrl(tab.path));
          return (
            <Link key={tab.path} to={createPageUrl(tab.path)}
              className="flex flex-col items-center gap-1 py-1 px-2 min-w-0">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center transition-all"
                style={{
                  background: active ? '#2D5233' : '#F3F4F6',
                  boxShadow: active ? '0 4px 14px rgba(45,82,51,0.35)' : 'none',
                }}>
                <tab.icon className="w-6 h-6" strokeWidth={active ? 2.5 : 2}
                  style={{ color: active ? '#FFBF00' : '#6B7280' }} />
              </div>
              <span className="text-sm font-extrabold"
                style={{ color: active ? '#2D5233' : '#6B7280' }}>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
