/**
 * Design tokens — JavaScript export
 * ==================================
 *
 * Mirrors src/design/tokens.css for code that can't reach CSS variables
 * (recharts colors, canvas drawings, Capacitor StatusBar config, etc.).
 *
 * Single source of truth principle:
 *   - For DOM styling, prefer CSS variables (`var(--cr-text-primary)`)
 *     or Tailwind classes (`text-cr-text-primary`).
 *   - For JS-driven values (chart palette, programmatic styles), import
 *     from this file: `import { tokens } from '@/design/tokens'`.
 *
 * Keep the values in sync with tokens.css. A test in sprint 6 will lint
 * for drift.
 */

// Brand palette — raw values (avoid using directly in components)
const palette = {
  green: {
    50:  '#F0F7F1',
    100: '#E8F2EA',
    200: '#D8E5D9',
    300: '#B7CDBA',
    400: '#7FA587',
    500: '#4A8C5C',
    600: '#3A6B42',
    700: '#2D5233',
    800: '#1E3D24',
    900: '#1C2E20',
  },
  amber: {
    50:  '#FFFBEB',
    100: '#FEF3C7',
    200: '#FDE68A',
    300: '#FCD34D',
    400: '#FBBF24',
    500: '#FFBF00',
    600: '#D97706',
    700: '#B45309',
    800: '#92400E',
    900: '#78350F',
  },
  gray: {
    0:   '#FFFFFF',
    50:  '#FAFAFA',
    100: '#F3F4F6',
    200: '#E5E7EB',
    300: '#D1D5DB',
    400: '#9CA3AF',
    500: '#6B7280',
    600: '#4B5563',
    700: '#374151',
    800: '#1F2937',
    900: '#111827',
  },
  red: {
    50:  '#FEF2F2',
    100: '#FEE2E2',
    200: '#FECACA',
    500: '#EF4444',
    600: '#DC2626',
    700: '#B91C1C',
    800: '#991B1B',
  },
  blue: {
    50:  '#EFF6FF',
    100: '#DBEAFE',
    500: '#3B82F6',
    600: '#2563EB',
    700: '#1D4ED8',
    800: '#1E40AF',
  },
  marine: {
    50:  '#E0F7FA',
    100: '#B2EBF2',
    500: '#0C7B93',
    600: '#065A6E',
    700: '#0A3D4D',
  },
  earth: {
    50:  '#EFEBE9',
    100: '#D7CCC8',
    500: '#795548',
    600: '#5D4037',
    700: '#4E342E',
    900: '#3E2723',
  },
};

// Semantic tokens — what components consume
export const tokens = {
  brand: {
    primary:      palette.green[700],
    primaryHover: palette.green[800],
    primarySoft:  palette.green[100],
    accent:       palette.amber[500],
    accentHover:  palette.amber[600],
  },
  text: {
    primary:    palette.gray[900],
    secondary:  palette.gray[600],
    muted:      palette.gray[500],
    disabled:   palette.gray[400],
    onBrand:    '#FFFFFF',
    link:       palette.green[700],
  },
  surface: {
    canvas:     '#FFFFFF',
    subtle:     palette.gray[50],
    card:       '#FFFFFF',
    elevated:   '#FFFFFF',
    overlay:    'rgba(17, 24, 39, 0.55)',
    brandSoft:  palette.green[50],
    input:      '#FFFFFF',
  },
  border: {
    subtle:    palette.gray[100],
    default:   palette.gray[200],
    strong:    palette.gray[300],
    brand:     palette.green[700],
    focusRing: palette.green[500],
  },
  status: {
    ok:     { bg: '#E8F5E9', fg: '#1B5E20', border: '#BBDEFB', solid: '#2E7D32' },
    warn:   { bg: palette.amber[100], fg: palette.amber[800], border: palette.amber[200], solid: palette.amber[600] },
    danger: { bg: palette.red[50], fg: palette.red[700], border: palette.red[200], solid: palette.red[600] },
    info:   { bg: palette.blue[50], fg: palette.blue[700], border: palette.blue[100], solid: palette.blue[600] },
  },
  space: {
    0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64,
  },
  radius: {
    none: 0, sm: 6, md: 10, lg: 14, xl: 20, '2xl': 28, full: 9999,
  },
  shadow: {
    none:     'none',
    xs:       '0 1px 2px rgba(17, 24, 39, 0.04)',
    sm:       '0 1px 3px rgba(17, 24, 39, 0.06), 0 1px 2px rgba(17, 24, 39, 0.04)',
    md:       '0 4px 12px rgba(17, 24, 39, 0.08), 0 2px 4px rgba(17, 24, 39, 0.04)',
    lg:       '0 12px 24px rgba(17, 24, 39, 0.10), 0 4px 8px rgba(17, 24, 39, 0.06)',
    card:     '0 1px 3px rgba(17, 24, 39, 0.06), 0 1px 2px rgba(17, 24, 39, 0.04)',
    floating: '0 12px 32px rgba(17, 24, 39, 0.14)',
  },
  font: {
    size: { xs: 12, sm: 14, base: 16, lg: 18, xl: 22, '2xl': 28 },
    weight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
    lineHeight: { tight: 1.2, normal: 1.5, relaxed: 1.7 },
  },
  z: {
    base: 0, raised: 10, sticky: 20, bottomNav: 40, modal: 50, toast: 60, popover: 70, tooltip: 80,
  },
  // Theme overrides (vessel/offroad). Use for vehicle-themed surfaces.
  themes: {
    marine: {
      brand: { primary: palette.marine[500], primaryHover: palette.marine[600], primarySoft: palette.marine[50] },
      surface: { brandSoft: palette.marine[50] },
      border: { brand: palette.marine[500] },
    },
    earth: {
      brand: { primary: palette.earth[600], primaryHover: palette.earth[700], primarySoft: palette.earth[50] },
      surface: { brandSoft: palette.earth[50] },
      border: { brand: palette.earth[600] },
    },
  },
};

// Convenience: chart-friendly palette in legible order
export const chartPalette = [
  palette.green[600],
  palette.amber[500],
  palette.blue[500],
  palette.red[500],
  palette.marine[500],
  palette.earth[500],
  palette.gray[500],
];

// Raw palette is exported for the rare case a token doesn't exist yet.
// Prefer adding a new semantic token over reaching for raw palette.
export const _palette = palette;

export default tokens;
