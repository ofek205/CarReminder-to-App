import puppeteer from 'puppeteer';
import { writeFile } from 'node:fs/promises';

const browser = await puppeteer.launch({headless:true});
const report = [];
try {
  for (const width of [320,390]) {
    const page = await browser.newPage();
    await page.setViewport({width,height:844});
    await page.goto('http://127.0.0.1:5173/design-lab/', {waitUntil:'networkidle0'});
    const metrics = await page.evaluate(() => {
      const selectors = ['.greeting','.quick-check','.garage-heading','.attention-row','.list-controls','.vehicle','.bottom-nav','.meter-button','.garage-heading .text-button','.scan-button','.vehicle-description p','.vehicle-details span','.bottom-nav button:nth-child(2)>span:last-child','.bottom-nav .ai-tab>span:last-child'];
      const rgb = c => (c.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
      const luminance = color => rgb(color).map(c => c/255).map(c => c <= .04045 ? c/12.92 : ((c+.055)/1.055)**2.4).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
      const rows = selectors.map(selector => {
        const e = document.querySelector(selector), c = getComputedStyle(e), r = e.getBoundingClientRect();
        let p=e, bg='rgb(255, 255, 255)';
        while(p){const v=getComputedStyle(p).backgroundColor;if(v!=='rgba(0, 0, 0, 0)'&&v!=='transparent'){bg=v;break;}p=p.parentElement;}
        const a=luminance(c.color),b=luminance(bg);
        return {selector,text:e.textContent.slice(0,70),x:r.x,y:r.y,width:r.width,height:r.height,font:c.fontSize,color:c.color,background:bg,contrast:Number(((Math.max(a,b)+.05)/(Math.min(a,b)+.05)).toFixed(2))};
      });
      const viewport=document.querySelector('.app-scroll').getBoundingClientRect();
      return {rows,visibleVehicles:[...document.querySelectorAll('.vehicle')].map(e=>{const r=e.getBoundingClientRect();return {text:e.querySelector('h3').textContent,visibleHeight:Math.max(0,Math.min(viewport.bottom,r.bottom)-Math.max(viewport.top,r.top)),height:r.height};})};
    });
    await page.click('.notification-button');
    await page.keyboard.press('Escape');
    const focusReturned=await page.$eval('.notification-button',e=>document.activeElement===e);
    await page.click('.hamburger-button');
    await page.$eval('dialog',async e=>{await Promise.all(e.getAnimations({subtree:true}).map(a=>a.finished));});
    const navBlockedByDrawer=await page.evaluate(()=>{const button=document.querySelector('dialog .bottom-nav button');if(!button)return true;const r=button.getBoundingClientRect();return !button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});
    await page.keyboard.press('Escape');
    report.push({width,...metrics,focusReturned,navBlockedByDrawer});
    await page.close();
  }
  await writeFile('design-lab/audit-measurements.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {await browser.close();}
