/**
 * Sparkline — tiny inline SVG line chart.
 *
 * Built specifically for the KpiTile context: lives inside a card,
 * needs to fit ~80px wide at 28px tall, renders a 6-point series
 * (typically 6 months of data). NOT a general-purpose chart — for
 * anything more complex use vendor-charts.
 *
 * The last point gets a filled circle so the user immediately reads
 * "this is the current value, the rest is history". Area below the
 * line is filled with a transparent gradient of the same color for
 * depth without competing with the line itself.
 *
 * @param {number[]} data         numeric series, oldest → current
 * @param {string}   color        hex color, default emerald
 * @param {number}   height       px, default 28
 */
import React from 'react';

export default function Sparkline({ data, color = '#10B981', height = 28 }) {
  if (!Array.isArray(data) || data.length < 2) return null;
  const w = 80;
  const h = height;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = Math.max(1, max - min);
  const stepX = w / (data.length - 1);
  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return [x, y];
  });
  const path = points.map(([x, y], i) => (i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`)).join(' ');
  const areaPath = `${path} L ${points[points.length - 1][0]} ${h} L 0 ${h} Z`;
  const last = points[points.length - 1];
  // Strip the leading '#' so the gradient id is a valid CSS id.
  const gradId = `spark-grad-${color.replace('#', '')}`;

  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path d={path}     fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2" fill={color} />
    </svg>
  );
}
