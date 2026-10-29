// Records the game-over moment: a 1-round game vs 3 computers on the dev
// server, netA's phone from the last card to a few seconds into the final
// screen. Pass `desktop` for a 1440x900 window instead of a phone.
//   node scripts/netlab/gameover-clip.mjs <outdir> [desktop]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const [OUT, SIZE] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-first-run'] });
const page = await browser.newPage();
const desktop = SIZE === 'desktop';
await page.setViewport(desktop ? { width: 1440, height: 900 } : { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
async function waitFor(fn, ms = 60000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(120); } throw new Error('timeout'); }
async function clickText(re) { await waitFor(() => page.evaluate((src) => { const b = [...document.querySelectorAll('button')].find((x) => new RegExp(src).test(x.textContent.trim()) && !x.disabled); if (b) { b.click(); return true; } return false; }, re.source)); }
const st = () => page.evaluate(() => { const r = window.__wizardRoom; return r && { status: r.status, turn: r.playerOrder[r.currentPlayerIndex] }; });
await page.goto('http://localhost:5181/?test', { waitUntil: 'networkidle2' });
await page.waitForSelector('input[placeholder="Jorge"]');
await page.type('input[placeholder="Jorge"]', 'netA');
await page.type('input[placeholder="• • • •"]', '4242');
await clickText(/^Continue$/);
await waitFor(() => page.evaluate(() => !document.querySelector('input[placeholder="Jorge"]')));
await clickText(/^Create room$/);
await page.waitForSelector('#rounds');
await page.evaluate(() => { const sel = document.querySelector('#rounds'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(sel, '1'); sel.dispatchEvent(new Event('change', { bubbles: true })); });
await sleep(400);
await clickText(/^Start game$/);
let recorder = null;
await waitFor(async () => {
  const r = await st();
  if (r?.status === 'finished') return true;
  if (r?.status === 'bidding' && r.turn === 'netA') await page.evaluate(() => { const b = [...document.querySelectorAll('button.chip')].filter((x) => !x.disabled && /^\d+$/.test(x.textContent.trim())).sort((a, b) => +a.textContent - +b.textContent)[0]; b && b.click(); });
  if (r?.status === 'playing' && r.turn === 'netA') {
    const el = await page.$('.animate-legal-glow');
    if (el) { if (!recorder) recorder = await page.screencast({ path: path.join(OUT, desktop ? 'gameover-desktop.webm' : 'gameover.webm') }); const bb = await el.boundingBox(); if (bb) await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(500); }
  }
  return false;
}, 90000);
if (!recorder) recorder = await page.screencast({ path: path.join(OUT, desktop ? 'gameover-desktop.webm' : 'gameover.webm') });
await sleep(4200);
await page.screenshot({ path: path.join(OUT, desktop ? 'gameover-desktop-rest.png' : 'gameover-rest.png') });
// Scroll to the standings like a player would: they count up once seen.
await page.evaluate(() => document.querySelector('ul.space-y-1\\.5')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
await sleep(2600);
await page.screenshot({ path: path.join(OUT, desktop ? 'gameover-desktop-standings.png' : 'gameover-standings.png') });
await recorder.stop();
await browser.close();
