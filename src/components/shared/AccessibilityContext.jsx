import React, { createContext, useContext, useState, useEffect, useRef } from 'react';

const A11Y_CSS = `
/* ── Font sizes ─────────────────────────────────
   Scales TEXT only — never the html root. The previous rule
   (html.a11y-font-1 { font-size: 110% }) zoomed every rem unit
   (padding, gap, width) because Tailwind is rem-based. Now the
   scale lives in --a11y-text-scale, applied selectively to
   text-sized elements while layout/spacing stays fixed.
*/
html.a11y-font--2 { --a11y-text-scale: 0.85; }
html.a11y-font--1 { --a11y-text-scale: 0.925; }
html.a11y-font-1  { --a11y-text-scale: 1.10; }
html.a11y-font-2  { --a11y-text-scale: 1.22; }
html.a11y-font-3  { --a11y-text-scale: 1.36; }

/* Override Tailwind text utility classes when a scale is active. Only
   fires when one of the a11y-font-* classes is on html, so default
   rendering is untouched for users with the scale set to 0/default. */
html[class*="a11y-font"] body                { font-size: calc(1rem     * var(--a11y-text-scale, 1)) !important; }
/* Arbitrary Tailwind values — common ones used throughout the app. */
html[class*="a11y-font"] .text-\\[10px\\]     { font-size: calc(10px     * var(--a11y-text-scale, 1)) !important; }
html[class*="a11y-font"] .text-\\[11px\\]     { font-size: calc(11px     * var(--a11y-text-scale, 1)) !important; }
html[class*="a11y-font"] .text-\\[12px\\]     { font-size: calc(12px     * var(--a11y-text-scale, 1)) !important; }
html[class*="a11y-font"] .text-\\[13px\\]     { font-size: calc(13px     * var(--a11y-text-scale, 1)) !important; }
html[class*="a11y-font"] .text-xs            { font-size: calc(0.75rem  * var(--a11y-text-scale, 1)) !important; }
html[class*="a11y-font"] .text-sm            { font-size: calc(0.875rem * var(--a11y-text-scale, 1)) !important; }
html[class*="a11y-font"] .text-base          { font-size: calc(1rem     * var(--a11y-text-scale, 1)) !important; }
html[class*="a11y-font"] .text-lg            { font-size: calc(1.125rem * var(--a11y-text-scale, 1)) !important; }
html[class*="a11y-font"] .text-xl            { font-size: calc(1.25rem  * var(--a11y-text-scale, 1)) !important; }
html[class*="a11y-font"] .text-2xl           { font-size: calc(1.5rem   * var(--a11y-text-scale, 1)) !important; }
html[class*="a11y-font"] .text-3xl           { font-size: calc(1.875rem * var(--a11y-text-scale, 1)) !important; }
html[class*="a11y-font"] .text-4xl           { font-size: calc(2.25rem  * var(--a11y-text-scale, 1)) !important; }
html[class*="a11y-font"] .text-5xl           { font-size: calc(3rem     * var(--a11y-text-scale, 1)) !important; }

/* ── Readable font ────────────────────────────── */
html.a11y-readable-font,
html.a11y-readable-font * {
  font-family: Arial, 'Helvetica Neue', sans-serif !important;
  letter-spacing: 0.04em !important;
  word-spacing: 0.12em !important;
}

/* ── Line spacing ─────────────────────────────── */
html.a11y-line-spacing p,
html.a11y-line-spacing span,
html.a11y-line-spacing li,
html.a11y-line-spacing label,
html.a11y-line-spacing div {
  line-height: 2 !important;
}

/* ── Highlight links ──────────────────────────── */
html.a11y-highlight-links a,
html.a11y-highlight-links [role="link"] {
  text-decoration: underline !important;
  text-underline-offset: 3px !important;
  text-decoration-thickness: 2px !important;
  outline: 1px dashed currentColor !important;
  outline-offset: 2px !important;
}

/* ── Highlight focus ──────────────────────────── */
html.a11y-highlight-focus *:focus,
html.a11y-highlight-focus *:focus-visible {
  outline: 3px solid #f97316 !important;
  outline-offset: 3px !important;
  border-radius: 3px !important;
  box-shadow: 0 0 0 5px rgba(249,115,22,0.25) !important;
}

/* ── Disable animations ───────────────────────── */
html.a11y-no-animations *,
html.a11y-no-animations *::before,
html.a11y-no-animations *::after {
  animation-duration: 0.001ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.001ms !important;
}
`;

