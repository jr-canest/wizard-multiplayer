// Headless phone-size screenshots of the dev app for design options.
//   node shot.mjs <room> <outdir> <label=query> ...
import puppeteer from 'puppeteer-core';
import path from 'node:path';
const [room, outdir, ...specs] = process.argv.slice(2);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
const page = await browser.newPage();
await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto('http://localhost:5181/?test', { waitUntil: 'networkidle2' });
await page.waitForSelector('input[placeholder="Jorge"]', { timeout: 30000 });
await page.type('input[placeholder="Jorge"]', 'netA');
await page.type('input[placeholder="• • • •"]', '4242');
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Continue').click());
await page.waitForFunction(() => !document.querySelector('input[placeholder="Jorge"]'), { timeout: 30000 });
for (const spec of specs) {
  const [label, query] = spec.split('=');
  await page.goto(`http://localhost:5181/room/${room}?${query ?? ''}`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.__wizardRoom && window.__wizardRoom.status !== 'lobby', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, Number(process.env.SHOT_WAIT_MS ?? 2500)));
  const file = path.join(outdir, `${label}.png`);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 375, height: 640 } });
  console.log('wrote', file);
}
await browser.close();
