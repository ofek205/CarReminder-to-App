import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';

const browser = await puppeteer.launch({ headless: true });
try {
  for (const width of [320, 390]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 844 });
    await page.goto('http://127.0.0.1:5173/design-lab/', { waitUntil: 'networkidle0' });
    await page.type('.plate-field input', '12345678');
    const metrics = await page.evaluate(() => {
      const input = document.querySelector('.plate-field input');
      const style = getComputedStyle(input);
      const context = document.createElement('canvas').getContext('2d');
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const textWidth = context.measureText(input.value).width + (parseFloat(style.letterSpacing) || 0) * input.value.length;
      const available = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const second = document.querySelectorAll('.vehicle-main')[1].getBoundingClientRect();
      const viewport = document.querySelector('.app-scroll').getBoundingClientRect();
      return { value: input.value, textWidth, available, firstTop: document.querySelector('.vehicle').getBoundingClientRect().top,
        secondIdentityVisible: second.bottom <= viewport.bottom,
        lookupHeight: document.querySelector('.quick-check').getBoundingClientRect().height,
        scanHeight: document.querySelector('.scan-button').getBoundingClientRect().height };
    });
    assert.equal(metrics.value.replace(/\D/g, ''), '12345678');
    assert.ok(metrics.textWidth <= metrics.available, 'Eight-digit plate must fit without horizontal text scrolling');
    assert.ok(metrics.secondIdentityVisible, 'Second vehicle photo, name and plate should be visible at entry');
    assert.ok(metrics.scanHeight >= 44);
    await page.screenshot({ path: `design-lab/compact-plate-${width}.png` });
    await page.click('.scan-button');
    await page.waitForSelector('dialog[open] .scan-example');
    await page.click('dialog .primary-button');
    assert.equal(await page.$eval('.plate-field input', input => input.value), '12-345-67');
    await page.click('.check-button');
    await page.waitForSelector('dialog[open] .sample-notice');
    console.log(width, metrics, 'PASS: eight-digit plate fits; scan and check work');
    await page.close();
  }
} finally { await browser.close(); }
