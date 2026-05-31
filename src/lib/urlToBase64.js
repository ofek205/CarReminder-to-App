/**
 * urlToBase64 — fetch a public image URL and convert it to a base64
 * content part for the ai-proxy (Gemini inline_data) pipeline.
 *
 * Why this exists: community posts attach a dashboard / fault-light photo
 * uploaded to a PUBLIC Supabase Storage bucket (community/*). The AI
 * mechanic needs to SEE that photo to answer "what does this warning
 * mean" — but the old code only sent the post text, leaving the model
 * blind to the exact thing the user asked about (2026-05-31 fix).
 *
 * callGemini already accepts the Anthropic-style content block:
 *   { type: 'image', source: { type: 'base64', media_type, data } }
 * so this util returns exactly that shape (or null on any failure —
 * callers degrade gracefully to a text-only request).
 */

// Hard cap on the image we'll base64-encode and ship to the model.
// Community images are compressed to ~150-400KB WebP at upload (1280px,
// see imageCompress.js), so 4MB is a generous ceiling that only trips on
// an un-compressed outlier. Base64 inflates ~33%, so 4MB → ~5.3MB on the
// wire — still a single reasonable request.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/**
 * @param {string} url — public image URL (no auth needed)
 * @returns {Promise<{type:'image', source:{type:'base64', media_type:string, data:string}} | null>}
 */
export async function urlToImagePart(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;

    const blob = await res.blob();
    if (!blob || blob.size === 0) return null;
    if (blob.size > MAX_IMAGE_BYTES) {
      // Too large to ship inline — skip rather than risk a giant payload
      // or a provider rejection. The text answer still goes through.
      console.warn(`[urlToImagePart] image too large (${blob.size} bytes), skipping`);
      return null;
    }

    const mediaType = blob.type || 'image/jpeg';
    // Only ship formats the vision models accept.
    if (!/^image\/(jpe?g|png|webp|gif)$/i.test(mediaType)) return null;

    const dataUrl = await blobToDataUrl(blob);
    if (!dataUrl) return null;
    // Strip the "data:<mime>;base64," prefix — the proxy wants raw base64.
    const comma = dataUrl.indexOf(',');
    const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    if (!base64) return null;

    return {
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: base64 },
    };
  } catch (err) {
    console.warn('[urlToImagePart] failed to fetch/convert image:', err?.message || err);
    return null;
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    } catch {
      resolve(null);
    }
  });
}
