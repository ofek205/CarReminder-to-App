/**
 * Fire-and-forget / record-keeping writes: popup impressions, EULA acceptance,
 * the contact form, store reviews, and the app-version ping.
 *
 * These are low-stakes and mostly unawaited at the call site, so routing them
 * through the seam buys little on its own. It is done anyway for ONE reason:
 * the seam's whole value rests on the invariant "no screen writes to supabase
 * directly". Leaving stragglers means any future guard placed in the seam
 * (offline fast-fail, impersonation blocking, write auditing) silently has
 * holes. Completeness is the feature.
 *
 * offlineCapable is true for the genuinely append-only records (they are the
 * user's own action and losing ordering doesn't matter), false for the version
 * ping, which is only meaningful about the live session.
 *
 * NOT here, by design: `crashReporter`'s app_errors insert. Telemetry about a
 * broken app must not depend on the layer it would be reporting on (and it
 * would create an import cycle via supabaseQuery → crashReporter). See
 * docs/offline-architecture-spec.md.
 */
import { defineCommand } from '../registry';
import { supabase } from '@/lib/supabase';

defineCommand('telemetry.popupEvent', {
  offlineCapable: true, returnsEnvelope: true, table: 'admin_popup_events',
  run: (payload) => supabase.from('admin_popup_events').insert(payload),
});

defineCommand('telemetry.eulaAccept', {
  offlineCapable: true, returnsEnvelope: true, table: 'eula_acceptances',
  run: ({ rows }) => supabase.from('eula_acceptances').insert(rows),
});

defineCommand('contactMessage.create', {
  offlineCapable: true, returnsEnvelope: true, table: 'contact_messages',
  run: (payload) => supabase.from('contact_messages').insert(payload),
});

defineCommand('review.create', {
  offlineCapable: true, returnsEnvelope: true, table: 'reviews',
  run: (payload) => supabase.from('reviews').insert(payload),
});

// Only meaningful about the CURRENT session, so never queue it.
// Takes friendly names like every other command: passing the raw p_* payload
// straight through would make this the one place where a server-side param
// rename could not be caught at the seam boundary.
defineCommand('telemetry.reportAppVersion', {
  offlineCapable: false, returnsEnvelope: true, kind: 'rpc', table: 'app_version_reports',
  run: ({ platform, version }) =>
    supabase.rpc('report_app_version', { p_platform: platform, p_version: version }),
});
