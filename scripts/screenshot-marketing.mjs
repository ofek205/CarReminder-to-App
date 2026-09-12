/**
 * screenshot-marketing.mjs — captures the marketing-site screenshot set
 * defined in docs/asset-shot-list.md.
 *
 * WHY THIS EXISTS
 * The marketing pages are built from mockups that currently use placeholder
 * vector art. Real product screenshots are the single biggest quality jump
 * available. Doing it by hand means ~27 shots × 2 viewports, re-done every
 * time the UI changes. This script makes it one command.
 *
 * USAGE
 *   1. Start the dev server:      npm run dev
 *   2. Capture the guest shots:   node scripts/screenshot-marketing.mjs
 *   3. Capture everything:        node scripts/screenshot-marketing.mjs --auth
 *
 * Output: docs/assets/shots/shot-<id>-<slug>.png
 *
 * FLAGS
 *   --auth            Also capture shots that require a signed-in account.
 *                     Uses the dev-login shortcut (email "00", password "00")
 *                     which reads DEV_EMAIL / DEV_PASSWORD from .env.local.
 *   --only=H8,B3      Capture just these shot ids.
 *   --mobile-only     Skip the desktop viewport.
 *   --port=5173       Dev server port (default 5173, or PORT env).
 *   --headful         Show the browser. Useful when a shot looks wrong.
 *
 * WHAT IT DOES NOT DO
 *   - It never writes to the database. Guest shots are seeded through
 *     localStorage only. Authenticated shots read whatever the dev account
 *     already has; this script does not create vehicles or maintenance rows.
 *   - It cannot capture /SafetyReminder as a working feature: that page is
 *     admin-gated and the web build is a mock. Not in the list, by design.
 *
 * IMPORTANT — staging and production share one Supabase database. Run the
 * --auth pass with a dedicated test account only.
 */
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'docs', 'assets', 'shots');

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(`--${name}`);
const flagValue = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const PORT = flagValue('port') || process.env.PORT || '5173';
const BASE = `http://localhost:${PORT}`;
const WITH_AUTH = hasFlag('auth');
const MOBILE_ONLY = hasFlag('mobile-only');
const HEADFUL = hasFlag('headful');
const ONLY = flagValue('only')?.split(',').map((s) => s.trim().toUpperCase());

const VIEWPORTS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 2 },
  mobile: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};

/**
 * Demo vehicle seeded into guest localStorage.
 *
 * Deliberately mixes statuses: one date that already passed and one that is
 * close. A screenshot where everything is green does not explain why the
 * product is needed — the whole value proposition is visible only when
 * something needs attention.
 *
 * Plate 12-345-67 is a placeholder pattern, not a real registration.
 */
const daysFromNow = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const SEED_VEHICLE = {
  id: 'guest_demo_marketing',
  nickname: 'הרכב של יעל',
  license_plate: '12-345-67',
  license_plate_normalized: '1234567',
  manufacturer: 'מאזדה',
  model: '3',
  year: 2019,
  vehicle_type: 'רכב',
  fuel_type: 'בנזין',
  transmission: 'אוטומטי',
  current_km: 92400,
  km_update_date: daysFromNow(-4),
  // Real field names from VehicleDetail / demoVehicleData — not test_date.
  test_due_date: daysFromNow(21),
  insurance_due_date: daysFromNow(-3),
  next_service_km: 100000,
};

const SEED_VESSEL = {
  id: 'guest_demo_vessel_marketing',
  nickname: 'סירת הבוקר',
  manufacturer: 'Bayliner',
  model: 'VR5',
  year: 2017,
  vehicle_type: 'סירה מנועית',
  current_engine_hours: 780,
  engine_hours_update_date: daysFromNow(-9),
  // Vessels use test_due_date for כושר שייט.
  test_due_date: daysFromNow(45),
  insurance_due_date: daysFromNow(120),
};

/**
 * Shot definitions. `auth: true` means the shot needs a signed-in account —
 * either because the screen is behind login, or because the data it must show
 * does not exist in guest mode.
 */
const SHOTS = [
  // ── home page ──────────────────────────────────────────────────────────
  { id: 'H1', slug: 'dashboard', route: '/Dashboard', wait: 2200, note: 'Hero — dashboard with a date that needs attention' },
  { id: 'H3', slug: 'vehicle-detail', route: '/Vehicles', wait: 2000, note: 'vehicle list; open a vehicle manually for the detail crop' },
  { id: 'H5', slug: 'reminders', route: '/Notifications', wait: 1800, note: 'date list with mixed statuses' },
  { id: 'H10', slug: 'community-vehicle', route: '/Community', wait: 2600, note: 'community feed, vehicle domain' },
  { id: 'H12', slug: 'vehicle-check', route: '/VehicleCheck', wait: 1600, note: 'plate lookup entry screen' },
  { id: 'H13', slug: 'accidents', route: '/Accidents', wait: 1800 },
  { id: 'H14', slug: 'find-garage', route: '/FindGarage', wait: 3000, note: 'map needs location permission; granted below' },
  { id: 'H16', slug: 'documents', route: '/Documents', wait: 1800 },

  // Needs a signed-in account: AiAssistant reads maintenance_logs from the
  // database, and guest mode has no local store for them. Without rows the
  // "knows about N recent services" line — the whole point of the shot —
  // never renders.
  { id: 'H8', slug: 'ai-expert-baruch', route: '/AiAssistant', wait: 3200, auth: true, note: 'CRITICAL: needs >=8 maintenance rows on the selected vehicle' },
  { id: 'H9', slug: 'ai-expert-yossi', route: '/AiAssistant', wait: 3200, auth: true, note: 'select a vessel first so Yossi is the active persona' },

  // ── business page ──────────────────────────────────────────────────────
  { id: 'B1', slug: 'business-dashboard', route: '/BusinessDashboard', wait: 2600, auth: true },
  { id: 'B3', slug: 'fleet', route: '/Fleet', wait: 2400, auth: true },
  { id: 'B4', slug: 'bulk-import', route: '/BulkAddVehicles', wait: 2000, auth: true },
  { id: 'B5', slug: 'drivers', route: '/Drivers', wait: 2200, auth: true },
  { id: 'B6', slug: 'routes', route: '/Routes', wait: 2200, auth: true },
  { id: 'B9', slug: 'fleet-map', route: '/FleetMap', wait: 3600, auth: true, note: 'filter to one day so it does not read as live tracking' },
  { id: 'B10', slug: 'reports', route: '/Reports', wait: 2800, auth: true },
  { id: 'B11', slug: 'activity-log', route: '/ActivityLog', wait: 2200, auth: true },
  { id: 'B12', slug: 'my-vehicles', route: '/MyVehicles', wait: 2000, auth: true, note: 'driver view — needs an account in the driver role' },
];

