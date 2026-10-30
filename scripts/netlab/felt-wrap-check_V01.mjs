// Long unbroken chat word on the felt + centre column jump probe (2026-10-29).
// two signed-in phones plus computers on the dev server.
//   node scripts/netlab/felt-wrap-check_V01.mjs <outdir> [baseUrl]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2];
const BASE = process.argv[3] || 'http://localhost:5181';
fs.mkdirSync(OUT, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });

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
async function waitFor(fn, ms = 30000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(150); } throw new Error('timeout'); }
async function clickText(page, re) { await waitFor(() => page.evaluate((src) => { const b = [...document.querySelectorAll('button')].find((x) => new RegExp(src).test(x.textContent.trim()) && !x.disabled); if (b) { b.click(); return true; } return false; }, re.source)); }
const room = (page) => page.evaluate(() => window.__wizardRoom && { status: window.__wizardRoom.status, turn: window.__wizardRoom.playerOrder[window.__wizardRoom.currentPlayerIndex], code: window.__wizardRoom.code, bids: window.__wizardRoom.bids });
const shot = async (page, label, h = 844) => { await page.screenshot({ path: path.join(OUT, `${label}.png`), clip: { x: 0, y: 0, width: 390, height: h } }); console.log('wrote', label); };

const A = await phone('netA');
await clickText(A, /^Create room$/);
await waitFor(() => A.evaluate(() => /\/room\//.test(location.pathname) && [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Start game')));
const code = await A.evaluate(() => location.pathname.split('/').pop());
const B = await phone('netB');
await B.goto(`${BASE}/room/${code}`, { waitUntil: 'networkidle2' });
await waitFor(async () => (await room(A))?.code && (await A.evaluate(() => window.__wizardRoom.playerOrder.includes('netB'))));
const C = await phone('netC');
await C.goto(`${BASE}/room/${code}`, { waitUntil: 'networkidle2' });
await waitFor(() => A.evaluate(() => window.__wizardRoom.playerOrder.includes('netC')));
await clickText(A, /^Start game$/);
// Both humans bid the lowest legal number until play starts.
await waitFor(async () => {
  const r = await room(A);
  if (r?.status === 'playing') return true;
  for (const p of [A, B, C]) await p.evaluate(() => { const b = [...document.querySelectorAll('button.chip')].filter((x) => !x.disabled && /^\d+$/.test(x.textContent.trim())).sort((a, b) => +a.textContent - +b.textContent)[0]; b && b.click(); });
  await sleep(400);
  return false;
}, 60000);
await sleep(2500);

// 1. A long word with no spaces must wrap inside the felt.
await B.click('button[aria-label="Chat"]');
await B.waitForSelector('input[aria-label="Chat message"]');
await B.type('input[aria-label="Chat message"]', 'Wh' + 'y'.repeat(40));
await B.keyboard.press('Enter');
await sleep(1200);
await shot(A, 'w1-long-word', 560);
const fit = await A.evaluate(() => {
  const b = [...document.querySelectorAll('.felt-msg .pointer-events-auto')].find((x) => /yyyy/.test(x.textContent));
  const f = b.closest('[data-trick-area-frame]') || b.parentElement.closest('.felt');
  const br = b.getBoundingClientRect(); const fr = f.getBoundingClientRect();
  return { bubbleRight: Math.round(br.right), feltRight: Math.round(fr.right), pageW: document.documentElement.scrollWidth };
});
console.log('fit', JSON.stringify(fit), fit.bubbleRight <= fit.feltRight ? 'OK' : 'OVERFLOW');

// 2. Play on while A logs the centre column every frame; report the
// biggest one-frame move of a card that stayed on screen.
await A.evaluate(() => {
  window.__moves = []; let prev = new Map();
  const tick = () => {
    const col = document.querySelector('.z-\\[300\\] > div');
    const now = new Map();
    if (col) for (const c of col.children) {
      if (c.classList.contains('felt-msg-out')) continue;
      const t = c.textContent.trim().slice(0, 18); const y = c.getBoundingClientRect().top;
      now.set(t, y);
      if (prev.has(t)) window.__moves.push({ t, d: Math.abs(y - prev.get(t)), n: col.children.length });
    }
    prev = now; requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const t0 = Date.now();
while (Date.now() - t0 < 60000) {
  for (const p of [A, B, C]) {
    const c = await p.evaluate(() => { const el = document.querySelector('.animate-legal-glow'); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }).catch(() => null);
    if (c) await p.mouse.click(c.x, c.y).catch(() => {});
  }
  for (const p of [A, B, C]) await p.evaluate(() => { const b = [...document.querySelectorAll('button.chip')].filter((x) => !x.disabled && /^\d+$/.test(x.textContent.trim())).sort((a, b) => +a.textContent - +b.textContent)[0]; b && b.click(); }).catch(() => {});
  await sleep(200);
}
const moves = await A.evaluate(() => window.__moves);
const big = moves.filter((m) => m.d > 0.5);
const max = big.reduce((a, m) => (m.d > a.d ? m : a), { d: 0 });
console.log('frames moving:', big.length, 'biggest one-frame move:', max.d.toFixed(1), 'px', max.t);
console.log('moves over 8px in one frame:', big.filter((m) => m.d > 8).map((m) => `${m.t}:${m.d.toFixed(0)}`).join(' ') || 'none');
await browser.close();
