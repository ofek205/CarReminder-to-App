/**
 * Digital ownership transfer — the RPCs from
 * supabase-vehicle-transfer-2026-09-11.sql.
 *
 * These are the sibling of the `share.*` commands in access.js, and they are
 * written to look like them on purpose: a transfer is offered by EMAIL, the
 * recipient approves or declines it, and both sides get a notification. The one
 * behavioural difference is what accepting does — a share grants access to the
 * sender's vehicle, a transfer copies the history into the recipient's account
 * and archives the sender's copy.
 *
 * The namespace is `vehicleTransfer.*`, not `transfer.*`, because
 * `ownership.transfer` in access.js already means something else entirely
 * (moving an ACCOUNT's ownership between members). Two unrelated things called
 * "transfer" in one registry is how a wrong RPC gets called from a screen.
 *
 * EVERY command is offlineCapable: false, and that is not a judgement call.
 * Each one crosses an account boundary and is arbitrated entirely by the
 * server: `offer` proves ownership from the caller's membership, `accept` locks
 * the row FOR UPDATE and checks the accepting user's own email against the
 * invited address before deciding. Replaying a queued accept against a transfer
 * that has since been cancelled or expired is exactly the failure that lock
 * exists to prevent; a queue would reintroduce it from the client side after
 * the server had already closed it.
 *
 * All declare `returnsEnvelope: true` because `supabase.rpc` resolves to
 * `{ data, error }` rather than throwing, and the call sites map the raised
 * names (transfer_already_pending, transfer_expired, transfer_email_mismatch …)
 * to Hebrew copy, so the envelope must pass through untouched.
 *
 * Note what is NOT here: no command writes to `vehicle_transfers` directly. The
 * table's only client-facing policy is a SELECT for the two parties; every
 * write goes through a SECURITY DEFINER function.
 */
import { defineCommand } from '../registry';
import { supabase } from '@/lib/supabase';

const online = { offlineCapable: false, kind: 'rpc', returnsEnvelope: true, table: 'vehicle_transfers' };

// Seller: offer the vehicle to an email address. The manifest records what they
// chose to include; it is stored on the row and read back at accept time, never
// re-supplied by whoever accepts.
//
// Returns { transfer_id, invite_token, recipient_existing_user, expires_at },
// the same shape share_vehicle_with_email returns, so the dialog branches the
// same way: an existing user already has an in-app notification waiting, and
// either way the client sends the email itself.
defineCommand('vehicleTransfer.offer', {
  ...online,
  run: ({ vehicleId, email, manifest }) =>
    supabase.rpc('transfer_vehicle_to_email', {
      p_vehicle_id: vehicleId,
      p_email: email,
      p_manifest: manifest ?? {},
    }),
});

// Recipient, possibly not signed in yet: what is behind this link?
//
// Returns counts, a date range and the manifest — no row content and no licence
// plate. A transfer link travels through WhatsApp, browser history and Referer
// headers, and a plate identifies a car and, through the ministry registry, its
// owner. An unknown or expired token returns zero rows rather than an error, so
// a stranger guessing tokens learns nothing from the difference.
defineCommand('vehicleTransfer.preview', {
  ...online,
  // Either identifier. A token IS the authorisation, so that branch answers
  // anyone. An id is not a secret — it travels in notification payloads and
  // URLs — so the server additionally requires a signed-in caller whose own
  // email matches the invited address before it answers.
  run: ({ token, transferId }) =>
    supabase.rpc('preview_vehicle_transfer', {
      p_token: token ?? null,
      p_transfer_id: transferId ?? null,
    }),
});

// Recipient: take it. One transaction on the server creates the vehicle in the
// accepting user's account, copies the manifest-selected history keeping each
// row's ORIGINAL created_at, and moves the sender's copy to a read-only
// archive.
//
// Either the id (in-app, from the notification) or the token (from the link)
// identifies the transfer; the DESTINATION account is never a parameter. It
// comes from auth.uid() server-side, so there is no argument through which a
// caller could aim the copy somewhere else.
defineCommand('vehicleTransfer.accept', {
  ...online,
  run: ({ transferId, token }) =>
    supabase.rpc('accept_vehicle_transfer', {
      p_transfer_id: transferId ?? null,
      p_token: token ?? null,
    }),
});

// Recipient: no thanks. The sender is notified and keeps the vehicle untouched.
//
// Takes either identifier for the same reason accept does: a recipient who
// arrived from the link holds a token and never sees the row id, and the two
// buttons live on one screen. Offering only accept to a link-arriving user
// would turn every refusal into silence, which the sender cannot tell apart
// from "has not opened it yet".
defineCommand('vehicleTransfer.decline', {
  ...online,
  run: ({ transferId, token }) =>
    supabase.rpc('decline_vehicle_transfer', {
      p_transfer_id: transferId ?? null,
      p_token: token ?? null,
    }),
});

// Sender: withdraw an offer that has not been answered. This is also what
// unfreezes the vehicle's history, so it is reachable from the vehicle screen
// and not only from the offer row.
defineCommand('vehicleTransfer.cancel', {
  ...online,
  run: ({ transferId }) =>
    supabase.rpc('cancel_vehicle_transfer', { p_transfer_id: transferId }),
});

// Sender: the offers on one vehicle, newest first. Server-side filtered by the
// caller's membership in the sending account.
defineCommand('vehicleTransfer.list', {
  ...online,
  run: ({ vehicleId }) =>
    supabase.rpc('list_vehicle_transfers', { p_vehicle_id: vehicleId }),
});
