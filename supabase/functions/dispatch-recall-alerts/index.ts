// ═══════════════════════════════════════════════════════════════════════════
// dispatch-recall-alerts — proactive recall notifications for saved vehicles.
//
// Daily (pg_cron): downloads the MoT open-recall dataset (per-plate), matches
// each saved vehicle by its license plate, and notifies the vehicle's owner
// (in-app + native push via the app_notifications AFTER-INSERT trigger) for
// every OPEN recall not yet notified. A dedup table (vehicle_recall_alerts)
// guarantees one notification per (vehicle, recall) — a still-open recall is
// never re-sent.
//
// Matching is by PLATE, so it is exact to the specific vehicle (no model/year
// guessing). Notifications carry the defect text + the importer phone (joined
// from the recall-campaign catalog) so the owner knows what to do.
//
// POST { "dry_run": true } → returns the match count + a sample WITHOUT
// notifying or writing dedup rows. Always dry-run first.
//
// Auth: X-Dispatch-Secret (same as the other dispatch functions — NOT JWT).
// Deploy: Dashboard → Edge Functions → dispatch-recall-alerts → Verify JWT: OFF.
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const GOV_BASE = 'https://data.gov.il/api/3/action/datastore_search';
const OPEN_RECALL_RESOURCE_ID = '36bf1404-0be4-49d2-82dc-2f1ead4a8b93';
const RECALL_CAMPAIGN_RESOURCE_ID = '2c33523f-87aa-44ec-a736-edbb0a82975e';
const PAGE = 20000;        // rows per gov.il page
const MAX_PAGES = 20;      // safety cap (covers ~400K rows; dataset ~136K)

// Only NEWLY-OPENED recalls earn a proactive notification. A recall that
// has been open for years (the owner simply never did the free fix) is NOT
// news — pushing it on every cron run (and again whenever the vehicle row is
// re-created, since the per-vehicle_id dedup resets) is exactly the spam a
// user reported: decade-old recalls (opened 2014 / 2017) re-alerting.
//
// "New" = opened within RECALL_FRESH_DAYS of today, measured from the gov.il
// TAARICH_PTICHA (recall opening date). The window absorbs gov.il refresh lag
// and any skipped cron day. Old recalls are NEVER notified — they still
// surface in the in-vehicle RecallCard (fetchOpenRecallsForPlate), which is
// the right place for "this car has an outstanding recall" context.
const RECALL_FRESH_DAYS = 30;

// Parse a gov.il TAARICH_PTICHA into a Date. Observed format is ISO
// 'YYYY-MM-DD'; we also tolerate 'DD/MM/YYYY' defensively. Returns null when
// missing/unparseable so the caller can treat it as NOT fresh (conservative:
// no date ⇒ assume old ⇒ don't notify).
function parseRecallDate(raw: unknown): Date | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);          // YYYY-MM-DD
  if (m) { const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return isNaN(d.getTime()) ? null : d; }
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);            // DD/MM/YYYY
  if (m) { const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])); return isNaN(d.getTime()) ? null : d; }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// A recall is "fresh" iff its opening date is within RECALL_FRESH_DAYS of now.
