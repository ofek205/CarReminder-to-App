/**
 * Client-side image compression.
 *
 * Resizes an image to at most {maxWidth}x{maxHeight} and re-encodes it as
 * WebP (or JPEG fallback) at {quality}. Keeps the original if the file is
 * already small, non-image, or if encoding ever fails.
 *
 * Motivation: vehicle photos straight from modern phones are 4-8 MB. Users
 * on cellular data burn quota uploading them, and Supabase Storage bills on
 * egress. We get away with a 300-500KB WebP at 1280px for a vehicle photo
 * that's never shown larger than 420px wide.
 *
 * Usage:
 *   const small = await compressImage(file);
 *   // small is a File — pass it anywhere the original File went
 */

const DEFAULTS = {
  maxWidth: 1280,
  maxHeight: 1280,
  quality: 0.82,
  // Skip files under this size — no gain worth the CPU spend
  skipBelowBytes: 200 * 1024, // 200 KB
  // Non-image files bypass compression entirely
  imageMimePrefix: 'image/',
  // PDFs and other non-image formats pass through
  preserveTypes: ['image/gif', 'image/svg+xml'],
};

/** Detect WebP encoder support (chromium, safari 14+, firefox 65+). */
function canEncodeWebP() {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1; canvas.height = 1;
    return canvas.toDataURL('image/webp').startsWith('data:image/webp');
  } catch { return false; }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
}

/**
 * Main entry — returns a (possibly new) File. Original filename is kept,
 * extension is swapped to match the new mime.
 */
export async function compressImage(file, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (!(file instanceof File) && !(file instanceof Blob)) return file;
  if (!file.type?.startsWith(o.imageMimePrefix)) return file;
  if (o.preserveTypes.includes(file.type)) return file;
  if (file.size <= o.skipBelowBytes) return file;

  try {
    const dataUrl = await fileToDataUrl(file);
    const img = await loadImage(dataUrl);

    // Compute new dimensions preserving aspect ratio
    let { width, height } = img;
    const scale = Math.min(1, o.maxWidth / width, o.maxHeight / height);
    if (scale < 1) {
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    // High-quality resampling
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);

    // Prefer WebP, fall back to JPEG
    const targetMime = canEncodeWebP() ? 'image/webp' : 'image/jpeg';
    const blob = await canvasToBlob(canvas, targetMime, o.quality);
    if (!blob || blob.size >= file.size) {
      // Compression didn't help (already well-optimized) — keep original
      return file;
    }

    // Keep original name, swap extension
    const ext = targetMime === 'image/webp' ? '.webp' : '.jpg';
    const baseName = (file.name || 'image').replace(/\.[^.]+$/, '');
    return new File([blob], baseName + ext, { type: targetMime, lastModified: Date.now() });
  } catch (err) {
    console.warn('compressImage failed, using original:', err);
    return file;
  }
}

/** Same but returns { file, dataUrl } for previews. */
export async function compressImageWithPreview(file, opts = {}) {
  const compressed = await compressImage(file, opts);
  const dataUrl = await fileToDataUrl(compressed);
  return { file: compressed, dataUrl };
}
