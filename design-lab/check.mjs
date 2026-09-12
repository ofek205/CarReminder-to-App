import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';

const browser = await puppeteer.launch({ headless: true });
const errors = [];
const external = [];
try {
  for (const width of [320, 390, 768, 1365]) {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => {if (!r.url().startsWith('http://127.0.0.1:5173') && !r.url().startsWith('data:')) external.push(r.url());});
    await page.setViewport({ width, height: width > 800 ? 1100 : 844, deviceScaleFactor: 1 });
    await page.goto('http://127.0.0.1:5173/design-lab/', { waitUntil: 'networkidle0' });
    const result = await page.evaluate(() => ({
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      appOverflow: document.querySelector('.app-scroll').scrollWidth > document.querySelector('.app-scroll').clientWidth,
      imagesLoaded: [...document.images].every(i => i.complete && i.naturalWidth > 0),
      font: getComputedStyle(document.querySelector('.greeting h2')).fontFamily,
    }));
    assert.equal(result.horizontalOverflow, false);
    assert.equal(result.appOverflow, false);
    assert.equal(result.imagesLoaded, true);
    await page.screenshot({ path: `design-lab/home-${width}.png` });
    console.log(width, result);
    if (width === 390) {
      await page.click('.notification-button');
      await page.waitForSelector('dialog[open]');
      assert.equal(await page.$$eval('.notification-item.unread', es => es.length), 2);
      await page.click('.notification-summary button');
      assert.equal(await page.$('.notification-count'), null);
      await page.keyboard.press('Escape');
      await page.click('.hamburger-button');
      await page.waitForSelector('dialog.menu-drawer[open]');
      await page.$eval('dialog', async e => { await Promise.all(e.getAnimations({subtree:true}).map(a => a.finished)); });
      assert.equal(await page.$$eval('.drawer-group .drawer-item', es => es.length), 14);
      await page.screenshot({path:'design-lab/home-menu.png'});
      await page.click('dialog .bottom-nav button:nth-child(2)');
      await page.waitForFunction(() => document.querySelector('#sheet-title').textContent === 'המסמכים שלך');
      await page.keyboard.press('Escape');
      await page.click('.account-switch');
      await page.waitForSelector('dialog[open]');
      assert.ok((await page.$eval('dialog', e => e.textContent)).includes('החשבון האישי שלי'));
      await page.keyboard.press('Escape');
      console.log('PASS: notifications and read state, full side menu, workspace chooser');
      await page.click('.check-button');
      assert.ok(await page.$('[role="alert"]'));
      await page.type('input[aria-label="מספר רישוי לבדיקה"]', '1234567');
      await page.click('.check-button');
      await page.waitForSelector('dialog[open]');
      assert.ok((await page.$eval('dialog', e => e.textContent)).includes('נתונים קבועים'));
      await page.click('dialog button[aria-label="סגירה"]');
      await page.type('input[aria-label="חיפוש בכלי התחבורה"]', 'KTM');
      assert.equal(await page.$$eval('.vehicle', es => es.length), 1);
      await page.click('button[aria-label="נקה חיפוש"]');
      await page.click('button[aria-label="עדכון מונה עבור הקורולה שלי"]');
      await page.$eval('input[name="meter"]', e => e.value = '');
      await page.type('input[name="meter"]', '148350');
      await page.click('dialog .primary-button');
      await page.waitForFunction(() => document.querySelector('.car .meter-button').textContent.includes('148,350'));
      await page.click('button[aria-label="פתיחת תיק הקורולה שלי"]');
      await page.waitForSelector('dialog[open]');
      await page.$eval('dialog',async e=>{await Promise.all(e.getAnimations({subtree:true}).map(a=>a.finished));});
      assert.ok(await page.$eval('dialog', e => Math.abs(e.getBoundingClientRect().bottom - innerHeight) < 2));
      await page.screenshot({ path: 'design-lab/home-detail.png' });
      await page.keyboard.press('Escape');
      await page.evaluate(() => document.querySelector('.app-scroll').scrollTo(0, 2000));
      await page.screenshot({ path: 'design-lab/home-lower.png' });
      await page.click('.add-vehicle');
      await page.type('input[name="name"]', 'רכב משפחתי');
      await page.type('input[name="plate"]', '12345678');
      await page.click('dialog .primary-button');
      await page.waitForFunction(() => document.querySelectorAll('.vehicle').length === 4);
      for (const label of ['מסמכים', 'מצא מוסך', 'תאונות', 'מומחה AI']) {
        await page.evaluate(text => [...document.querySelectorAll('.bottom-nav button')].find(b => b.textContent === text).click(), label);
        await page.waitForSelector('dialog[open]');
        await page.keyboard.press('Escape');
      }
      console.log('PASS: plate validation, sample result, search, meter update, details, add vehicle, navigation, Escape');
      // Reset scroll before checking density and all presentation states.
      await page.select('.scenario-picker','populated');
      await page.evaluate(()=>document.querySelector('.app-scroll').scrollTo(0,0));
      assert.ok(await page.$eval('.vehicle',e=>e.getBoundingClientRect().top < 535));
      assert.ok(await page.$eval('.car .expiry-list',e=>e.textContent.includes('טסט') && e.textContent.includes('ביטוח')));
      for(const scenario of ['single','empty','missing','expired','loading','offline','error','long']) {
        await page.select('.scenario-picker',scenario);
        await page.waitForFunction(value=>document.querySelector('.scenario-picker').value===value,{},scenario);
        assert.equal(await page.$eval('.app-scroll',e=>e.scrollWidth>e.clientWidth),false);
        if(scenario==='single') assert.equal(await page.$$eval('.vehicle',es=>es.length),1);
        if(scenario==='empty') {assert.ok(await page.$('.add-vehicle'));await page.click('.notification-button');assert.ok((await page.$eval('dialog',e=>e.textContent)).includes('אין התראות'));await page.keyboard.press('Escape');}
        if(scenario==='missing') assert.ok((await page.$eval('.car .expiry-list',e=>e.textContent)).includes('לא הוזן'));
        if(scenario==='expired') assert.ok(await page.$('.expired-alert'));
        if(scenario==='loading') assert.equal(await page.$$eval('.vehicle-skeleton',es=>es.length),2);
        if(scenario==='offline') assert.ok(await page.$('.offline-state'));
        if(scenario==='error') {await page.click('.empty-state .primary-button');await page.waitForSelector('.vehicle');}
        await page.screenshot({path:`design-lab/state-${scenario}.png`});
      }
      console.log('PASS: bottom navigation works with drawer open; mobile sheets; nine sample states');
    }
    if (width === 1365) {
      await page.click('[aria-label="תצוגה רחבה"]');
      await page.screenshot({ path: 'design-lab/home-wide.png' });
      assert.equal(await page.$eval('.app-scroll', e => e.scrollWidth > e.clientWidth), false);
      await page.evaluate(() => [...document.querySelectorAll('.lab-switch button')].find(b => b.textContent === 'לפני הליטוש').click());
      await page.waitForSelector('.before-frame img');
      assert.ok(await page.$eval('.before-frame img', e => e.complete && e.naturalWidth > 0));
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log('PASS: no page errors, no external requests, all responsive viewports');
} finally {
  await browser.close();
}