function isFreshRecall(openedDate: unknown): boolean {
  const d = parseRecallDate(openedDate);
  if (!d) return false;                                 // unknown date ⇒ not fresh
  const ageDays = (Date.now() - d.getTime()) / 86_400_000;
  return ageDays >= 0 && ageDays <= RECALL_FRESH_DAYS;  // future-dated guarded too
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');

async function reportEdgeError(action: string, error: unknown, extra?: Record<string, unknown>) {
  const FN = 'dispatch-recall-alerts';
  const err = error as { message?: string; stack?: string } | null;
  const message = (err?.message || String(error) || 'unknown').slice(0, 500);
  try { console.error(JSON.stringify({ _: 'edge_error', fn: FN, action, message })); } catch {}
  try {
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    await sb.from('app_errors').insert({
      type: 'edge', message, stack: (err?.stack || '').slice(0, 2000) || null,
      url: `edge:/${FN}`, route: `edge:/${FN}`, action, severity: 'error', visible: false,
      app_version: 'edge', user_agent: 'edge-function', extra: { fn: FN, ...(extra || {}) },
      created_at: new Date().toISOString(),
    });
  } catch {}
}

// Download the whole per-plate open-recall dataset → Map<plateDigits, recall[]>.
async function buildRecallMap(): Promise<Map<string, any[]>> {
  const map = new Map<string, any[]>();
  const fields = 'MISPAR_RECHEV,RECALL_ID,SUG_RECALL,SUG_TAKALA,TEUR_TAKALA,TAARICH_PTICHA';
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${GOV_BASE}?resource_id=${OPEN_RECALL_RESOURCE_ID}&limit=${PAGE}&offset=${page * PAGE}&fields=${encodeURIComponent(fields)}`;
    const res = await fetch(url);
    if (!res.ok) break;
    const recs = (await res.json())?.result?.records;
    if (!Array.isArray(recs) || recs.length === 0) break;
    for (const r of recs) {
      const plate = digits(r.MISPAR_RECHEV);
      if (!plate) continue;
      const entry = {
        recall_id: r.RECALL_ID != null ? String(r.RECALL_ID) : null,
        type: r.SUG_RECALL || '',
        defectType: r.SUG_TAKALA || '',
        description: r.TEUR_TAKALA || '',
        openedDate: r.TAARICH_PTICHA || '',
      };
      if (!entry.recall_id) continue;
      const arr = map.get(plate);
      if (arr) arr.push(entry); else map.set(plate, [entry]);
    }
    if (recs.length < PAGE) break;
  }
  return map;
}

// Importer phone for a recall campaign, by RECALL_ID. Best-effort, cached.
const campaignCache = new Map<string, { phone: string; website: string } | null>();
async function campaignContact(recallId: string) {
  if (campaignCache.has(recallId)) return campaignCache.get(recallId)!;
  let out: { phone: string; website: string } | null = null;
  try {
    const filters = encodeURIComponent(JSON.stringify({ RECALL_ID: Number(recallId) }));
    const url = `${GOV_BASE}?resource_id=${RECALL_CAMPAIGN_RESOURCE_ID}&filters=${filters}&limit=1`;
    const res = await fetch(url);
    if (res.ok) {
      const r = (await res.json())?.result?.records?.[0];
      if (r) out = { phone: String(r.TELEPHONE || '').slice(0, 40), website: String(r.WEBSITE || '').slice(0, 200) };
    }
  } catch { /* best-effort */ }
  campaignCache.set(recallId, out);
  return out;
}

// Paginated full-table select. PostgREST caps a single select at ~1000
// rows; without this we'd silently miss vehicles (→ missed recalls) and
// dedup rows (→ duplicate alerts) once either table grows past 1000.
async function selectAll(sb: any, table: string, columns: string): Promise<any[]> {
  const SIZE = 1000;
  const out: any[] = [];
  for (let from = 0; ; from += SIZE) {
    const { data, error } = await sb.from(table).select(columns).range(from, from + SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < SIZE) break;
  }
  return out;
}

serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') return new Response('ok', { status: 200 });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const secret = req.headers.get('x-dispatch-secret');
    if (!secret) return json({ error: 'Unauthorized' }, 401);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: valid, error: authErr } = await supabase.rpc('verify_dispatch_secret', { p_secret: secret });
    if (authErr || !valid) return json({ error: 'Unauthorized', detail: authErr?.message }, 401);

    let dryRun = false;
    try { dryRun = (await req.json())?.dry_run === true; } catch { /* defaults */ }

    // 1) Recall dataset → plate map.
    const recallMap = await buildRecallMap();
    if (recallMap.size === 0) {
      await reportEdgeError('empty_recall_dataset', new Error('gov.il returned no recall rows'));
      return json({ ok: false, error: 'recall dataset empty/unreachable' }, 502);
    }

    // 2) Our vehicles + owner. Paginated (PostgREST 1000-row cap) so we
    // never silently skip vehicles once the fleet grows past 1000.
    let vehicles: any[];
    try {
      vehicles = await selectAll(supabase, 'vehicles',
        'id, license_plate, license_plate_normalized, nickname, manufacturer, model, account_id');
    } catch (vErr) { await reportEdgeError('load_vehicles', vErr); return json({ error: (vErr as any)?.message }, 500); }

    // Resolve account owners. Chunk the .in() list (also 1000-capped, and
    // a huge IN blows the URL length) into batches.
    const accountIds = [...new Set(vehicles.map((v: any) => v.account_id).filter(Boolean))];
    const ownerByAccount = new Map<string, string>();
    for (let i = 0; i < accountIds.length; i += 500) {
      const chunk = accountIds.slice(i, i + 500);
      const { data: accts } = await supabase.from('accounts').select('id, owner_user_id').in('id', chunk);
      for (const a of (accts || [])) if (a.owner_user_id) ownerByAccount.set(a.id, a.owner_user_id);
    }

    // 3) Already-notified (vehicle_id, recall_id) pairs — paginated so the
    // dedup set stays complete past 1000 rows (else we'd re-notify).
    let existing: any[] = [];
    try { existing = await selectAll(supabase, 'vehicle_recall_alerts', 'vehicle_id, recall_id'); }
    catch (eErr) { await reportEdgeError('load_dedup', eErr); }
    const seen = new Set(existing.map((r: any) => `${r.vehicle_id}:${r.recall_id}`));

    // 4) Compute NEW matches. A match is notify-worthy only when it is BOTH
    //    (a) freshly opened (within RECALL_FRESH_DAYS) — old recalls are
    //        context, not news — AND
    //    (b) not already notified for this exact (vehicle, recall) pair.
    type NewAlert = { vehicle: any; userId: string; recall: any };
    const newAlerts: NewAlert[] = [];
    let skippedStale = 0;   // matched a saved vehicle but the recall is old
    for (const v of vehicles) {
      const plate = digits(v.license_plate_normalized || v.license_plate);
      if (!plate) continue;
      const recalls = recallMap.get(plate);
      if (!recalls) continue;
      const userId = ownerByAccount.get(v.account_id);
      if (!userId) continue;
      for (const rec of recalls) {
        if (seen.has(`${v.id}:${rec.recall_id}`)) continue;
        if (!isFreshRecall(rec.openedDate)) { skippedStale++; continue; }
        newAlerts.push({ vehicle: v, userId, recall: rec });
      }
    }

    if (dryRun) {
      return json({
        ok: true, dry_run: true,
        recall_plates: recallMap.size,
        vehicles_scanned: vehicles.length,
        fresh_window_days: RECALL_FRESH_DAYS,
        skipped_stale: skippedStale,
        new_alerts: newAlerts.length,
        sample: newAlerts.slice(0, 20).map(a => ({
          plate: a.vehicle.license_plate, recall_id: a.recall.recall_id,
          opened: a.recall.openedDate,
          defect: (a.recall.description || '').slice(0, 80),
        })),
      });
    }

    // 5) Notify + record dedup.
    let sent = 0, failed = 0, dedupErrors = 0;
    for (const a of newAlerts) {
      const name = (a.vehicle.nickname || [a.vehicle.manufacturer, a.vehicle.model].filter(Boolean).join(' ') || 'הרכב שלך').trim();
      const contact = a.recall.recall_id ? await campaignContact(a.recall.recall_id) : null;
      const defect = (a.recall.description || a.recall.defectType || 'קריאת שירות').slice(0, 200);
      const phonePart = contact?.phone ? ` לתיאום מול היבואן: ${contact.phone}.` : '';
      const title = 'קריאת ריקול פתוחה לרכב שלך';
      const body = `${name}: ${defect}. התיקון אצל היבואן ללא עלות.${phonePart}`;

      // Notify FIRST. If the notification insert fails we must NOT write a
      // dedup row — that would suppress this alert forever. Only a confirmed
      // send earns a dedup record.
      const { error: nErr } = await supabase.from('app_notifications').insert({
        user_id: a.userId,
        type: 'recall',
        title,
        body,
        data: {
          vehicle_id: a.vehicle.id,
          recall_id: a.recall.recall_id,
          plate: a.vehicle.license_plate,
          defect_type: a.recall.defectType || null,
          phone: contact?.phone || null,
          website: contact?.website || null,
        },
      });
      if (nErr) {
        failed++;
        await reportEdgeError('notify_recall', nErr, { vehicle_id: a.vehicle.id, recall_id: a.recall.recall_id });
        await new Promise(r => setTimeout(r, 120));
        continue;
      }
      sent++;

      // Record dedup idempotently: ignoreDuplicates makes a retried/concurrent
      // run a no-op. A dedup-only write failure is logged but NOT counted as a
      // send failure (the user already got the notification) — worst case it
      // re-notifies next run, which is better than silently dropping it.
      const { error: dErr } = await supabase.from('vehicle_recall_alerts').upsert(
        { vehicle_id: a.vehicle.id, user_id: a.userId, recall_id: a.recall.recall_id, defect },
        { onConflict: 'vehicle_id,recall_id', ignoreDuplicates: true },
      );
      if (dErr) {
        dedupErrors++;
        await reportEdgeError('dedup_write', dErr, { vehicle_id: a.vehicle.id, recall_id: a.recall.recall_id });
      }
      await new Promise(r => setTimeout(r, 120)); // gentle pacing
    }

    return json({ ok: true, recall_plates: recallMap.size, vehicles_scanned: vehicles.length, new_alerts: newAlerts.length, sent, failed, dedup_errors: dedupErrors });
  } catch (err: any) {
    await reportEdgeError('recall_main', err);
    return json({ error: err?.message || 'Unknown error' }, 500);
  }
});
