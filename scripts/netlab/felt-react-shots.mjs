// Reacting to a chat line on the felt (tap the bubble over the table),
// two signed-in phones plus computers on the dev server.
//   node scripts/netlab/felt-react-shots.mjs <outdir> [baseUrl]
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

// B sends a line; A taps it on the felt, a real touch at the bubble.
await B.click('button[aria-label="Chat"]');
await B.waitForSelector('input[aria-label="Chat message"]');
await B.type('input[aria-label="Chat message"]', 'did you just trump my ace');
await B.keyboard.press('Enter');
await sleep(1200);
await shot(A, 'f1-line-on-felt', 560);
const box = await A.evaluate(() => { const el = [...document.querySelectorAll('.felt-msg .pointer-events-auto')].find((x) => /trump my ace/.test(x.textContent)); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
// A card dropped on the bubble still lands in the trick zone.
const dropOk = await A.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-drop="trick"], [data-trick-area-frame]'), box);
console.log('drop on bubble counts:', dropOk);
await A.touchscreen.tap(box.x, box.y);
await sleep(500);
await shot(A, 'f2-picker-on-felt', 560);
await A.evaluate(() => document.querySelector('button[aria-label="React ❤️"]').click());
await sleep(800);
await shot(A, 'f3-reacted-on-felt', 560);
// Others react through the same action the picker sends.
const react = (page, emoji) => page.evaluate(async (e) => {
  const { peekChat } = await import('/src/lib/socket.ts');
  const { reactToChat } = await import('/src/lib/chat.ts');
  const code = window.__wizardRoom.code;
  const line = peekChat(code).find((m) => /trump my ace/.test(m.text));
  await reactToChat(code, line, e);
}, emoji);
await react(C, '❤️');
await sleep(700);
await shot(B, 'f4-two-same', 560);
await react(B, '😂');
await sleep(700);
await shot(B, 'f5-mixed', 560);
// In the chat hub too.
await B.click('button[aria-label="Chat"]');
await sleep(700);
await shot(B, 'f6-mixed-in-hub', 844);
await browser.close();
