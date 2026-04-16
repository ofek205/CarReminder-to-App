/**
 * Google Play Screenshots — Automated with Puppeteer
 * Takes PNG screenshots at all required sizes.
 *
 * Usage: node scripts/take-screenshots.cjs
 * Requires: npm install puppeteer (already installed as devDependency)
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://localhost:5173';
const OUTPUT_DIR = path.join(require('os').homedir(), 'Desktop', 'GooglePlay-Screenshots');

// Google Play size requirements (viewport × deviceScaleFactor = output resolution)
const SIZES = {
  phone:      { width: 412, height: 915, dpr: 2.625, dir: 'phone' },       // → ~1080x2403
  'tablet-7': { width: 600, height: 960, dpr: 2,     dir: 'tablet-7' },    // → 1200x1920
  'tablet-10':{ width: 800, height: 1280,dpr: 2,     dir: 'tablet-10' },   // → 1600x2560
  chromebook: { width: 1280,height: 800, dpr: 1,     dir: 'chromebook' },  // → 1280x800
};

const SCREENS = [
  { name: '01-login',          path: '/Auth' },
  { name: '02-dashboard',      path: '/Dashboard',     setup: 'guest' },
  { name: '03-vehicle-detail', path: '/VehicleDetail?id=demo_vehicle_001', setup: 'guest' },
  { name: '04-find-garage',    path: '/FindGarage',    setup: 'guest' },
  { name: '05-ai-assistant',   path: '/AiAssistant',   setup: 'guest' },
  { name: '06-community',      path: '/Community',     setup: 'guest' },
  { name: '07-add-vehicle',    path: '/AddVehicle',    setup: 'guest' },
  { name: '08-accidents',      path: '/Accidents',     setup: 'guest' },
];

async function enterGuestMode(page) {
  // Click "כניסה כאורח"
  await page.goto(`${BASE_URL}/Auth`, { waitUntil: 'networkidle2', timeout: 15000 });
  await page.waitForSelector('button', { timeout: 5000 });
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('כאורח'));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 2000));
  // Dismiss guest popup if present
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('להמשיך כאורח'));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 1500));
}

async function run() {
  console.log('🚀 Starting Google Play screenshot capture...\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  for (const [sizeName, sizeConfig] of Object.entries(SIZES)) {
    const dir = path.join(OUTPUT_DIR, sizeConfig.dir);
    fs.mkdirSync(dir, { recursive: true });

    console.log(`📱 ${sizeName} (${sizeConfig.width}x${sizeConfig.height} @ ${sizeConfig.dpr}x)`);

    const page = await browser.newPage();
    await page.setViewport({
      width: sizeConfig.width,
      height: sizeConfig.height,
      deviceScaleFactor: sizeConfig.dpr,
    });

    let guestEntered = false;

    for (const screen of SCREENS) {
      // Enter guest mode once per size
      if (screen.setup === 'guest' && !guestEntered) {
        await enterGuestMode(page);
        guestEntered = true;
      }

      const url = `${BASE_URL}${screen.path}`;
      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
      } catch {
        await page.goto(url, { waitUntil: 'load', timeout: 10000 });
      }
      // Wait for render
      await new Promise(r => setTimeout(r, 3000));

      const filePath = path.join(dir, `${screen.name}.png`);
      await page.screenshot({ path: filePath, type: 'png', fullPage: false });

      const stats = fs.statSync(filePath);
      const sizeKB = Math.round(stats.size / 1024);
      console.log(`  ✅ ${screen.name}.png (${sizeKB}KB)`);
    }

    await page.close();
  }

  await browser.close();

  console.log(`\n✨ Done! Screenshots saved to:`);
  console.log(`   ${OUTPUT_DIR}`);
  console.log(`\n📊 Total: ${Object.keys(SIZES).length} sizes × ${SCREENS.length} screens = ${Object.keys(SIZES).length * SCREENS.length} images`);
}

run().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
