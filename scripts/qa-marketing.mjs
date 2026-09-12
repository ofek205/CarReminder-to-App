import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { marketingRoutes } from '../src/lib/marketingContent.js';

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:4173';
const routes = process.env.QA_ROUTE ? [process.env.QA_ROUTE] : marketingRoutes;
const ignoreServiceWorkerMime = process.env.QA_IGNORE_SW_MIME === '1';
const viewports = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844, isMobile: true },
];

const browser = await puppeteer.launch({
  headless: true,
  timeout: 60_000,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
});
const failures = [];

try {
  for (const viewport of viewports) {
    for (const route of routes) {
      const page = await browser.newPage();
      const previewRoute = route.endsWith('/') ? route : `${route}/`;
      const consoleErrors = [];
      const runtimeErrors = [];
      page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('pageerror', error => runtimeErrors.push(error.message));
      await page.setViewport(viewport);

      try {
        const response = await page.goto(baseUrl + previewRoute, {
          waitUntil: 'domcontentloaded',
          timeout: 20_000,
        });
        await page.waitForSelector('h1', { timeout: 8_000 });
        await new Promise(resolve => setTimeout(resolve, 150));
        assert.ok([200, 304].includes(response?.status()), `HTTP status must be 200 or 304, got ${response?.status()}`);

        const result = await page.evaluate(() => ({
          h1Count: document.querySelectorAll('h1').length,
          title: document.title,
          brokenImages: [...document.images]
            .filter(image => image.complete && image.naturalWidth === 0)
            .map(image => image.currentSrc || image.src),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          hasMain: Boolean(document.querySelector('main')),
          direction: getComputedStyle(document.documentElement).direction,
          missingAlt: [...document.images].filter(image => !image.hasAttribute('alt')).length,
          unlabeledInputs: [...document.querySelectorAll('input, textarea, select')]
            .filter(input => getComputedStyle(input).display !== 'none' && getComputedStyle(input).visibility !== 'hidden')
            .filter(input => !input.labels?.length && !input.getAttribute('aria-label') && !input.getAttribute('aria-labelledby'))
            .map(input => `${input.tagName.toLowerCase()}#${input.id || '(no-id)'}[type=${input.getAttribute('type') || 'default'}]`),
          unnamedButtons: [...document.querySelectorAll('button')]
            .filter(button => !button.innerText.trim() && !button.getAttribute('aria-label') && !button.getAttribute('aria-labelledby'))
            .length,
          duplicateIds: [...document.querySelectorAll('[id]')]
            .map(element => element.id)
            .filter((id, index, ids) => ids.indexOf(id) !== index),
        }));

        assert.equal(result.h1Count, 1, 'exactly one h1 is required');
        assert.ok(result.title.includes('Car Reminder'), 'title must include the brand');
        assert.equal(result.brokenImages.length, 0, `broken images: ${result.brokenImages.join(', ')}`);
        assert.ok(result.overflow <= 1, `horizontal overflow: ${result.overflow}px`);
        assert.ok(result.hasMain, 'main landmark is required');
        assert.equal(result.direction, 'rtl', 'document must render RTL');
        assert.equal(result.missingAlt, 0, 'all images require an alt attribute');
        assert.equal(result.unlabeledInputs.length, 0, `all form controls require a label: ${result.unlabeledInputs.join(', ')}`);
        assert.equal(result.unnamedButtons, 0, 'all buttons require an accessible name');
        assert.equal(result.duplicateIds.length, 0, `duplicate ids: ${result.duplicateIds.join(', ')}`);
        assert.equal(runtimeErrors.length, 0, `runtime errors: ${runtimeErrors.join(' | ')}`);
        const actionableConsoleErrors = consoleErrors.filter(message =>
          !(ignoreServiceWorkerMime && message.includes("unsupported MIME type ('text/html')"))
        );
        assert.equal(actionableConsoleErrors.length, 0, `console errors: ${actionableConsoleErrors.join(' | ')}`);
      } catch (error) {
        failures.push(`${viewport.name} ${route}: ${error.message}`);
      } finally {
        await page.close();
      }
    }
  }

  const page = await browser.newPage();
  await page.setViewport(viewports[1]);
  await page.goto(baseUrl + '/website/', { waitUntil: 'domcontentloaded' });
  await page.locator('.cm-menu-toggle').click();
  assert.ok(await page.$('#cm-navigation.is-open'), 'mobile menu must open');
  await page.locator('.cm-menu-toggle').click();
  await page.locator('#cm-plate').fill('');
  await page.locator('.cm-check-form button[type="submit"]').click();
  await page.waitForFunction(() => Boolean(document.querySelector('#cm-plate-error[role="alert"]')));
  await page.close();
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`Marketing browser QA failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Marketing browser QA passed: ${routes.length} pages × ${viewports.length} viewports, images, layout, RTL, console and interactions.`);
}
