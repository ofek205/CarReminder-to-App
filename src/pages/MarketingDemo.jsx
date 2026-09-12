/**
 * Entry point for the marketing site's read-only app preview.
 *
 * This route renders nothing of its own. Its only job is to hand the visitor
 * straight to the app's home screen, because the spec is explicit that the
 * preview must open on the home screen with the demo vehicles and never on
 * a sign-in screen.
 *
 * Demo mode itself is NOT switched on here. lib/demoMode reads it from the
 * URL at import time, because this route is lazy-loaded: an earlier version
 * called an enableDemoMode() at this module's scope and the flag arrived
 * after Layout had already built the real auth tree and redirected to /Auth.
 *
 * `replace` keeps the entry path out of history, so the visitor cannot land
 * back on a bare redirect by going back inside the frame.
 */
import React from 'react';
import { Navigate } from 'react-router-dom';
import { DEMO_HOME_ID, pathForScreen } from '@/lib/demoScreens';

// From the screen registry rather than a literal, so the opening screen and
// the selector's opening mark can never disagree: both read DEMO_HOME_ID.
const HOME_PATH = pathForScreen(DEMO_HOME_ID);

export default function MarketingDemo() {
  return <Navigate to={HOME_PATH} replace />;
}
