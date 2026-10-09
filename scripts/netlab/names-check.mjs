// Long-name stress run: plays a short game against 3 computers on the dev
// server at phone size, signed in under a 20-character name, with every
// computer seat renamed to a 20-character name on the wire (the socket's
// incoming frames are rewritten in the page, so every screen shows them).
// Screenshots of each screen go to <outdir>; look for names running off a
// card, overlapping or wrapping where they should not.
//   node scripts/netlab/names-check.mjs <outdir> [rounds] [baseUrl]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2];
const ROUNDS = Number(process.argv[3] || 3);
const BASE = process.argv[4] || 'http://localhost:5181';
fs.mkdirSync(OUT, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ME = 'testy thewizardwinnr'; // test* names stay out of History
const RENAME = {
  Merlin: 'Merlin Ambrosius XIV',
  Morgana: 'Morgana WildWWWWWWWW',
  Gandalf: 'Gandalf the Greyhame',
  Radagast: 'Radagast the Brownie',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
const page = await browser.newPage();
await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await page.evaluateOnNewDocument((rename) => {
  const re = new RegExp(`"(${Object.keys(rename).join('|')})"`, 'g');
  const fix = (s) => s.replace(re, (_, n) => JSON.stringify(rename[n]));
  const Native = window.WebSocket;
  window.WebSocket = class extends Native {
    set onmessage(fn) { super.onmessage = (ev) => fn(new MessageEvent('message', { data: typeof ev.data === 'string' ? fix(ev.data) : ev.data })); }
    get onmessage() { return super.onmessage; }
  };
}, RENAME);

let n = 0;
async function shot(label, full = false) {
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, `${String(++n).padStart(2, '0')}-${label}.png`), fullPage: full });
}
const room = () => page.evaluate(() => window.__wizardRoom && { status: window.__wizardRoom.status, turn: window.__wizardRoom.playerOrder[window.__wizardRoom.currentPlayerIndex], round: window.__wizardRoom.currentRound, total: window.__wizardRoom.totalRounds, code: window.__wizardRoom.code });
async function waitFor(fn, ms = 30000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(150); } throw new Error('timeout'); }
async function clickText(re, ms) { await waitFor(() => page.evaluate((src) => { const b = [...document.querySelectorAll('button')].find((x) => new RegExp(src).test(x.textContent.trim()) && !x.disabled); if (b) { b.click(); return true; } return false; }, re.source), ms); }

await page.goto(`${BASE}/?test`, { waitUntil: 'networkidle2' });
await page.waitForSelector('input[placeholder="Jorge"]');
await page.type('input[placeholder="Jorge"]', ME);
await sleep(1200);
await shot('signin-hint');
await page.type('input[placeholder="• • • •"]', '4242');
await clickText(/^Continue$/);
await waitFor(() => page.evaluate(() => !document.querySelector('input[placeholder="Jorge"]')));
await shot('home');
await clickText(/^Create room$/);
await waitFor(() => page.evaluate(() => /\/room\//.test(location.pathname) && [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Start game')));
await page.evaluate((rounds) => { const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => /Auto/.test(o.text))); if (sel) { const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(sel, String(rounds)); sel.dispatchEvent(new Event('change', { bubbles: true })); } }, ROUNDS);
await sleep(1000);
await shot('lobby', true);
await clickText(/^Start game$/);

const seen = new Set();
for (let guard = 0; guard < 600; guard++) {
  const r = await room();
  if (!r) { await sleep(200); continue; }
  if (r.status === 'finished') break;
  const key = `${r.status}-${r.round}`;
  if (r.status === 'bidding' && r.turn === ME) {
    if (!seen.has(key)) { seen.add(key); await sleep(1800); await shot(`bidding-r${r.round}`); }
    await page.evaluate(() => { const b = [...document.querySelectorAll('button.chip')].filter((x) => !x.disabled && /^\d+$/.test(x.textContent.trim())).sort((a, b) => +a.textContent - +b.textContent)[0]; b && b.click(); });
    await sleep(500); continue;
  }
  if (r.status === 'playing' && r.turn === ME && (await page.$('.animate-legal-glow'))) {
    if (!seen.has(key)) {
      seen.add(key);
      await page.evaluate(async (code) => { const m = await import('/src/lib/chat.ts'); await m.sendChatMessage(code, '', '', 'gg, that was a long name'); }, r.code);
      await sleep(1200);
      await shot(`playing-r${r.round}`);
    }
    const c = await page.evaluate(() => { const el = document.querySelector('.animate-legal-glow'); el.style.zIndex = '5000'; const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    await page.mouse.click(c.x, c.y);
    await sleep(700); continue;
  }
  if (r.status === 'playing' && !seen.has(`win-${r.round}`) && (await page.evaluate(() => /won/i.test(document.body.innerText)))) {
    seen.add(`win-${r.round}`); await shot(`trickwin-r${r.round}`);
  }
  if (r.status === 'scoring' && r.round < r.total) {
    if (!seen.has(key)) {
      seen.add(key);
      await sleep(2200);
      await shot(`roundend-r${r.round}`, true);
      // The ☰ score sheet.
      await clickText(/^Next round/, 8000).catch(() => {});
    }
    await sleep(300); continue;
  }
  await sleep(200);
}
await waitFor(async () => (await room())?.status === 'finished', 60000);
await sleep(8000); // replay (≤5 s) + label settle + recap
await shot('final', true);
await page.evaluate(() => window.scrollTo(0, 0));
await shot('final-top');
console.log(`${n} screenshots in ${OUT}`);
await browser.close();
