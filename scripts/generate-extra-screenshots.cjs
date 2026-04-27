/**
 * Extra App Store screenshots — supplementary shots beyond the
 * 7 already captured by generate-app-store-screenshots.cjs.
 *
 * These cover features that need a specific vehicle ID or that
 * showcase unique selling points (vessel UI, scan wizard, etc.).
 *
 * Files are written as 08-…png … 14-…png so the original 7 stay
 * intact. Same 1290×2796 size, same privacy CSS.
 *
 * USAGE:
 *   node scripts/generate-extra-screenshots.cjs <email> <password>
 */
const fs   = require('fs');
const path = require('path');
const puppeteer = require(path.join(process.cwd(), 'node_modules', 'puppeteer'));

const [EMAIL, PASSWORD] = process.argv.slice(2);
if (!EMAIL || !PASSWORD) {
  console.error('Usage: node scripts/generate-extra-screenshots.cjs <email> <password>');
  process.exit(1);
}

const OUT_DIR = path.resolve(__dirname, '..', 'app-store');
fs.mkdirSync(OUT_DIR, { recursive: true });

const PRIVACY_CSS = `
  .license-plate, [data-license-plate], [class*="LicensePlate"] {
    filter: blur(8px) !important;
  }
  .ar-email { filter: blur(6px) !important; }
  [role="dialog"],
  [data-radix-dialog-overlay],
  [data-state="open"][role="dialog"],
  div[role="dialog"][data-state="open"],
  .fixed.inset-0[class*="bg-black"],
  .fixed.inset-0[class*="backdrop"] {
    display: none !important;
  }
`;

const blurEmailsInDom = () => {
  const EMAIL_RE = /([\w.+-]+@[\w-]+\.[\w.-]+)/g;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  const targets = [];
  let n;
  while ((n = walker.nextNode())) {
    if (EMAIL_RE.test(n.nodeValue)) targets.push(n);
    EMAIL_RE.lastIndex = 0;
  }
  for (const node of targets) {
    const frag = document.createDocumentFragment();
    const parts = node.nodeValue.split(EMAIL_RE);
    for (const part of parts) {
      if (EMAIL_RE.test(part)) {
        const span = document.createElement('span');
        span.className = 'ar-email';
        span.textContent = part;
        frag.appendChild(span);
      } else if (part) {
        frag.appendChild(document.createTextNode(part));
      }
      EMAIL_RE.lastIndex = 0;
    }
    node.parentNode.replaceChild(frag, node);
  }
};

