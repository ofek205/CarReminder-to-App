import { createContext, useContext, useState, useEffect } from 'react';

const FontScaleContext = createContext();

const FONT_SCALES = [0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5];

function getDeviceDefault() {
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;
  return isMobile ? 0.7 : 0.9;
}

// Pure DOM mutation, no React state — extracted to module scope so
// the useEffect mount and the in-component applyScale can both reach
// it without lexical-order acrobatics (and without TDZ).
//
// We only set the CSS variable; we used to also do
//   document.documentElement.style.fontSize = `${scale * 16}px`
// which pinned the html root to a fixed pixel value and, as a side
// effect, completely blocked the OS/browser font-size accessibility
// setting — users who bumped their Android font size up saw the rest
// of the UI unchanged while their WebView's text zoom still enlarged
// certain elements, so layout "lost its proportions" (v2.6.1 bug).
//
// Keeping only the --font-scale variable still lets our in-app slider
// control size (via calc(1rem * var(--font-scale)) in globals.css)
// while letting the OS control the rem baseline.
function applyFontScale(scale) {
  document.documentElement.style.setProperty('--font-scale', scale);
}

export function FontScaleProvider({ children }) {
  const [fontScale, setFontScale] = useState(1.0);
  const [loading, setLoading] = useState(true);

  const loadFromUser = async () => {
    try {
      // Use localStorage only - no server dependency
      if (!localStorage.getItem('font_scale')) {
        const deviceDefault = getDeviceDefault();
        applyFontScale(deviceDefault);
        setFontScale(deviceDefault);
        localStorage.setItem('font_scale', deviceDefault);
      }
    } catch (e) {
      // Fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Load from localStorage first (instant)
    const saved = localStorage.getItem('font_scale');
    if (saved) {
      const scale = parseFloat(saved);
      if (FONT_SCALES.includes(scale)) {
        applyFontScale(scale);
        setFontScale(scale);
      }
    }

    // Then try to load from user preferences
    loadFromUser();
  }, []);

  const applyScale = async (newScale) => {
    if (!FONT_SCALES.includes(newScale)) return;
    
    applyFontScale(newScale);
    setFontScale(newScale);
    localStorage.setItem('font_scale', newScale);

    // localStorage is the source of truth for font scale
  };

  const getPercentage = () => Math.round(fontScale * 100);

  return (
    <FontScaleContext.Provider value={{
      fontScale,
      applyScale,
      getPercentage,
      loading
    }}>
      {children}
    </FontScaleContext.Provider>
  );
}

export function useFontScale() {
  const context = useContext(FontScaleContext);
  if (!context) {
    throw new Error('useFontScale must be used within FontScaleProvider');
  }
  return context;
}