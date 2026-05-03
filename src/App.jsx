import React from 'react'
import { Toaster as SonnerToaster } from "sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { PinGate } from '@/components/shared/PinLock';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

// Suspense fallback shown while a lazy chunk is loading.
//
// Belt-and-suspenders against a class of bugs we hit on iOS Capacitor +
// WKWebView (iPadOS / iOS 26): dynamic `import()` for a lazy chunk
// occasionally hangs indefinitely — the fetch never resolves and never
// rejects, so React's Suspense stays "pending" forever and the user is
// trapped on a white-screen-with-spinner. The native splash has already
// been dismissed by then, the JS bundle is loaded, but the route's
// sub-bundle never lands. App Review flagged exactly this state as
// Guideline 2.1(a) "blank screen on launch".
//
// Recovery strategy:
//   - 5s: surface a discreet "still loading..." copy + a manual reload
//         button, so the user has agency before we auto-act.
//   - 8s: hard reload the WebView. WKWebView's module loader resets
//         on reload, so the second attempt almost always lands the
//         chunk. A sessionStorage TTL guard prevents reload loops if
//         the chunk is genuinely broken (we fall through to the
//         AppErrorBoundary's "משהו השתבש" UI on the third strike).
const SUSPENSE_AUTO_RELOAD_MS = 8000;
const SUSPENSE_HINT_AFTER_MS = 5000;
const SUSPENSE_RELOAD_TTL_MS = 30 * 1000;

