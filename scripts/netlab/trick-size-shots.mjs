// Same trick, two card sizes: plays until netA is on the clock with most of
// a trick on the felt, shoots it, shrinks the trick cards in place to the
// candidate size and shoots again.
//   node scripts/netlab/trick-size-shots.mjs <outdir> <humans 1-3> <w>x<h>
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const [OUT, HUMANS = '1', SIZE = '56x79'] = process.argv.slice(2);
const [CW, CH] = SIZE.split('x').map(Number);
const BASE = 'http://localhost:5181';
fs.mkdirSync(OUT, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
async function waitFor(fn, ms = 30000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(150); } throw new Error('timeout'); }
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
const st = (p) => p.evaluate(() => { const r = window.__wizardRoom; return r && { status: r.status, turn: r.playerOrder[r.currentPlayerIndex], n: r.playerOrder.length, tip: r.trickInProgress.length, round: r.currentRound }; });

const names = ['netA', 'netB', 'netC'].slice(0, Number(HUMANS));
const pages = {};
pages.netA = await phone('netA');
const A = pages.netA;
await clickText(A, /^Create room$/);
await waitFor(() => A.evaluate(() => /\/room\//.test(location.pathname) && [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Start game')));
const code = await A.evaluate(() => location.pathname.split('/').pop());
for (const n of names.slice(1)) {
  pages[n] = await phone(n);
  await pages[n].goto(`${BASE}/room/${code}`, { waitUntil: 'networkidle2' });
  await waitFor(() => A.evaluate((x) => window.__wizardRoom.playerOrder.includes(x), n));
}
await clickText(A, /^Start game$/);

const want = async () => { const r = await st(A); return r.status === 'playing' && r.turn === 'netA' && r.tip >= r.n - 2 && r.tip > 0; };
const t0 = Date.now();
while (!(await want())) {
  if (Date.now() - t0 > 150000) throw new Error('never got a full trick');
  const r = await st(A);
  for (const n of names) {
    const p = pages[n];
    await p.evaluate(() => { const b = [...document.querySelectorAll('button.chip')].filter((x) => !x.disabled && /^\d+$/.test(x.textContent.trim())).sort((a, b) => +a.textContent - +b.textContent)[0]; b && b.click(); });
    await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /^Next round/.test(x.textContent.trim()) && !x.disabled); b && b.click(); });
    if (r.status === 'playing' && r.turn === n && (n !== 'netA' || !(await want()))) {
      const el = await p.$('.animate-legal-glow');
      if (el) { const bb = await el.boundingBox(); if (bb) await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(2200); }
    }
  }
  await sleep(500);
}
await sleep(1500);
const tag = `${names.length + 3}p`;
await A.screenshot({ path: path.join(OUT, `trick-${tag}-before.png`), clip: { x: 0, y: 0, width: 390, height: 560 } });
await A.evaluate(({ CW, CH }) => { for (const img of document.querySelectorAll('[data-drop="trick"] img')) { img.style.width = `${CW}px`; img.style.height = `${CH}px`; } }, { CW, CH });
await sleep(300);
await A.screenshot({ path: path.join(OUT, `trick-${tag}-after.png`), clip: { x: 0, y: 0, width: 390, height: 560 } });
console.log('wrote', tag, JSON.stringify(await st(A)));
await browser.close();
