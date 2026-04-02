/**
 * Anonymous analytics — no personal data, just event counters.
 * Uses Supabase upsert with UNIQUE(event, date) to increment daily counters.
 */
import { supabase } from './supabase';

/**
 * Track an anonymous event. Increments a daily counter.
 * @param {string} event - Event name (e.g. 'guest_session', 'page_view')
 * @param {object} metadata - Optional metadata (no PII!)
 */
export async function trackEvent(event, metadata = {}) {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Try to increment existing row
    const { data: existing } = await supabase
      .from('anonymous_analytics')
      .select('id, count')
      .eq('event', event)
      .eq('date', today)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('anonymous_analytics')
        .update({ count: existing.count + 1, metadata })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('anonymous_analytics')
        .insert({ event, date: today, count: 1, metadata });
    }
  } catch (e) {
    // Silent — analytics should never break the app
  }
}

/** Pre-defined events */
export const EVENTS = {
  GUEST_SESSION: 'guest_session',
  GUEST_VEHICLE_ADDED: 'guest_vehicle_added',
  AUTH_LOGIN: 'auth_login',
  AUTH_SIGNUP: 'auth_signup',
  VEHICLE_ADDED: 'vehicle_added',
  INVITE_CREATED: 'invite_created',
  INVITE_ACCEPTED: 'invite_accepted',
  PAGE_VIEW: 'page_view',
};
