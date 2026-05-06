/**
 * Card — the standard "white card" used across business pages.
 *
 * Replaces the ad-hoc `bg-white border border-gray-100 rounded-2xl
 * p-4` pattern with one centralized component. Soft greenish shadow
 * matches the dashboard's atmosphere (vs neutral gray).
 *
 * Optional `accent` adds a colored top stripe for "this card is about
 * X domain" hint without spending a full tone surface.
 */
import React from 'react';

const ACCENT_BAR = {
  emerald: '#10B981',
  amber:   '#F59E0B',
  blue:    '#3B82F6',
  red:     '#EF4444',
  purple:  '#A855F7',
};

export default function Card({ accent, padding = 'p-4 sm:p-5', className = '', children, ...rest }) {
  const accentColor = accent ? ACCENT_BAR[accent] : null;
  return (
    <div
      className={`relative rounded-2xl border overflow-hidden ${padding} ${className}`}
      style={{
        background: '#FFFFFF',
        borderColor: '#E5EDE8',
        boxShadow: '0 4px 16px rgba(15,40,28,0.04)',
      }}
      {...rest}
    >
      {accentColor && (
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-0.5"
          style={{ background: accentColor }}
        />
      )}
      {children}
    </div>
  );
}
