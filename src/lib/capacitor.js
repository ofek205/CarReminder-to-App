/**
 * Capacitor Native Bridge
 *
 * Detects if running inside a native app (Capacitor) vs browser/PWA.
 * Provides native-aware wrappers for camera, geolocation, filesystem, etc.
 * Falls back to web APIs when running in a browser.
 */

import { Capacitor } from '@capacitor/core';

// ── Platform Detection ─────────────────────────────────────────────────────
export const isNative = Capacitor.isNativePlatform();
export const isAndroid = Capacitor.getPlatform() === 'android';
export const isIOS = Capacitor.getPlatform() === 'ios';
export const isWeb = Capacitor.getPlatform() === 'web';

// ── Status Bar ─────────────────────────────────────────────────────────────
export async function initStatusBar() {
  if (!isNative) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setOverlaysWebView({ overlay: false });
    if (isAndroid) {
      await StatusBar.setBackgroundColor({ color: '#2D5233' });
    }
  } catch (e) {
    console.warn('StatusBar plugin not available:', e);
  }
}

// ── Splash Screen ──────────────────────────────────────────────────────────
export async function hideSplash() {
  if (!isNative) return;
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide();
  } catch (e) {
    console.warn('SplashScreen plugin not available:', e);
  }
}

// ── Camera ─────────────────────────────────────────────────────────────────
/**
 * Take a photo using native camera or file picker.
 * Returns { dataUrl, webPath } or null if cancelled.
 */
export async function takePhoto(source = 'CAMERA') {
  if (!isNative) return null; // Fallback: use <input type="file"> in web
  try {
    const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
    const image = await Camera.getPhoto({
      quality: 80,
      allowEditing: false,
      resultType: CameraResultType.DataUrl,
      source: source === 'CAMERA' ? CameraSource.Camera : CameraSource.Photos,
      width: 1200,
      correctOrientation: true,
    });
    return {
      dataUrl: image.dataUrl,
      webPath: image.webPath,
      format: image.format,
    };
  } catch (e) {
    if (e.message?.includes('cancelled') || e.message?.includes('User cancelled')) {
      return null;
    }
    console.error('Camera error:', e);
    throw e;
  }
}

/**
 * Pick image from gallery.
 */
export async function pickImage() {
  return takePhoto('PHOTOS');
}

// ── Geolocation ────────────────────────────────────────────────────────────
/**
 * Get current position. Uses native plugin on Capacitor, web API on browser.
 * Returns { latitude, longitude }
 */
export async function getCurrentPosition() {
  if (isNative) {
    try {
      const { Geolocation } = await import('@capacitor/geolocation');
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 15000,
      });
      return {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      };
    } catch (e) {
      console.error('Native geolocation error:', e);
      throw e;
    }
  }

  // Web fallback
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  });
}

// ── Filesystem (Downloads) ─────────────────────────────────────────────────
/**
 * Save a file to the device. On native, uses Filesystem plugin.
 * On web, falls back to blob download.
 */
export async function saveFile(fileName, data, mimeType = 'application/octet-stream') {
  if (isNative) {
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');

      // If data is a Blob, convert to base64
      let base64Data;
      if (data instanceof Blob) {
        base64Data = await blobToBase64(data);
      } else if (typeof data === 'string' && data.startsWith('data:')) {
        base64Data = data.split(',')[1];
      } else {
        base64Data = data;
      }

      const result = await Filesystem.writeFile({
        path: fileName,
        data: base64Data,
        directory: Directory.Documents,
      });

      return { success: true, uri: result.uri };
    } catch (e) {
      console.error('Filesystem write error:', e);
      throw e;
    }
  }

  // Web fallback — blob download
  let blob;
  if (data instanceof Blob) {
    blob = data;
  } else if (typeof data === 'string' && data.startsWith('data:')) {
    const res = await fetch(data);
    blob = await res.blob();
  } else {
    blob = new Blob([data], { type: mimeType });
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
  return { success: true };
}

/**
 * Download an image from URL and save to device.
 */