const defaultSettings = {
  fontSize: 0,           // -2 … +3
  readableFont: false,
  lineSpacing: false,
  highContrast: false,
  invertColors: false,
  blackAndWhite: false,
  highlightLinks: false,
  highlightFocus: false,
  disableAnimations: false,
};

const AccessibilityContext = createContext(null);

// Persist across sessions so the user's choices survive a reload. If the
// stored blob is corrupt or from an older schema, fall back to defaults.
const STORAGE_KEY = 'cr_a11y_settings_v1';

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    // Shallow-merge against defaults so new toggles introduced later still
    // have a valid value when the persisted blob predates them.
    return { ...defaultSettings, ...parsed };
  } catch { return null; }
}

function persist(settings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* ignore quota */ }
}

export function AccessibilityProvider({ children }) {
  // Initialise from localStorage synchronously so the first render already
  // reflects the user's saved preferences — prevents the flash of default
  // styling that would happen if we loaded in useEffect.
  const [settings, setSettings] = useState(() => loadPersisted() || { ...defaultSettings });
  const styleRef = useRef(null);

  // Inject CSS once on mount. Classes are applied synchronously from initial
  // state so the first paint already respects the user's choice.
  useEffect(() => {
    if (!styleRef.current) {
      const style = document.createElement('style');
      style.id = 'a11y-styles';
      style.textContent = A11Y_CSS;
      document.head.appendChild(style);
      styleRef.current = style;
      applyClasses(settings);
    }
    return () => {
      applyClasses(defaultSettings);
      styleRef.current?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync settings → HTML classes + inline filter + localStorage.
  useEffect(() => {
    applyClasses(settings);
    persist(settings);
  }, [settings]);

  const update = (key, value) => {
    const next = { ...settings, [key]: value };
    // Apply classes immediately (before React re-render) to avoid visual flash
    applyClasses(next);
    setSettings(next);
  };

  const resetAll = () => {
    const d = { ...defaultSettings };
    applyClasses(d);
    setSettings(d);
  };

  // Explicit "save" is a no-op in state terms (we already auto-persist on
  // every change) — but callers use it to show a confirmation toast and
  // close the panel. Keeping it as a function here lets the panel stay
  // agnostic about persistence details.
  const savePreferences = () => { persist(settings); };

  return (
    <AccessibilityContext.Provider value={{
      settings,
      update,
      resetAll,
      savePreferences,
    }}>
      {children}
    </AccessibilityContext.Provider>
  );
}

function applyClasses(settings) {
  const html = document.documentElement;

  // Font size
  html.classList.remove('a11y-font--2', 'a11y-font--1', 'a11y-font-1', 'a11y-font-2', 'a11y-font-3');
  if (settings.fontSize !== 0) {
    const cls = settings.fontSize > 0 ? `a11y-font-${settings.fontSize}` : `a11y-font-${settings.fontSize}`;
    html.classList.add(cls);
  }

  // Boolean classes
  const boolMap = {
    readableFont: 'a11y-readable-font',
    lineSpacing: 'a11y-line-spacing',
    highlightLinks: 'a11y-highlight-links',
    highlightFocus: 'a11y-highlight-focus',
    disableAnimations: 'a11y-no-animations',
  };
  for (const [key, cls] of Object.entries(boolMap)) {
    html.classList.toggle(cls, !!settings[key]);
  }

  // CSS filters (combined so they don't cancel each other)
  const filters = [];
  if (settings.highContrast) filters.push('contrast(1.6)');
  if (settings.invertColors) filters.push('invert(1)');
  if (settings.blackAndWhite) filters.push('grayscale(1)');
  html.style.filter = filters.length ? filters.join(' ') : '';
}

export function useAccessibility() {
  return useContext(AccessibilityContext);
}
