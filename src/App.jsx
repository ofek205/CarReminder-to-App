import React from 'react'
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const SuspenseFallback = () => (
  <div dir="rtl" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', fontFamily: 'system-ui' }}>
    <div style={{ textAlign: 'center' }}>
      <div style={{ width: 40, height: 40, border: '3px solid #D8E5D9', borderTopColor: '#2D5233', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
      <p style={{ color: '#6B7280', fontSize: 14 }}>טוען...</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  </div>
);

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

// ── Error Boundary — catches unhandled errors (e.g. Base44 SDK crashes) ────
class AppErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, errorMsg: '' }; }
  static getDerivedStateFromError(err) { return { hasError: true, errorMsg: err?.message || String(err) }; }
  componentDidCatch(err, info) { console.error('AppErrorBoundary caught:', err, info?.componentStack); }
  render() {
    if (this.state.hasError) {
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
          </Router>
          <Toaster />
        </QueryClientProvider>
      </AppErrorBoundary>
      <SonnerToaster position="top-center" dir="rtl" richColors theme="light" />
    </div>
  )
}

export default App
