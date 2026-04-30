import React from 'react';

export default function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {Icon && (
        <div className="w-16 h-16 rounded-2xl bg-[#E8F2EA] flex items-center justify-center mb-4">
          <Icon className="h-8 w-8 text-[#2D5233]" />
        </div>
      )}
      <h3 className="text-lg font-semibold text-[#1C2E20] mb-1">{title}</h3>
      {description && <p className="text-sm text-[#7A8A7C] max-w-sm mb-4">{description}</p>}
      {action}
    </div>
  );
}