const captureShot = async (page, name, waitForData = true) => {
  await page.addStyleTag({ content: PRIVACY_CSS });
  await page.evaluate(blurEmailsInDom);
  if (waitForData) {
    try {
      await page.waitForFunction(() => {
        // Spinner detector
        const spinners = document.querySelectorAll('.animate-spin, [class*="lucide-loader"]');
        for (const el of spinners) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return false;
        }
        // Skeleton detector — the app uses Tailwind animate-pulse on
        // shimmering placeholders (Notifications, Vehicles, etc.).
        // Wait until none are visible.
        const skeletons = document.querySelectorAll('.animate-pulse');
        for (const el of skeletons) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return false;
        }
        return true;
      }, { timeout: 15000, polling: 250 });
    } catch {
      console.warn(`     loader still visible on ${name} — capturing anyway`);
    }
  }
  await new Promise(r => setTimeout(r, 1800));
  await page.evaluate(blurEmailsInDom);
  const outPath = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: outPath, type: 'png' });
  const stat = fs.statSync(outPath);
  console.log(`     wrote ${outPath} (${(stat.size / 1024).toFixed(0)} KB)`);
};

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: {
      width: 430, height: 932, deviceScaleFactor: 3,
      isMobile: true, hasTouch: true,
    },
    args: ['--lang=he-IL'],
  });

  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'he-IL,he;q=0.9' });

  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions('http://localhost:5173', ['geolocation']);
  await page.setGeolocation({ latitude: 32.0853, longitude: 34.7818 });

  console.log('[1] navigating to root…');
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 30000 });

  console.log('[2] signing in…');
  const signInResult = await page.evaluate(async (email, pwd) => {
    const mod = await import('/src/lib/supabase.js');
    const { data, error } = await mod.supabase.auth.signInWithPassword({ email, password: pwd });
    return { ok: !!data?.user, error: error?.message || null };
  }, EMAIL, PASSWORD);
  console.log('  ->', signInResult);
  if (!signInResult.ok) {
    console.error('Sign-in failed. Aborting.');
    await browser.close();
    process.exit(1);
  }

  // Fetch the user's vehicle ids — but only from THEIR active account.
  // The user has historic orphan accounts from a previous bug; querying
  // vehicles directly returns rows the current account_members row no
  // longer maps to, and VehicleDetail rejects them with "no access".
  // So resolve the active account_id via account_members first.
  console.log('[3] fetching vehicle ids…');
  const ids = await page.evaluate(async () => {
    const mod = await import('/src/lib/supabase.js');
    const { data: { user } } = await mod.supabase.auth.getUser();
    const { data: members } = await mod.supabase
      .from('account_members')
      .select('account_id, role, status')
      .eq('user_id', user.id);
    const active = members?.find(m => m.status === 'פעיל') || members?.[0] || null;
    if (!active) return { carId: null, vesselId: null, total: 0 };
    const { data: rows } = await mod.supabase
      .from('vehicles')
      .select('id, vehicle_type, license_plate, manufacturer')
      .eq('account_id', active.account_id)
      .order('created_at', { ascending: false });
    const car = rows?.find(r => r.vehicle_type !== 'כלי שייט') || rows?.[0] || null;
    const vessel = rows?.find(r => r.vehicle_type === 'כלי שייט') || null;
    return {
      carId: car?.id || null,
      vesselId: vessel?.id || null,
      total: rows?.length || 0,
      accountId: active.account_id,
    };
  });
  console.log('  ->', ids);

  // Define the extra shots. Order matters — we save them as 08–14 to
  // sit right after the original 7 in the folder.
  const SHOTS = [];

  if (ids.carId) {
    SHOTS.push({
      name: '08-vehicle-detail',
      url: `/VehicleDetail?id=${ids.carId}`,
      waitForData: true,
    });
  }

  SHOTS.push({
    name: '09-vessels-list',
    url: '/Vehicles?category=vessel',
    waitForData: true,
  });

  if (ids.vesselId) {
    SHOTS.push({
      name: '10-vessel-detail',
      url: `/VehicleDetail?id=${ids.vesselId}`,
      waitForData: true,
    });
  }

  SHOTS.push({
    name: '11-notifications',
    url: '/Notifications',
    waitForData: true,
  });

  SHOTS.push({
    name: '12-add-vehicle',
    url: '/AddVehicle',
    waitForData: false, // form, no async data
  });

  SHOTS.push({
    name: '13-reminder-settings',
    url: '/ReminderSettings',
    waitForData: true,
  });

  if (ids.carId) {
    SHOTS.push({
      name: '14-checklist-hub',
      url: `/ChecklistHub?vehicleId=${ids.carId}`,
      waitForData: true,
    });
  }

  SHOTS.push({
    name: '15-accidents',
    url: '/Accidents',
    waitForData: true,
  });

  for (let i = 0; i < SHOTS.length; i++) {
    const s = SHOTS[i];
    console.log(`[${i + 4}] ${s.name} (${s.url})…`);
    await page.goto(`http://localhost:5173${s.url}`, { waitUntil: 'networkidle2', timeout: 30000 });
    await captureShot(page, s.name, s.waitForData);
  }

  // ───────── Guest-mode pass ─────────
  // Sign out and capture pages where demo data shows naturally — the
  // app seeds a demo car + vessel + documents for guests so we get
  // populated screenshots without exposing any real account.
  console.log('[guest] signing out + entering guest mode…');
  await page.evaluate(async () => {
    const mod = await import('/src/lib/supabase.js');
    await mod.supabase.auth.signOut();
    localStorage.removeItem('supabase.auth.token');
    // The app's guest gate (GuestContext) reads this flag — without
    // it any /Dashboard navigation redirects to /AuthPage.
    sessionStorage.setItem('guest_confirmed', '1');
  });
  // Reload so the auth state listener picks up the signed-out state
  // and the guest seeder runs (creates demo car + vessel + docs).
  await page.goto('http://localhost:5173/Dashboard', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 4000)); // let demo seeder finish

  const GUEST_SHOTS = [
    { name: '16-guest-dashboard',  url: '/Dashboard' },
    { name: '17-guest-vehicles',   url: '/Vehicles' },
    { name: '18-guest-documents',  url: '/Documents' },
    { name: '19-guest-community',  url: '/Community' },
  ];

  for (let i = 0; i < GUEST_SHOTS.length; i++) {
    const s = GUEST_SHOTS[i];
    console.log(`[guest ${i + 1}] ${s.name} (${s.url})…`);
    await page.goto(`http://localhost:5173${s.url}`, { waitUntil: 'networkidle2', timeout: 30000 });
    await captureShot(page, s.name, true);
  }

  await browser.close();
  console.log('Done. Files in:', OUT_DIR);
})().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
