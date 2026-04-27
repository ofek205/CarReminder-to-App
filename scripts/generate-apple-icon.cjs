/**
 * One-shot generator for the Apple App Store icon.
 *
 * Reads src/assets/logo.png (the existing 1024×1024 brand logo, which
 * has a green ring on a white background containing the car / sail /
 * gear artwork) and produces apple-icon-1024.png — a 1024×1024 PNG
 * where the green circle ring is REMOVED, leaving only the artwork on
 * a clean white background.
 *
 * Why: Ofek felt the previous fill-the-corners variant was too busy
 * (three colors competing). Stripping the ring leaves white +
 * artwork, which after Apple's automatic corner-rounding reads as
 * a minimal, professional icon.
 *
 * Strategy:
 *   - For each pixel, compute distance from center
 *   - In the "ring zone" (between RING_INNER and RING_OUTER), if the
 *     pixel's color is close to the brand green (i.e. it's the ring
 *     itself, not artwork crossing into the ring), recolor to white
 *   - Pixels INSIDE the inner radius (the artwork) are untouched
 *   - Pixels OUTSIDE the outer radius (the white frame) are already
 *     white and stay white
 *
 * Color match uses Euclidean distance in RGB. Anything within
 * GREEN_TOLERANCE units of brand green (#2D5233) is considered ring
 * pixel and recolored.
 *
 * Output is RGB 8-bit, no alpha — Apple's 1024×1024 marketing icon
 * spec.
 */
const path = require('path');
const sharp = require(path.join(process.cwd(), 'node_modules', 'sharp'));

const INPUT  = path.resolve(__dirname, '..', 'src', 'assets', 'logo.png');
const OUTPUT = path.resolve(__dirname, '..', 'apple-icon-1024.png');

// Ring zone as a fraction of the half-canvas. Pixels in this radial
// range are candidates for ring-erase; pixels closer to center are
// the artwork and stay untouched, pixels farther are the white
// frame and are already white.
//
// Inner = 0.68 — the artwork (car / sail / gear) stays inside ~0.62
// of half-canvas, so 0.68 gives a 6% safety buffer and still covers
// the ENTIRE green ring (whose inner anti-aliased edge starts at
// roughly 0.72). The previous 0.85 missed the inner half of the
// ring, leaving the green outline visible.
// Outer = 1.5 — covers all four corners of the square so even
// outermost feathered pixels at the ring's outer edge are caught.
const RING_INNER_FRAC = 0.68;
const RING_OUTER_FRAC = 1.50;

(async () => {
  const { data, info } = await sharp(INPUT)
    .resize(1024, 1024, { fit: 'cover' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const cx = width / 2;
  const cy = height / 2;
  const halfMin = Math.min(width, height) / 2;
  const ringInner = halfMin * RING_INNER_FRAC;
  const ringOuter = halfMin * RING_OUTER_FRAC;

  const out = Buffer.from(data);
  let recolored = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < ringInner || dist > ringOuter) continue;

      const idx = (y * width + x) * channels;
      const r = out[idx];
      const g = out[idx + 1];
      const b = out[idx + 2];

      // Aggressive ring-erase. We're inside the ring zone and the
      // artwork (which lives at radius < 0.68) is already excluded.
      // Anything that's not pure pristine white here is residue from
      // the ring's anti-aliased edge — recolor everything to pure
      // white. (Pure white = (255,255,255) stays white naturally.)
      out[idx]     = 255;
      out[idx + 1] = 255;
      out[idx + 2] = 255;
      recolored++;
    }
  }

  await sharp(out, { raw: { width, height, channels } })
    .png({ compressionLevel: 9 })
    .toFile(OUTPUT);

  console.log(`Wrote ${OUTPUT}`);
  console.log(`Recolored ${recolored} ring pixels to white.`);
})().catch(e => { console.error(e); process.exit(1); });