export async function downloadImage(imageUrl, fileName) {
  try {
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    return saveFile(fileName, blob, blob.type);
  } catch (e) {
    console.error('Download image error:', e);
    throw e;
  }
}

// ── Share ──────────────────────────────────────────────────────────────────
/**
 * Native share dialog. Falls back to clipboard on web.
 */
export async function shareContent({ title, text, url }) {
  if (isNative) {
    try {
      const { Share } = await import('@capacitor/share');
      await Share.share({ title, text, url });
      return true;
    } catch (e) {
      console.warn('Share error:', e);
      return false;
    }
  }

  // Web fallback — Web Share API or clipboard
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return true;
    } catch { return false; }
  }

  // Last resort: copy to clipboard
  try {
    await navigator.clipboard.writeText(url || text);
    return true;
  } catch { return false; }
}

// ── Keyboard ───────────────────────────────────────────────────────────────
export async function initKeyboard() {
  if (!isNative) return;
  try {
    const { Keyboard } = await import('@capacitor/keyboard');
    // On Android, keyboard pushes content up
    Keyboard.addListener('keyboardWillShow', () => {
      document.body.classList.add('keyboard-visible');
    });
    Keyboard.addListener('keyboardWillHide', () => {
      document.body.classList.remove('keyboard-visible');
    });
  } catch (e) {
    console.warn('Keyboard plugin not available:', e);
  }
}

// ── App (back button) ──────────────────────────────────────────────────────
export async function initBackButton(onBackButton) {
  if (!isNative) return;
  try {
    const { App } = await import('@capacitor/app');
    App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) {
        window.history.back();
      } else if (onBackButton) {
        onBackButton();
      } else {
        App.exitApp();
      }
    });
  } catch (e) {
    console.warn('App plugin not available:', e);
  }
}

// ── Deep links ──────────────────────────────────────────────────────────────
/**
 * Handle incoming deep links (e.g. carreminder://vehicle/<id> or
 * https://carreminder.co.il/VehicleDetail?id=...).
 *
 * Converts the incoming URL's pathname + search into a history push so the
 * React Router sees it as a normal navigation. Used for push-notification
 * deep-links and external links from WhatsApp/email.
 *
 * @param {function(path: string): void} navigate — called with '/Path?query'
 */
export async function initDeepLinks(navigate) {
  if (!isNative) return;
  try {
    const { App } = await import('@capacitor/app');
    // Listener fires for both "cold" (app closed) and "warm" (app open) opens.
    App.addListener('appUrlOpen', ({ url }) => {
      if (!url) return;
      try {
        const u = new URL(url);
        // Accept only our own scheme/host to avoid hijacking
        const ok = u.protocol === 'carreminder:'
                || u.hostname === 'carreminder.co.il'
                || u.hostname === 'www.carreminder.co.il';
        if (!ok) return;
        // carreminder://vehicle/abc → /VehicleDetail?id=abc
        let path = u.pathname + (u.search || '');
        if (u.protocol === 'carreminder:') {
          const [, kind, id] = u.pathname.split('/');
          if (kind === 'vehicle' && id) path = `/VehicleDetail?id=${encodeURIComponent(id)}`;
          else if (kind === 'document' && id) path = `/Documents?id=${encodeURIComponent(id)}`;
          else if (kind === 'accident' && id) path = `/Accidents?id=${encodeURIComponent(id)}`;
          else path = u.hostname ? `/${u.hostname}${u.pathname}` : '/';
        }
        if (typeof navigate === 'function') navigate(path);
        else window.location.href = path;
      } catch { /* malformed URL — ignore */ }
    });
  } catch (e) {
    console.warn('Deep links init failed:', e);
  }
}

// ── Haptics ────────────────────────────────────────────────────────────────
export async function hapticFeedback(type = 'light') {
  if (!isNative) return;
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    const style = type === 'heavy' ? ImpactStyle.Heavy
      : type === 'medium' ? ImpactStyle.Medium
      : ImpactStyle.Light;
    await Haptics.impact({ style });
  } catch (e) { /* silent */ }
}

// ── Utility ────────────────────────────────────────────────────────────────
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
