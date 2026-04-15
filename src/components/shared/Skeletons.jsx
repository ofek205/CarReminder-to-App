import React from 'react';

// Shimmer animation via CSS class (added to index.css)
const shimmer = 'animate-pulse';

function Bone({ className = '', style = {} }) {
  return <div className={`${shimmer} rounded-lg bg-gray-200 ${className}`} style={style} />;
}

// ── Vehicle Card Skeleton ───────────────────────────────────────────────────
export function VehicleCardSkeleton() {
  return (
    <div className="rounded-2xl p-4 flex items-center gap-4" dir="rtl"
      style={{ background: '#fff', border: '1.5px solid #E5E7EB' }}>
      <Bone className="w-14 h-14 rounded-2xl shrink-0" />
      <div className="flex-1 space-y-2.5">
        <Bone className="h-4 w-32 rounded-md" />
        <Bone className="h-3 w-48 rounded-md" />
        <div className="flex gap-2">
          <Bone className="h-6 w-16 rounded-full" />
          <Bone className="h-6 w-16 rounded-full" />
        </div>
      </div>
    </div>
  );
}

// ── Post Card Skeleton (Community) ──────────────────────────────────────────
export function PostCardSkeleton() {
  return (
    <div className="rounded-2xl p-4 space-y-3" dir="rtl"
      style={{ background: '#fff', border: '1px solid #E5E7EB' }}>
      <div className="flex items-center gap-3">
        <Bone className="w-10 h-10 rounded-full shrink-0" />
        <div className="space-y-1.5 flex-1">
          <Bone className="h-3.5 w-28 rounded-md" />
          <Bone className="h-2.5 w-16 rounded-md" />
        </div>
      </div>
      <div className="space-y-2">
        <Bone className="h-3 w-full rounded-md" />
        <Bone className="h-3 w-4/5 rounded-md" />
      </div>
      <div className="flex gap-3 pt-2">
        <Bone className="h-8 flex-1 rounded-xl" />
        <Bone className="h-8 flex-1 rounded-xl" />
        <Bone className="h-8 flex-1 rounded-xl" />
      </div>
    </div>
  );
}

// ── Document Card Skeleton ──────────────────────────────────────────────────
export function DocumentCardSkeleton() {
  return (
    <div className="rounded-2xl p-4 flex items-center gap-3" dir="rtl"
      style={{ background: '#fff', border: '1.5px solid #E5E7EB' }}>
      <Bone className="w-12 h-12 rounded-xl shrink-0" />
      <div className="flex-1 space-y-2">
        <Bone className="h-3.5 w-36 rounded-md" />
        <Bone className="h-3 w-24 rounded-md" />
      </div>
      <Bone className="w-8 h-8 rounded-lg shrink-0" />
    </div>
  );
}

// ── Notification Skeleton ───────────────────────────────────────────────────
export function NotificationSkeleton() {
  return (
    <div className="rounded-2xl p-4 flex items-center gap-3" dir="rtl"
      style={{ background: '#fff', border: '1.5px solid #E5E7EB' }}>
      <Bone className="w-11 h-11 rounded-xl shrink-0" />
      <div className="flex-1 space-y-2">
        <Bone className="h-3.5 w-44 rounded-md" />
        <Bone className="h-3 w-20 rounded-md" />
      </div>
    </div>
  );
}

// ── Generic List Skeleton ───────────────────────────────────────────────────
export function ListSkeleton({ count = 3, variant = 'vehicle' }) {
  const Component = {
    vehicle: VehicleCardSkeleton,
    post: PostCardSkeleton,
    document: DocumentCardSkeleton,
    notification: NotificationSkeleton,
  }[variant] || VehicleCardSkeleton;

  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <Component key={i} />
      ))}
    </div>
  );
}

// ── Page Skeleton (full page placeholder) ───────────────────────────────────
export function PageSkeleton() {
  return (
    <div className="space-y-4" dir="rtl">
      <Bone className="h-24 w-full rounded-3xl" />
      <div className="space-y-3">
        <Bone className="h-20 w-full rounded-2xl" />
        <Bone className="h-20 w-full rounded-2xl" />
        <Bone className="h-20 w-full rounded-2xl" />
      </div>
    </div>
  );
}
