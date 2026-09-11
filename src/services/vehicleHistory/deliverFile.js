/**
 * deliverFile — the one place that knows how a generated file reaches the
 * person it was made for, and the only place that knows native differs.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS
 *   On web the browser announces a download itself, so "saved" is visible.
 *   On native there is no such UI: the file lands in a directory and the user
 *   is told nothing. Since the whole point of this export is that somebody
 *   ASKED for it, a file that saves silently and offers no way to send it has
 *   failed at the last step. So native goes straight into the OS share sheet.
 *
 *   Mirrors the proven flow in src/lib/pdfExport.js: write to Cache (not
 *   Documents — this file exists to be sent, not archived), resolve a URI,
 *   hand it to Share. Cache also means the OS can reclaim it later rather
 *   than silently filling the user's storage with every export ever made.
 *
 * @returns {Promise<'shared'|'saved'|'downloaded'>} what actually happened,
 *   so the caller can pick the right message instead of guessing. 'saved'
 *   means the share sheet was unavailable and the file is on disk only.
 */
import { isNative } from '@/lib/capacitor';

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(';base64,') ? result.split(';base64,').pop() : result);
    };
    reader.readAsDataURL(blob);
  });
}

export async function deliverFile({ blob, fileName, dialogTitle = 'שמור או שתף' }) {
  if (!blob || !fileName) throw new Error('deliverFile: blob and fileName are required');

  if (isNative) {
    const base64 = await blobToBase64(blob);
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Cache });
    const uri = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });

    try {
      const { Share } = await import('@capacitor/share');
      await Share.share({ title: fileName, url: uri.uri, dialogTitle });
      return 'shared';
    } catch (err) {
      // Two very different things land here and the caller must not treat
      // them alike: an older Capacitor that cannot share files at all, and a
      // user who simply dismissed the sheet. Either way the file IS on disk,
      // so we report 'saved' and let the caller say where it went rather
      // than showing a failure for something that succeeded.
      console.warn('deliverFile: share unavailable or dismissed:', err?.message);
      return 'saved';
    }
  }

  // Web: the browser owns the "it downloaded" feedback.
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return 'downloaded';
}
