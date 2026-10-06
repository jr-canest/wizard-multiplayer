// Plays a short game vs 3 computers on the dev server at phone size,
// screenshots every trick resolution and logs banner/commentary boxes +
// centering measurements.
//   node game.mjs <outdir> [rounds] [bidMode=low|high]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2];
const ROUNDS = process.argv[3] || '4';
const BID = process.argv[4] || 'high';
const W = Number(process.env.W || 390), H = Number(process.env.H || 844);
fs.mkdirSync(OUT, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const room = () => page.evaluate(() => { const r = window.__wizardRoom; return r && { status: r.status, turn: r.playerOrder[r.currentPlayerIndex], round: r.currentRound, th: r.trickHistory.length, tip: r.trickInProgress.length, order: r.playerOrder }; });
async function waitFor(fn, ms = 40000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(120); } throw new Error('timeout'); }
async function clickText(re) { await waitFor(() => page.evaluate((src) => { const b = [...document.querySelectorAll('button')].find((x) => new RegExp(src).test(x.textContent.trim()) && !x.disabled); if (b) { b.click(); return true; } return false; }, re.source)); }

await page.goto('http://localhost:5181/?test', { waitUntil: 'networkidle2' });
await page.waitForSelector('input[placeholder="Jorge"]');
await page.type('input[placeholder="Jorge"]', 'netA');
await page.type('input[placeholder="• • • •"]', '4242');
await clickText(/^Continue$/);
await waitFor(() => page.evaluate(() => !document.querySelector('input[placeholder="Jorge"]')));
await clickText(/^Create room$/);
await waitFor(() => page.evaluate(() => /\/room\//.test(location.pathname) && [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Start game')));
await page.evaluate((n) => { const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => /Auto/.test(o.text))); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(sel, n); sel.dispatchEvent(new Event('change', { bubbles: true })); }, ROUNDS);
await sleep(800);
await clickText(/^Start game$/);
const code = await page.evaluate(() => location.pathname.split('/').pop());
console.log('room', code);

const measure = () => page.evaluate(() => {
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) }; };
  const texts = (sel) => [...document.querySelectorAll(sel)].map((e) => ({ t: e.textContent.trim(), ...box(e) }));
  const felt = box(document.querySelector('[data-trick-area-frame]'));
  const trick = [...document.querySelectorAll('[data-drop="trick"] .absolute.left-1\\/2')].map((e) => box(e.querySelector('img') || e));
  return { felt, vw: innerWidth, trick, win: texts('.animate-trick-banner'), comm: texts('.animate-commentary-pop'), feltMsg: texts('.felt-msg') };
});

let lastTh = -1, shots = 0, events = [];
const t0 = Date.now();
while (Date.now() - t0 < 8 * 60_000) {
  const r = await room();
  if (!r) { await sleep(200); continue; }
  if (r.status === 'finished') break;
  if (r.status === 'bidding' && r.turn === 'netA') {
    await sleep(1600);
    await page.screenshot({ path: path.join(OUT, `r${r.round}-bid.png`) });
    events.push({ at: 'bid', r: r.round, m: await measure() });
    await page.evaluate((mode) => { const bs = [...document.querySelectorAll('button.chip')].filter((x) => !x.disabled && /^\d+$/.test(x.textContent.trim())).sort((a, b) => +a.textContent - +b.textContent); const b = mode === 'high' ? bs[bs.length - 1] : bs[0]; b && b.click(); }, BID);
    await sleep(900);
    await page.screenshot({ path: path.join(OUT, `r${r.round}-bid-after.png`) });
    continue;
  }
  if (r.status === 'playing' && r.turn === 'netA' && r.th === lastTh) {
    const c = await page.evaluate(() => { const el = document.querySelector('.animate-legal-glow'); if (!el) return null; el.style.zIndex = '5000'; const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    if (c) { await page.mouse.click(c.x, c.y); await sleep(250); events.push({ at: 'myplay', r: r.round, m: await measure() }); await sleep(500); events.push({ at: 'myplay+750', r: r.round, m: await measure() }); }
  }
  if (r.th !== lastTh && (r.status === 'playing' || r.status === 'scoring')) {
    if (lastTh >= 0 || r.th > 0) {
      for (const d of [150, 500, 1000, 1600]) {
        await sleep(d === 150 ? 150 : d - [150, 500, 1000, 1600][[150, 500, 1000, 1600].indexOf(d) - 1]);
        const m = await measure();
        events.push({ at: `trick+${d}`, r: r.round, th: r.th, m });
        if (m.win.length || m.comm.length) { shots++; await page.screenshot({ path: path.join(OUT, `r${r.round}-t${r.th}-${d}.png`), clip: { x: 0, y: 0, width: W, height: Math.min(H, 600) } }); }
      }
    }
    lastTh = r.th;
  }
  if (r.status === 'scoring') {
    try { await clickText(/^(Next round|Finish game)/); } catch {}
    await sleep(1500); lastTh = -1;
  }
  await sleep(100);
}
fs.writeFileSync(path.join(OUT, 'events.json'), JSON.stringify(events, null, 1));
console.log('shots', shots, 'events', events.length);
await browser.close();
