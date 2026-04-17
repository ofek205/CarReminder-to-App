import React from 'react';
import { RefreshCw } from 'lucide-react';

export default function PullToRefreshIndicator({ pulling, progress }) {
  if (!pulling) return null;
  return (
    <div
      className="fixed top-0 left-0 right-0 flex justify-center z-50 pointer-events-none"
      style={{
        transform: `translateY(${Math.min(progress * 60, 60)}px)`,
        opacity: progress,
        transition: progress === 0 ? 'all 0.2s' : 'none',
      }}>
      <div className="w-10 h-10 rounded-full bg-white shadow-lg flex items-center justify-center"
        style={{ transform: `rotate(${progress * 360}deg)` }}>
        <RefreshCw className="w-5 h-5" style={{ color: '#2D5233' }} />
      </div>
    </div>
  );
}
