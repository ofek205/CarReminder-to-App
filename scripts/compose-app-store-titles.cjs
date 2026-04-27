/**
 * App Store screenshot composer.
 *
 * Takes raw 1290×2796 captures from app-store/ and produces final
 * App Store assets with a green brand band + Hebrew title at the
 * top, with the screenshot scaled down and centered below (phone-
 * mockup style with brand-green margins).
 *
 * Output: app-store/final/01.png … 08.png at 1290×2796.
 *
 * USAGE:
 *   node scripts/compose-app-store-titles.cjs
 */
const fs   = require('fs');
const path = require('path');
const sharp = require(path.join(process.cwd(), 'node_modules', 'sharp'));

const SRC_DIR = path.resolve(__dirname, '..', 'app-store');
const OUT_DIR = path.resolve(SRC_DIR, 'final');
fs.mkdirSync(OUT_DIR, { recursive: true });

// Final canvas
const W = 1290;
const H = 2796;
// Top brand band that hosts the title
const BAND_H = 620;
// Brand green — Tailwind green-700, matches the in-app primary CTA.
const BRAND_GREEN = '#15803d';

// 8 chosen shots, in order. {file: source basename in app-store/,
// title: Hebrew caption to render in the green band}.
const SHOTS = [
  { file: '01-dashboard.png',        title: 'אל תפספסו תאריך חשוב לרכב' },
  { file: '08-vehicle-detail.png',   title: 'כל המידע על הרכב — במסך אחד' },
  { file: '16-guest-dashboard.png',  title: 'מכונית, יאכטה או אופנוע — באפליקציה אחת' },
  { file: '18-guest-documents.png',  title: 'ביטוח, רישיון וטסט — תמיד בידיים' },
  { file: '04-find-garage.png',      title: 'מוסך הכי קרוב — תוך שנייה' },
  { file: '05-ai-assistant.png',     title: 'מומחה AI שמכיר את הרכב' },
  { file: '19-guest-community.png',  title: 'קהילת רכב פעילה — שאלות ותשובות' },
  { file: '14-checklist-hub.png',    title: 'צ׳קליסטים מקצועיים לתחזוקה' },
];

// Scaled screenshot dimensions: keep aspect ratio 1290:2796 and fit
// inside the area below the band. Available: H - BAND_H = 2176 high.
// To preserve aspect: width = 2176 * 1290/2796 = ~1004.
const SHOT_H = H - BAND_H - 80;            // 80px breathing room at the bottom
const SHOT_W = Math.round(SHOT_H * 1290 / 2796);
const SHOT_X = Math.round((W - SHOT_W) / 2);
const SHOT_Y = BAND_H - 20;                // small overlap into the band so it feels integrated

// Split a Hebrew title into 1-2 balanced lines. Prefer the em-dash
// (most natural break) but fall back to splitting on the space
// closest to the middle so neither line clips at 1290px width.
const splitTitle = (title) => {
  if (title.includes(' — ')) {
    const [a, b] = title.split(' — ');
    return [a, b];
  }
  // Stay single-line if short enough — ~14 Hebrew chars at our font.
  if (title.length <= 14) return [title, ''];
  // Find the space closest to the midpoint.
  const mid = title.length / 2;
  let best = -1, bestDist = Infinity;
  for (let i = 0; i < title.length; i++) {
    if (title[i] === ' ') {
      const d = Math.abs(i - mid);
      if (d < bestDist) { bestDist = d; best = i; }
    }
  }
  if (best === -1) return [title, ''];
  return [title.slice(0, best), title.slice(best + 1)];
};

const buildTitleSvg = (title) => {
  const [l1, l2] = splitTitle(title);
  const lineCount = l2 ? 2 : 1;
  // Conservative sizes so even ~14-char Hebrew lines never clip.
  const fontSize = lineCount === 2 ? 78 : 92;
  const lineGap = fontSize * 1.18;
  const totalTextH = lineCount * lineGap;
  const startY = (BAND_H - totalTextH) / 2 + fontSize - 30; // bias slightly up
  const tspans = l2
    ? `<tspan x="${W / 2}" y="${startY}">${l1}</tspan><tspan x="${W / 2}" y="${startY + lineGap}">${l2}</tspan>`
    : `<tspan x="${W / 2}" y="${startY}">${l1}</tspan>`;

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${BAND_H}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#15803d"/>
        <stop offset="100%" stop-color="#0e6b30"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${BAND_H}" fill="url(#g)"/>
    <text font-family="Segoe UI, Arial, sans-serif" font-weight="700"
          fill="#ffffff" text-anchor="middle"
          font-size="${fontSize}" direction="rtl">
      ${tspans}
    </text>
    <text x="${W / 2}" y="${BAND_H - 50}" font-family="Segoe UI, Arial, sans-serif"
          font-weight="600" font-size="34" fill="#ffffff" opacity="0.75"
          text-anchor="middle" letter-spacing="6">CARREMINDER</text>
  </svg>`);
};

// Build a rounded mask the size of the scaled screenshot so the
// composited screenshot has rounded corners.
const roundedMask = (w, h, radius = 60) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect x="0" y="0" width="${w}" height="${h}" rx="${radius}" ry="${radius}" fill="#ffffff"/>
  </svg>`
);

(async () => {
  for (let i = 0; i < SHOTS.length; i++) {
    const s = SHOTS[i];
    const srcPath = path.join(SRC_DIR, s.file);
    if (!fs.existsSync(srcPath)) {
      console.warn(`SKIP: ${s.file} not found`);
      continue;
    }

    // 1. Resize source screenshot to fit our slot.
    const resized = await sharp(srcPath)
      .resize(SHOT_W, SHOT_H, { fit: 'fill' })
      .png()
      .toBuffer();

    // 2. Apply rounded-corner mask so the screenshot has soft corners.
    const masked = await sharp(resized)
      .composite([{ input: roundedMask(SHOT_W, SHOT_H, 56), blend: 'dest-in' }])
      .png()
      .toBuffer();

    // 3. Build the green canvas with the title band.
    const titleSvg = buildTitleSvg(s.title);

    // 4. Compose: brand-green canvas → title band → screenshot.
    const out = await sharp({
      create: { width: W, height: H, channels: 4, background: BRAND_GREEN },
    })
      .composite([
        { input: titleSvg, top: 0, left: 0 },
        { input: masked,   top: SHOT_Y, left: SHOT_X },
      ])
      .png()
      .toBuffer();

    const outName = String(i + 1).padStart(2, '0') + '.png';
    const outPath = path.join(OUT_DIR, outName);
    fs.writeFileSync(outPath, out);
    const size = (fs.statSync(outPath).size / 1024).toFixed(0);
    console.log(`  wrote ${outName}  ←  ${s.file}  (${size} KB)`);
  }
  console.log('Done. Final assets:', OUT_DIR);
})().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
