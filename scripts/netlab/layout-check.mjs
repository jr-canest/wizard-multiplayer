// Plays a 1-round game against 3 computers on the dev server and, at each
// screen (lobby, bidding, playing, round end, final), captures the visible
// screen at several device sizes plus the page height. Run before and after
// a layout change and diff the folders:
//   node scripts/netlab/layout-check.mjs <outdir> [baseUrl]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2];
const BASE = process.argv[3] || 'http://localhost:5181';
fs.mkdirSync(OUT, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SIZES = [['phone', 390, 844, true], ['bigphone', 430, 932, true], ['ipad', 820, 1180, true], ['desktop', 1440, 900, false]];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
const results = [];

async function capture(state) {
  for (const [name, w, h, mobile] of SIZES) {
    await page.setViewport({ width: w, height: h, isMobile: mobile, hasTouch: mobile });
    await sleep(900);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(150);
    const m = await page.evaluate(() => ({ zoom: getComputedStyle(document.body).getPropertyValue('--ui-zoom').trim(), vh: innerHeight, pageH: document.scrollingElement.scrollHeight }));
    await page.screenshot({ path: path.join(OUT, `${state}-${name}.png`) });
    results.push({ state, size: name, ...m, emptyScroll: m.pageH - m.vh });
  }
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await sleep(500);
}
const room = () => page.evaluate(() => window.__wizardRoom && { status: window.__wizardRoom.status, turn: window.__wizardRoom.playerOrder[window.__wizardRoom.currentPlayerIndex], bids: window.__wizardRoom.bids, round: window.__wizardRoom.currentRound });
async function waitFor(fn, ms = 30000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(150); } throw new Error('timeout'); }
async function clickText(re) { await waitFor(() => page.evaluate((src) => { const b = [...document.querySelectorAll('button')].find((x) => new RegExp(src).test(x.textContent.trim()) && !x.disabled); if (b) { b.click(); return true; } return false; }, re.source)); }

await page.goto(`${BASE}/?test`, { waitUntil: 'networkidle2' });
await page.waitForSelector('input[placeholder="Jorge"]');
await page.type('input[placeholder="Jorge"]', 'netA');
await page.type('input[placeholder="• • • •"]', '4242');
await clickText(/^Continue$/);
await waitFor(() => page.evaluate(() => !document.querySelector('input[placeholder="Jorge"]')));
await capture('home');
await clickText(/^Create room$/);
await waitFor(() => page.evaluate(() => /\/room\//.test(location.pathname) && [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Start game')));
// One round keeps the run short: round 1 is then the last round.
await page.evaluate(() => { const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => /Auto/.test(o.text))); if (sel) { const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(sel, '1'); sel.dispatchEvent(new Event('change', { bubbles: true })); } });
await sleep(800);
await capture('lobby');
await clickText(/^Start game$/);
await waitFor(async () => { const r = await room(); return r && r.status === 'bidding' && r.turn === 'netA'; });
await sleep(2500);
await capture('bidding');
await page.evaluate(() => { const b = [...document.querySelectorAll('button.chip')].filter((x) => !x.disabled && /^\d+$/.test(x.textContent.trim())).sort((a, b) => +a.textContent - +b.textContent)[0]; b && b.click(); });
await waitFor(async () => { const r = await room(); return r && r.status === 'playing' && r.turn === 'netA' && (await page.$('.animate-legal-glow')); });
await sleep(1500);
await capture('playing');
const c = await page.evaluate(() => { const el = document.querySelector('.animate-legal-glow'); el.style.zIndex = '5000'; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
await page.mouse.click(c.x, c.y);
await waitFor(async () => { const r = await room(); return r && r.status === 'scoring' && (await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => /^(Next round|Finish game)/.test(b.textContent.trim())))); }, 30000);
await sleep(1200);
await capture('roundend');
await clickText(/^(Finish game|Next round)/);
await waitFor(async () => { const r = await room(); return r && r.status === 'finished'; });
await sleep(7000); // replay graph (≤5 s) + recap settle
await capture('final');
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
for (const r of results) console.log(`${r.state.padEnd(9)} ${r.size.padEnd(9)} zoom ${Number(r.zoom).toFixed(2)}  screen ${r.vh}  page ${r.pageH}  empty scroll ${r.emptyScroll}`);
await browser.close();