const log = (...a) => console.log('[shots]', ...a);

async function seedGuestData(page) {
  await page.evaluateOnNewDocument(
    (vehicle, vessel) => {
      try {
        localStorage.setItem('fleet_guest_vehicles', JSON.stringify([vehicle, vessel]));
        localStorage.setItem('fleet_guest_demo_dismissed', 'true');
        // Suppress first-run tours and popups so they do not cover the screen.
        localStorage.setItem('cr_first_time_tour_done', '1');
        localStorage.setItem('cr_onboarding_done', '1');
      } catch {
        /* private mode — the shot will just show an empty state */
      }
    },
    SEED_VEHICLE,
    SEED_VESSEL,
  );
}

async function devLogin(page) {
  log('signing in via the dev shortcut (00 / 00)');
  await page.goto(`${BASE}/Auth`, { waitUntil: 'networkidle2', timeout: 45_000 });
  await new Promise((r) => setTimeout(r, 1500));

  const typed = await page.evaluate(() => {
    const email = document.querySelector('input[type="email"], input[name="email"]');
    const pass = document.querySelector('input[type="password"], input[name="password"]');
    if (!email || !pass) return false;
    const set = (el, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(email, '00');
    set(pass, '00');
    return true;
  });

  if (!typed) throw new Error('could not find the email/password inputs on /Auth');

  await page.evaluate(() => {
    const form = document.querySelector('form');
    if (form) form.requestSubmit();
    else document.querySelector('button[type="submit"]')?.click();
  });

  await new Promise((r) => setTimeout(r, 6000));
  const stillOnAuth = page.url().includes('/Auth');
  if (stillOnAuth) {
    throw new Error(
      'dev login did not complete. Add DEV_EMAIL and DEV_PASSWORD to .env.local and restart vite, then retry.',
    );
  }
  log('signed in');
}

async function capture(page, shot, viewportName) {
  const viewport = VIEWPORTS[viewportName];
  await page.setViewport(viewport);
  await page.goto(`${BASE}${shot.route}`, { waitUntil: 'networkidle2', timeout: 45_000 });
  await new Promise((r) => setTimeout(r, shot.wait ?? 2000));

  // Hide the update banner and any toast — both are transient chrome that
  // makes a screenshot look broken a week later.
  await page.evaluate(() => {
    const kill = ['[data-update-banner]', '[data-sonner-toaster]', '.sonner-toast'];
    kill.forEach((sel) => document.querySelectorAll(sel).forEach((el) => el.remove()));
  });

  const file = path.join(OUT_DIR, `shot-${shot.id}-${shot.slug}-${viewportName}.png`);
  await page.screenshot({ path: file, fullPage: false });
  log(`${shot.id} ${viewportName} → ${path.relative(process.cwd(), file)}`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  let selected = SHOTS;
  if (ONLY) selected = selected.filter((s) => ONLY.includes(s.id));
  if (!WITH_AUTH) {
    const skipped = selected.filter((s) => s.auth).map((s) => s.id);
    selected = selected.filter((s) => !s.auth);
    if (skipped.length) log(`skipping (need --auth): ${skipped.join(', ')}`);
  }
  if (!selected.length) {
    log('nothing to capture with these flags');
    return;
  }

  const browser = await puppeteer.launch({
    headless: HEADFUL ? false : 'new',
    args: ['--lang=he-IL', '--window-size=1500,1000'],
  });

  try {
    const context = browser.defaultBrowserContext();
    await context.overridePermissions(BASE, ['geolocation']);

    const page = await browser.newPage();
    page.setDefaultTimeout(45_000);
    // Tel Aviv, so the "garages near me" map has something to show.
    await page.setGeolocation({ latitude: 32.0853, longitude: 34.7818 });

    const needsAuth = selected.some((s) => s.auth);
    if (!needsAuth) await seedGuestData(page);

    // Fail fast with a clear message if the dev server is not up.
    try {
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    } catch {
      throw new Error(`dev server is not answering on ${BASE}. Run "npm run dev" first, or pass --port=<port>.`);
    }

    if (WITH_AUTH && needsAuth) await devLogin(page);

    const views = MOBILE_ONLY ? ['mobile'] : ['desktop', 'mobile'];
    for (const shot of selected) {
      for (const view of views) {
        try {
          await capture(page, shot, view);
        } catch (err) {
          log(`FAILED ${shot.id} ${view}: ${err.message}`);
        }
      }
      if (shot.note) log(`  note — ${shot.note}`);
    }

    log(`done. ${selected.length} shots into ${path.relative(process.cwd(), OUT_DIR)}`);
    log('review each one against docs/asset-shot-list.md before using it on the site.');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('[shots] aborted:', err.message);
  process.exitCode = 1;
});
