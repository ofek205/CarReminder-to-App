import { createContext, useContext, useState, useEffect } from 'react';

const FontScaleContext = createContext();

const FONT_SCALES = [0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5];

function getDeviceDefault() {
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;
  return isMobile ? 0.8 : 1.0;
}

export function FontScaleProvider({ children }) {
  const [fontScale, setFontScale] = useState(1.0);
  const [loading, setLoading] = useState(true);

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

  const applyFontScale = (scale) => {
    // Restore the mobile-default proportions that users got used to:
    // the original behaviour was html.fontSize = scale*16 so on mobile
    // (0.8) everything rendered 20% tighter than desktop, which the
    // whole layout was tuned for. When we moved font-size to pure CSS
    // variables earlier the mobile baseline went from 12.8px to 16px 
    // cards, chips, badges all grew ~25% and things looked bloated.
    //
    // Putting the html.fontSize write back fixes the proportions.
    // The accessibility text-scale (AccessibilityContext) layers on top
    // with calc(1rem * var(--a11y-text-scale)) so users who set ±1..±5
    // still scale TEXT only, not the layout. the two systems compose.
    document.documentElement.style.setProperty('--font-scale', scale);
    document.documentElement.style.fontSize = `${scale * 16}px`;
  };

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