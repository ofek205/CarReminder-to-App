import React, { createContext, useContext, useState, useEffect, useRef } from 'react';

const A11Y_CSS = `
/* ── Font sizes ───────────────────────────────── */
html.a11y-font-1  { font-size: 110% !important; }
html.a11y-font-2  { font-size: 122% !important; }
html.a11y-font-3  { font-size: 136% !important; }
html.a11y-font--1 { font-size: 90%  !important; }
html.a11y-font--2 { font-size: 80%  !important; }

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

export function AccessibilityProvider({ children }) {
  const [settings, setSettings] = useState({ ...defaultSettings });
  const styleRef = useRef(null);

  // Inject CSS once on mount
  useEffect(() => {
    if (!styleRef.current) {
      const style = document.createElement('style');
      style.id = 'a11y-styles';
      style.textContent = A11Y_CSS;
      document.head.appendChild(style);
      styleRef.current = style;
    }
    return () => {
      // Cleanup on unmount: remove all classes + styles
      applyClasses(defaultSettings);
      styleRef.current?.remove();
    };
  }, []);

  // Sync settings → HTML classes + inline filter
  useEffect(() => {
    applyClasses(settings);
  }, [settings]);

  return (
    <AccessibilityContext.Provider value={{
      settings,
      update: (key, value) => setSettings(prev => ({ ...prev, [key]: value })),
      resetAll: () => setSettings({ ...defaultSettings }),
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
