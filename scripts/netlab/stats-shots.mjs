// All-time stats lists of BOTH Wizard apps, live, at phone and desktop
// size (read-only): multiplayer /history and the scorekeeper's History.
//   node scripts/netlab/stats-shots.mjs <outdir>
import puppeteer from 'puppeteer-core';
import path from 'node:path';
const OUT = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const SIZES = [['phone', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }], ['desktop', { width: 1440, height: 900 }]];
for (const [label, vp] of SIZES) {
  const p = await browser.newPage();
  await p.setViewport(vp);
  await p.goto('https://wizard-multiplayer.web.app/history', { waitUntil: 'networkidle2' });
  await sleep(2500);
  await p.screenshot({ path: path.join(OUT, `mp-${label}.png`), fullPage: label === 'phone' });
  await p.goto('https://wizard-scorekeeper.web.app/', { waitUntil: 'networkidle2' });
  await sleep(800);
  await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /history/i.test(x.textContent)); b && b.click(); });
  await sleep(2500);
  await p.screenshot({ path: path.join(OUT, `sk-${label}.png`), fullPage: label === 'phone' });
  await p.close();
}
await browser.close();
