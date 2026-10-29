// Records netA's phone from the last card of round 1, through the round
// results, to round 2's table, while netB sends a chat line on the results
// screen right before the deal. Checks the line shows on netA's felt.
//   node scripts/netlab/roundend-clip.mjs <outdir>
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:5181';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-first-run'] });
async function waitFor(fn, ms = 60000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(120); } throw new Error('timeout'); }
async function clickText(page, re) { await waitFor(() => page.evaluate((src) => { const b = [...document.querySelectorAll('button')].find((x) => new RegExp(src).test(x.textContent.trim()) && !x.disabled); if (b) { b.click(); return true; } return false; }, re.source)); }
async function phone(name) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(`${BASE}/?test`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[placeholder="Jorge"]');
  await page.type('input[placeholder="Jorge"]', name);
  await page.type('input[placeholder="• • • •"]', '4242');
  await clickText(page, /^Continue$/);
  await waitFor(() => page.evaluate(() => !document.querySelector('input[placeholder="Jorge"]')));
  return page;
}
const st = (p) => p.evaluate(() => { const r = window.__wizardRoom; return r && { status: r.status, turn: r.playerOrder[r.currentPlayerIndex], round: r.currentRound }; });
const A = await phone('netA');
await clickText(A, /^Create room$/);
await A.waitForSelector('#rounds');
const code = await A.evaluate(() => location.pathname.split('/').pop());
const B = await phone('netB');
await B.goto(`${BASE}/room/${code}`, { waitUntil: 'networkidle2' });
await waitFor(() => A.evaluate(() => window.__wizardRoom?.playerOrder.includes('netB')));
await A.evaluate(() => { const sel = document.querySelector('#rounds'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(sel, '3'); sel.dispatchEvent(new Event('change', { bubbles: true })); });
await sleep(500);
await clickText(A, /^Start game$/);

const recorder = await A.screencast({ path: path.join(OUT, 'roundend.webm') });
// Round 1: both humans bid low and play their one card.
await waitFor(async () => {
  const r = await st(A);
  if (r.status === 'scoring') return true;
  for (const [p, n] of [[A, 'netA'], [B, 'netB']]) {
    if (r.status === 'bidding' && r.turn === n) await p.evaluate(() => { const b = [...document.querySelectorAll('button.chip')].filter((x) => !x.disabled && /^\d+$/.test(x.textContent.trim())).sort((a, b) => +a.textContent - +b.textContent)[0]; b && b.click(); });
    if (r.status === 'playing' && r.turn === n) { const el = await p.$('.animate-legal-glow'); if (el) { const bb = await el.boundingBox(); if (bb) { await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(1500); } } }
  }
  return false;
});
await waitFor(() => A.evaluate(() => [...document.querySelectorAll('button')].some((b) => /^Next round/.test(b.textContent.trim()))));
await sleep(2500);
await clickText(B, /^Next round/);
await B.type('input[aria-label="Chat message"]', 'deal faster pls');
await B.keyboard.press('Enter');
await sleep(900);
await clickText(A, /^Next round/);
await waitFor(async () => (await st(A)).round === 2);
await sleep(2200);
const felt = await A.evaluate(() => [...document.querySelectorAll('.felt-msg')].map((e) => e.textContent).join(' | '));
console.log('netA felt after the deal:', JSON.stringify(felt));
await A.screenshot({ path: path.join(OUT, 'round2-felt.png'), clip: { x: 0, y: 0, width: 390, height: 560 } });
await sleep(3000);
await recorder.stop();
await browser.close();
