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

    // 2) Our vehicles + owner. Two simple queries (robust vs embedded joins).
    const { data: vehicles, error: vErr } = await supabase
      .from('vehicles')
      .select('id, license_plate, license_plate_normalized, nickname, manufacturer, model, account_id');
    if (vErr) { await reportEdgeError('load_vehicles', vErr); return json({ error: vErr.message }, 500); }

    const accountIds = [...new Set((vehicles || []).map((v: any) => v.account_id).filter(Boolean))];
    const ownerByAccount = new Map<string, string>();
    if (accountIds.length) {
      const { data: accts } = await supabase.from('accounts').select('id, owner_user_id').in('id', accountIds);
      for (const a of (accts || [])) if (a.owner_user_id) ownerByAccount.set(a.id, a.owner_user_id);
    }

    // 3) Already-notified (vehicle_id, recall_id) pairs.
    const { data: existing } = await supabase.from('vehicle_recall_alerts').select('vehicle_id, recall_id');
    const seen = new Set((existing || []).map((r: any) => `${r.vehicle_id}:${r.recall_id}`));

    // 4) Compute NEW matches.
    type NewAlert = { vehicle: any; userId: string; recall: any };
    const newAlerts: NewAlert[] = [];
    for (const v of (vehicles || [])) {
      const plate = digits(v.license_plate_normalized || v.license_plate);
      if (!plate) continue;
      const recalls = recallMap.get(plate);
      if (!recalls) continue;
      const userId = ownerByAccount.get(v.account_id);
      if (!userId) continue;
      for (const rec of recalls) {
        if (seen.has(`${v.id}:${rec.recall_id}`)) continue;
        newAlerts.push({ vehicle: v, userId, recall: rec });
      }
    }

    if (dryRun) {
      return json({
        ok: true, dry_run: true,
        recall_plates: recallMap.size,
        vehicles_scanned: vehicles?.length || 0,
        new_alerts: newAlerts.length,
        sample: newAlerts.slice(0, 20).map(a => ({
          plate: a.vehicle.license_plate, recall_id: a.recall.recall_id,
          defect: (a.recall.description || '').slice(0, 80),
        })),
      });
    }

    // 5) Notify + record dedup.
    let sent = 0, failed = 0;
    for (const a of newAlerts) {
      const name = (a.vehicle.nickname || [a.vehicle.manufacturer, a.vehicle.model].filter(Boolean).join(' ') || 'הרכב שלך').trim();
      const contact = a.recall.recall_id ? await campaignContact(a.recall.recall_id) : null;
      const defect = (a.recall.description || a.recall.defectType || 'קריאת שירות').slice(0, 200);
      const phonePart = contact?.phone ? ` לתיאום מול היבואן: ${contact.phone}.` : '';
      const title = 'קריאת ריקול פתוחה לרכב שלך';
      const body = `${name}: ${defect}. התיקון אצל היבואן ללא עלות.${phonePart}`;
      try {
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
        if (nErr) throw nErr;
        // Record dedup AFTER a successful notification insert.
        await supabase.from('vehicle_recall_alerts').insert({
          vehicle_id: a.vehicle.id, user_id: a.userId,
          recall_id: a.recall.recall_id, defect,
        });
        sent++;
      } catch (err) {
        failed++;
        await reportEdgeError('notify_recall', err, { vehicle_id: a.vehicle.id, recall_id: a.recall.recall_id });
      }
      await new Promise(r => setTimeout(r, 120)); // gentle pacing
    }

    return json({ ok: true, recall_plates: recallMap.size, vehicles_scanned: vehicles?.length || 0, new_alerts: newAlerts.length, sent, failed });
  } catch (err: any) {
    await reportEdgeError('recall_main', err);
    return json({ error: err?.message || 'Unknown error' }, 500);
  }
});