const SuspenseFallback = () => {
  const [phase, setPhase] = React.useState('loading');

  React.useEffect(() => {
    const hintTimer = setTimeout(() => setPhase('slow'), SUSPENSE_HINT_AFTER_MS);
    const reloadTimer = setTimeout(() => {
      try {
        const lastAt = Number(sessionStorage.getItem('cr:suspense-reload-at') || 0);
        if (Date.now() - lastAt > SUSPENSE_RELOAD_TTL_MS) {
          sessionStorage.setItem('cr:suspense-reload-at', String(Date.now()));
          try { console.warn('[suspense] hung > 8s, auto-reloading WebView'); } catch {}
          window.location.reload();
        } else {
          // Already auto-reloaded in the last 30s and we're hung again.
          // Don't loop — leave the manual button visible.
          setPhase('stuck');
        }
      } catch {
        setPhase('stuck');
      }
    }, SUSPENSE_AUTO_RELOAD_MS);
    return () => { clearTimeout(hintTimer); clearTimeout(reloadTimer); };
  }, []);

  return (
    <div dir="rtl" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', fontFamily: 'system-ui' }}>
      <div style={{ textAlign: 'center', maxWidth: 280 }}>
        <div style={{ width: 40, height: 40, border: '3px solid #D8E5D9', borderTopColor: '#2D5233', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
        <p style={{ color: '#6B7280', fontSize: 14, marginBottom: 6 }}>טוען...</p>
        {phase !== 'loading' && (
          <>
            <p style={{ color: '#9CA3AF', fontSize: 12, marginBottom: 14 }}>
              {phase === 'slow' ? 'הטעינה לוקחת יותר מהרגיל' : 'הטעינה נתקעה. נסה לרענן.'}
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{ padding: '8px 22px', borderRadius: 10, background: '#2D5233', color: '#fff', fontWeight: 700, border: 'none', cursor: 'pointer', fontSize: 13 }}
            >
              רענן
            </button>
          </>
        )}
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
};

const LayoutWrapper = ({ children, currentPageName }) => {
  return Layout ? (
    <Layout currentPageName={currentPageName}>
      <React.Suspense fallback={<SuspenseFallback />}>
        {children}
      </React.Suspense>
    </Layout>
  ) : (
    <React.Suspense fallback={<SuspenseFallback />}>
      {children}
    </React.Suspense>
  );
};

// Detect the "stale chunk" error thrown when the browser tries to load
// a lazy module whose hash changed (new deploy landed / Vite HMR
// regenerated the module). The fix is a hard reload — the old bundle
// references the old chunk, the new bundle will resolve correctly.
const STALE_CHUNK_RE = /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|error loading dynamically imported module/i;
// Time to suppress retry-on-reload after we just attempted one. If a
// reload happens AND the chunk still fails 30s later, something else
// is genuinely broken (CDN outage, persistent network problem) — at
// that point we stop auto-reloading and show the manual recovery UI.
// 30s is enough to cover normal redeploy + edge-cache propagation.
const STALE_RELOAD_TTL_MS = 30 * 1000;

//  Error Boundary. catches unhandled renders / throws
class AppErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, errorMsg: '', isStaleChunk: false }; }
  static getDerivedStateFromError(err) {
    const msg = err?.message || String(err);
    const isStaleChunk = STALE_CHUNK_RE.test(msg);
    // For stale-chunk errors we render a calm "מתעדכן..." overlay
    // instead of the alarming "משהו השתבש" screen, since the
    // followup auto-reload almost always fixes it transparently.
    return { hasError: true, errorMsg: msg, isStaleChunk };
  }
  componentDidCatch(err, info) {
    console.error('AppErrorBoundary caught:', err, info?.componentStack);

    // Stale-chunk errors after a deploy: auto-reload, but with a TTL
    // guard so we don't loop forever if something else is persistently
    // broken. Old code stored a permanent session flag, so a single
    // failed reload would block ALL subsequent auto-fixes for the
    // entire session — exactly the case the user reported.
    if (STALE_CHUNK_RE.test(err?.message || '')) {
      try {
        const lastAt = Number(sessionStorage.getItem('cr:stale-chunk-reload-at') || 0);
        const since = Date.now() - lastAt;
        if (since > STALE_RELOAD_TTL_MS) {
          sessionStorage.setItem('cr:stale-chunk-reload-at', String(Date.now()));
          window.location.reload();
          return;
        }
        // Just reloaded < 30s ago and still hit it — fall through to
        // the manual-retry UI. setState here keeps the user from
        // staring at the "מתעדכן..." screen forever; we promote the
        // recovery affordance to "lol something's wrong, click here".
        this.setState({ isStaleChunk: false });
      } catch {}
    }

    // Send to crashReporter so the Admin → Bugs tab + app_errors table
    // see it too. Dynamic import so the reporter doesn't inflate the
    // critical path; fire-and-forget (it already swallows its own errors).
    import('./lib/crashReporter.js')
      .then(m => m.reportError('react_render', err, { stack: info?.componentStack }))
      .catch(() => {});
  }
  render() {
    if (this.state.hasError) {
      // Stale-chunk auto-recovery view. No alarming "משהו השתבש".
      // The reload triggered in componentDidCatch will replace this
      // screen within a beat; if for some reason it doesn't (rare),
      // the manual button is still here.
      if (this.state.isStaleChunk) {
        return (
          <div dir="rtl" style={{ padding: 40, textAlign: 'center', fontFamily: 'system-ui', minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 44, height: 44, border: '3px solid #D8E5D9', borderTopColor: '#2D5233', borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginBottom: 20 }} />
            <p style={{ fontSize: 16, fontWeight: 700, color: '#1F2937', marginBottom: 6 }}>מעדכן לגרסה חדשה...</p>
            <p style={{ fontSize: 13, color: '#6B7280' }}>שנייה אחת</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        );
      }
      return (
        <div dir="rtl" style={{ padding: 40, textAlign: 'center', fontFamily: 'system-ui' }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>משהו השתבש 😕</h2>
          <p style={{ color: '#666', marginBottom: 8 }}>נסה לרענן את הדף</p>
          {this.state.errorMsg && (
            <p style={{ color: '#DC2626', fontSize: 11, marginBottom: 16, direction: 'ltr', maxWidth: 300, margin: '0 auto 16px', wordBreak: 'break-all' }}>
              {this.state.errorMsg}
            </p>
          )}
          <button onClick={() => { this.setState({ hasError: false }); window.location.reload(); }}
            style={{ padding: '10px 28px', borderRadius: 12, background: '#2D5233', color: '#fff', fontWeight: 700, border: 'none', cursor: 'pointer' }}>
            רענן
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  return (
    <div>
      <AppErrorBoundary>
        <QueryClientProvider client={queryClientInstance}>
          <Router>
            <NavigationTracker />
            <PinGate>
            <Routes>
              <Route path="/" element={
                <LayoutWrapper currentPageName={mainPageKey}>
                  <MainPage />
                </LayoutWrapper>
              } />
              {Object.entries(Pages).map(([path, Page]) => (
                <Route
                  key={path}
                  path={`/${path}`}
                  element={
                    <LayoutWrapper currentPageName={path}>
                      <Page />
                    </LayoutWrapper>
                  }
                />
              ))}
              <Route path="*" element={
                <LayoutWrapper currentPageName="NotFound">
                  <PageNotFound />
                </LayoutWrapper>
              } />
            </Routes>
            </PinGate>
          </Router>
        </QueryClientProvider>
      </AppErrorBoundary>
      {/* sonner is the ONLY toast renderer — the old shadcn Toaster was
          mounted but received no toasts (every caller uses sonner's toast())
          so it was pure dead code + 3 unused npm deps. */}
      <SonnerToaster position="top-center" dir="rtl" richColors theme="light" />
    </div>
  )
}

export default App
