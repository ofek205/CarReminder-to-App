/**
 * Extra Google Play Screenshots — Feature-focused
 * Takes additional phone screenshots showing key features.
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://localhost:5173';
const OUTPUT_DIR = path.join(require('os').homedir(), 'OneDrive - Wittix', 'Desktop', 'GooglePlay-Screenshots', 'phone');

const PHONE = { width: 412, height: 915, dpr: 2.625 };

async function enterGuestMode(page) {
  await page.goto(`${BASE_URL}/Auth`, { waitUntil: 'networkidle2', timeout: 15000 });
  await page.waitForSelector('button', { timeout: 5000 });
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('כאורח'));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 2000));
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('להמשיך כאורח'));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 1500));
}

async function run() {
  console.log('🚀 Taking extra feature screenshots...\n');

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: PHONE.width, height: PHONE.height, deviceScaleFactor: PHONE.dpr });

  // Enter guest mode
  await enterGuestMode(page);

  // 1. AI Chat with conversation — type a question and show Yossi thinking
  console.log('  📸 AI chat with question...');
  await page.goto(`${BASE_URL}/AiAssistant`, { waitUntil: 'networkidle2', timeout: 15000 });
  await new Promise(r => setTimeout(r, 2000));
  // Type a question in the input
  const inputSelector = 'input[placeholder*="יוסי"], input[placeholder*="שאל"]';
  try {
    await page.waitForSelector(inputSelector, { timeout: 5000 });
    await page.type(inputSelector, 'יש לי רעש מהבלמים מה לעשות?');
    await new Promise(r => setTimeout(r, 500));
  } catch {
    // Try textarea or other input
    await page.evaluate(() => {
      const inp = document.querySelector('input[type="text"], textarea');
      if (inp) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
          || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(inp, 'יש לי רעש מהבלמים מה לעשות?');
          inp.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    });
  }
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: path.join(OUTPUT_DIR, '09-ai-chat-question.png'), type: 'png' });
  console.log('  ✅ 09-ai-chat-question.png');

  // 2. Community with posts and interaction
  console.log('  📸 Community forum...');
  await page.goto(`${BASE_URL}/Community`, { waitUntil: 'networkidle2', timeout: 15000 });
  await new Promise(r => setTimeout(r, 3000));
  // Scroll down a bit to show posts
  await page.evaluate(() => window.scrollTo(0, 200));
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: path.join(OUTPUT_DIR, '10-community-posts.png'), type: 'png' });
  console.log('  ✅ 10-community-posts.png');

  // 3. Vessel detail (demo vessel)
  console.log('  📸 Vessel detail...');
  await page.goto(`${BASE_URL}/VehicleDetail?id=demo_vessel_001`, { waitUntil: 'networkidle2', timeout: 15000 });
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: path.join(OUTPUT_DIR, '11-vessel-detail.png'), type: 'png' });
  console.log('  ✅ 11-vessel-detail.png');

  // 4. Vessel detail scrolled — safety equipment
  await page.evaluate(() => window.scrollTo(0, 600));
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: path.join(OUTPUT_DIR, '12-vessel-safety.png'), type: 'png' });
  console.log('  ✅ 12-vessel-safety.png');

  // 5. Add Vehicle — plate lookup (select car category + plate method)
  console.log('  📸 Add vehicle plate lookup...');
  await page.goto(`${BASE_URL}/AddVehicle`, { waitUntil: 'networkidle2', timeout: 15000 });
  await new Promise(r => setTimeout(r, 2000));
  // Click "פרטיים ומסחריים" category
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[class*="rounded"]')];
    const cat = cards.find(c => c.textContent?.includes('פרטיים ומסחריים'));
    if (cat) cat.click();
  });
  await new Promise(r => setTimeout(r, 1000));
  // Click plate lookup method
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[class*="rounded"]')];
    const plate = cards.find(c => c.textContent?.includes('חיפוש לפי מספר'));
    if (plate) plate.click();
  });
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: path.join(OUTPUT_DIR, '13-plate-lookup.png'), type: 'png' });
  console.log('  ✅ 13-plate-lookup.png');

  // 6. Add Vehicle — vessel category selected
  console.log('  📸 Add vessel...');
  await page.goto(`${BASE_URL}/AddVehicle`, { waitUntil: 'networkidle2', timeout: 15000 });
  await new Promise(r => setTimeout(r, 2000));
  // Click "כלי שייט" category
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[class*="rounded"]')];
    const cat = cards.find(c => c.textContent?.includes('כלי שייט'));
    if (cat) cat.click();
  });
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: path.join(OUTPUT_DIR, '14-add-vessel.png'), type: 'png' });
  console.log('  ✅ 14-add-vessel.png');

  // 7. Dashboard scrolled to reminders
  console.log('  📸 Dashboard reminders...');
  await page.goto(`${BASE_URL}/Dashboard`, { waitUntil: 'networkidle2', timeout: 15000 });
  await new Promise(r => setTimeout(r, 3000));
  await page.evaluate(() => window.scrollTo(0, 900));
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: path.join(OUTPUT_DIR, '15-reminders.png'), type: 'png' });
  console.log('  ✅ 15-reminders.png');

  await browser.close();

  console.log(`\n✨ Done! 7 extra screenshots saved to ${OUTPUT_DIR}`);
}

run().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
