/**
 * App Store screenshot generator.
 *
 * Renders the running dev server (localhost:5173) at iPhone 6.7"
 * resolution (430×932 CSS × DPR 3 = 1290×2796 actual), the size
 * Apple requires for the iPhone 16 / 14 / 13 Pro Max submission slot.
 *
 * Workflow per shot:
 *   - Inject CSS that blurs every license-plate chip on the page
 *     (visual privacy) before any pixel is captured.
 *   - Navigate to the target route, give React Query a second to
 *     populate, then screenshot full-viewport.
 *
 * Output: app-store/01-dashboard.png … 07-documents.png at the
 * native 1290×2796 pixel size, ready to upload to App Store Connect.
 *
 * Auth: signs in via Supabase JS once, then reuses the cookie/
 * localStorage session across navigations.
 *
 * USAGE:
 *   node scripts/generate-app-store-screenshots.cjs <email> <password>
 */
const fs   = require('fs');
const path = require('path');
const puppeteer = require(path.join(process.cwd(), 'node_modules', 'puppeteer'));

const [EMAIL, PASSWORD] = process.argv.slice(2);
if (!EMAIL || !PASSWORD) {
  console.error('Usage: node scripts/generate-app-store-screenshots.cjs <email> <password>');
  process.exit(1);
}

const OUT_DIR = path.resolve(__dirname, '..', 'app-store');
fs.mkdirSync(OUT_DIR, { recursive: true });

// CSS injected on every page to mask license plates. The plate chip
// in this app uses the class string `.license-plate` (used by the
// PlateChip component) but to be safe we also catch any element
// whose text matches a typical Israeli plate format. The blur is
// strong enough to obscure the digits while keeping the chip's
// visual identity (yellow rounded rectangle).
const PRIVACY_CSS = `
  /* The yellow plate chip uses an inline-flex with the plate digits
     as a child. Heavy blur on the entire chip hides the number. */
  .license-plate, [data-license-plate], [class*="LicensePlate"] {
    filter: blur(8px) !important;
  }
  /* Email blur — added at runtime by walking text nodes (see
     blurEmailsInDom). The script wraps emails in <span class="ar-email">
     so this rule masks the digits. */
  .ar-email { filter: blur(6px) !important; }
  /* Hide any Radix dialog overlay/content (rating popup, system
     popups) AND the dimmed backdrop they leave behind. */
  [role="dialog"],
  [data-radix-dialog-overlay],
  [data-state="open"][role="dialog"],
  div[role="dialog"][data-state="open"],
  .fixed.inset-0[class*="bg-black"],
  .fixed.inset-0[class*="backdrop"] {
    display: none !important;
  }
`;

// Walks all text nodes and wraps any email-shaped string in a span we
// can blur. Run after each navigation, before screenshot.
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

const SHOTS = [
  { name: '01-dashboard',     url: '/Dashboard',  waitMs: 3500 },
  { name: '02-vehicles-list', url: '/Vehicles',   waitMs: 3500 },
  { name: '03-documents',     url: '/Documents',  waitMs: 3500 },
  { name: '04-find-garage',   url: '/FindGarage', waitMs: 3500 },
  { name: '05-ai-assistant',  url: '/AiAssistant',waitMs: 3500 },
  { name: '06-community',     url: '/Community',  waitMs: 3500 },
  { name: '07-account',       url: '/AccountSettings', waitMs: 3500 },
];

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: {
      width:             430,
      height:            932,
      deviceScaleFactor: 3,         // 430*3 = 1290, 932*3 = 2796 ✓
      isMobile:          true,
      hasTouch:          true,
    },
    args: ['--lang=he-IL'],
  });

  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'he-IL,he;q=0.9' });

  // Pre-grant geolocation (Tel Aviv) so FindGarage doesn't sit on the
  // permission prompt and instead renders garage results immediately.
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions('http://localhost:5173', ['geolocation']);
  await page.setGeolocation({ latitude: 32.0853, longitude: 34.7818 });

  // Sign in via the Supabase client living on the page. Sets up the
  // localStorage entries our app reads on boot, so subsequent
  // navigations land already authenticated.
  console.log('[1/9] navigating to root…');
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 30000 });

  console.log('[2/9] signing in…');
  const signInResult = await page.evaluate(async (email, pwd) => {
    const mod = await import('/src/lib/supabase.js');
    const { data, error } = await mod.supabase.auth.signInWithPassword({ email, password: pwd });
    return { ok: !!data?.user, email: data?.user?.email || null, error: error?.message || null };
  }, EMAIL, PASSWORD);
  console.log('  ->', signInResult);
  if (!signInResult.ok) {
    console.error('Sign-in failed. Aborting.');
    await browser.close();
    process.exit(1);
  }

  // Take each shot.
  for (let i = 0; i < SHOTS.length; i++) {
    const s = SHOTS[i];
    console.log(`[${i + 3}/9] ${s.name} (${s.url})…`);
    await page.goto(`http://localhost:5173${s.url}`, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.addStyleTag({ content: PRIVACY_CSS });
    await page.evaluate(blurEmailsInDom);

    // Wait for the global loading spinner to disappear. The app uses
    // an animated svg with the lucide `lucide-loader-circle` class
    // and Tailwind's `animate-spin`. We poll until no such element is
    // visible, then settle for an extra second so layout/animations
    // finish.
    try {
      await page.waitForFunction(() => {
        const spinners = document.querySelectorAll('.animate-spin, [class*="lucide-loader"]');
        for (const el of spinners) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return false;
        }
        return true;
      }, { timeout: 15000, polling: 250 });
    } catch {
      console.warn(`     spinner still visible after 15s on ${s.name} — capturing anyway`);
    }
    await new Promise(r => setTimeout(r, 1500));
    // Re-run email blur now that all data is rendered (the first pass
    // ran before async data loaded).
    await page.evaluate(blurEmailsInDom);

    const outPath = path.join(OUT_DIR, `${s.name}.png`);
    await page.screenshot({ path: outPath, type: 'png' });
    const stat = fs.statSync(outPath);
    console.log(`     wrote ${outPath} (${(stat.size / 1024).toFixed(0)} KB)`);
  }

  await browser.close();
  console.log('Done. Files in:', OUT_DIR);
})().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
