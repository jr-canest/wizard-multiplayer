// The round-results reveal (rows start in the old order, points land, rows
// slide, commentary pops): three signed-in phones on the dev server play
// to the end of round <rounds>, then netA's screen is shot at set moments
// of the reveal and the row order + lines are printed.
//   node scripts/netlab/roundreveal-shots.mjs <outdir> [rounds=3] [baseUrl]
// Local server: wrangler dev --port 8788 --var SESSION_SECRET:x and vite
// with VITE_GAME_SERVER=http://localhost:8788 on 5181.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const OUT = process.argv[2];
const ROUNDS = Number(process.argv[3] || 3);
const BASE = process.argv[4] || 'http://localhost:5181';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-first-run'] });
async function waitFor(fn, ms = 30000, every = 150) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(every); } throw new Error('timeout'); }
async function clickText(page, re) { await waitFor(() => page.evaluate((src) => { const b = [...document.querySelectorAll('button')].find((x) => new RegExp(src).test(x.textContent.trim()) && !x.disabled); if (b) { b.click(); return true; } return false; }, re.source)); }
async function phone(name) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[placeholder="Jorge"]');
  await page.type('input[placeholder="Jorge"]', name);
  await page.type('input[placeholder="• • • •"]', '4242');
  await clickText(page, /^Continue$/);
  await waitFor(() => page.evaluate(() => !document.querySelector('input[placeholder="Jorge"]')));
  page.on('pageerror', (e) => console.log('PAGE ERROR', name, e.message));
  return page;
}
const A = await phone('netA');
await clickText(A, /^Create room$/);
await waitFor(() => A.evaluate(() => /\/room\//.test(location.pathname) && !!window.__wizardRoom));
const code = await A.evaluate(() => location.pathname.split('/').pop());
const B = await phone('netB'); await B.goto(`${BASE}/room/${code}`, { waitUntil: 'networkidle2' });
await waitFor(() => A.evaluate(() => window.__wizardRoom.playerOrder.includes('netB')));
const C = await phone('netC'); await C.goto(`${BASE}/room/${code}`, { waitUntil: 'networkidle2' });
await waitFor(() => A.evaluate(() => window.__wizardRoom.playerOrder.includes('netC')));
await clickText(A, /^Start game$/);
const phones = { netA: A, netB: B, netC: C };
const room = () => A.evaluate(() => { const r = window.__wizardRoom; return r && { status: r.status, round: r.currentRound, turn: r.playerOrder[r.currentPlayerIndex] }; });
// Different bids per seat so rounds produce made and missed bids.
const bidPick = { netA: 'low', netB: 'high', netC: 'mid' };
async function step(r, { next = true } = {}) {
  if (r.status === 'dealing') for (const p of [A, B, C]) await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /Hearts/.test(x.textContent)); b && b.click(); });
  if (r.status === 'bidding') await phones[r.turn]?.evaluate((pick) => { const bs = [...document.querySelectorAll('button.chip')].filter((x) => !x.disabled && /^\d+$/.test(x.textContent.trim())).sort((a, b) => +a.textContent - +b.textContent); const b = pick === 'low' ? bs[0] : pick === 'high' ? bs[Math.min(bs.length - 1, 1)] : bs[Math.floor(bs.length / 2)]; b && b.click(); }, bidPick[r.turn]);
  if (r.status === 'playing') { const p = phones[r.turn]; const el = await p?.$('.animate-legal-glow'); const bb = el && await el.boundingBox(); if (bb) await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); }
  if (r.status === 'scoring' && next) for (const p of [A, B, C]) await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /^Next round/.test(x.textContent.trim()) && !x.disabled); b && b.click(); });
}
await waitFor(async () => { const r = await room(); if (r.round === ROUNDS && r.status === 'scoring') return true; await step(r); await sleep(450); return false; }, 240000);
// The results screen comes up after the last-trick hold: catch its first frame.
await waitFor(() => A.evaluate(() => !!document.querySelector('.standing-row')), 15000, 40);
const t0 = Date.now();
const snap = async (label) => {
  const info = await A.evaluate(() => ({ rows: [...document.querySelectorAll('.standing-row')].map((r) => r.innerText.replace(/\s+/g, ' ').trim()), quips: [...document.querySelectorAll('.round-quip')].map((q) => ({ t: q.innerText.replace(/\s+/g, ' ').trim(), shown: getComputedStyle(q).opacity !== '0' })) }));
  await A.screenshot({ path: path.join(OUT, `${label}.png`), clip: { x: 0, y: 0, width: 390, height: 520 } });
  console.log(`${label} @${Date.now() - t0}ms`, JSON.stringify(info.rows), JSON.stringify(info.quips));
};
await snap('r1-before');
await sleep(Math.max(0, 900 - (Date.now() - t0))); await snap('r2-points');
await sleep(Math.max(0, 1750 - (Date.now() - t0))); await snap('r3-moving');
await sleep(Math.max(0, 2700 - (Date.now() - t0))); await snap('r4-quip1');
await sleep(Math.max(0, 4200 - (Date.now() - t0))); await snap('r5-settled');
// A vote landing re-renders the screen: the reveal must not replay.
await B.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /^Next round/.test(x.textContent.trim())); b && b.click(); });
await sleep(600); await snap('r6-after-a-vote');
await browser.close();
