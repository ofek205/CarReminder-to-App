// Deterministic color picker for the fleet map.
//
// Same input string → same color, every render, on every device.
// Used to color routes by driver or by task ID without storing a palette
// per row in the DB.
//
// Hue palette tuned for legibility on the OSM grayscale base layer:
// saturated mid-darks that read clearly over the gray streets and on
// white popups. Avoid pure greens — the project's brand color is green
// and reusing it would visually merge with the UI chrome.

const PALETTE = [
  '#1565C0', // blue
  '#E65100', // orange
  '#6A1B9A', // purple
  '#00838F', // teal
  '#C62828', // red
  '#283593', // indigo
  '#AD1457', // pink
  '#2E7D32', // dark green (kept for contrast)
  '#EF6C00', // amber-deep
  '#0277BD', // light-blue dark
  '#4527A0', // deep purple
  '#558B2F', // olive
];

export function colorFromKey(key) {
  if (!key) return PALETTE[0];
  const s = String(key);
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash |= 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export const FLEET_PALETTE = PALETTE;
