import React from 'react';

/**
 * Error boundary that catches crashes in child components
 * and shows a friendly message instead of crashing the whole page.
 * Used during Base44→Supabase migration for components not yet migrated.
 */
export class SafeComponent extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.warn(`[SafeComponent] ${this.props.label || 'Component'} crashed:`, error.message);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || null;
    }
    return this.props.children;
  }
}
