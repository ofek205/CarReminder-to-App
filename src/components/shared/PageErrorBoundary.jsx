import React from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { reportError } from '@/lib/crashReporter';

/**
 * PageErrorBoundary — per-route React Error Boundary.
 *
 * Wraps each routed `<Page />` so a render-time crash in one screen
 * (e.g. a malformed user record breaks AdminUsers) doesn't take down
 * the entire shell. The user sees a friendly Hebrew RTL fallback with
 * "נסה שוב" and "חזרה לדשבורד" actions.
 *
 * The boundary catches:
 *   ✓ render throws
 *   ✓ lifecycle throws (componentDidMount, etc.)
 *   ✓ effect-init throws inside useEffect synchronous part
 *
 * The boundary does NOT catch:
 *   ✗ event handler throws (those go through window.onerror anyway)
 *   ✗ async errors (promise rejections — caught via unhandledrejection)
 *
 * Every catch is reported to app_errors with type='React',
 * severity='critical', and the route from props.routeName so the admin
 * can group "all crashes that happened on /AdminUsers".
 */
class PageErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, key: 0 };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    try {
      reportError('React', error, {
        action: 'page_render',
        severity: 'critical',
        visible: true,
        page: this.props.routeName || 'unknown',
        component_stack: (info?.componentStack || '').slice(0, 2000),
      });
    } catch {
      // Reporter itself failed — fall back to console so dev sees it.

      console.error('[PageErrorBoundary] report failed:', error, info);
    }
  }

  handleRetry = () => {
    // Bump key to force a remount of children — many transient errors
    // (network blip during initial fetch) recover on a second try.
    this.setState((s) => ({ hasError: false, error: null, key: s.key + 1 }));
  };

  handleHome = () => {
    // Hard navigate to the root; bypasses the broken route entirely.
    try { window.location.href = '/'; } catch {}
  };

  render() {
    if (!this.state.hasError) {
      // Pass key to force a fresh mount cycle when "נסה שוב" is clicked.
      return React.cloneElement(
        React.Children.only(this.props.children),
        { key: this.state.key }
      );
    }

    return (
      <div className="p-4 sm:p-6 max-w-md mx-auto" dir="rtl">
        <Card className="p-6 text-center">
          <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-amber-500" />
          <h2 className="text-lg font-bold mb-1.5 text-gray-900">
            המסך הזה לא נטען
          </h2>
          <p className="text-sm text-gray-600 mb-4 leading-relaxed">
            משהו השתבש בטעינה. אפשר לנסות שוב או לחזור לדשבורד.
          </p>
          {this.state.error?.message && (
            <p className="text-[11px] text-gray-400 mb-4 font-mono text-left" dir="ltr">
              {String(this.state.error.message).slice(0, 200)}
            </p>
          )}
          <div className="flex gap-2 justify-center">
            <Button onClick={this.handleRetry} className="gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" />
              נסה שוב
            </Button>
            <Button variant="outline" onClick={this.handleHome} className="gap-1.5">
              <Home className="w-3.5 h-3.5" />
              לדשבורד
            </Button>
          </div>
        </Card>
      </div>
    );
  }
}

export default PageErrorBoundary;
