// Two signed-in phones (netA, netB) plus computers on the dev server, for
// screenshots of the chat extras: typing dots, reactions, Leave game.
//   node scripts/netlab/chat-shots.mjs <outdir> [baseUrl]
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
await clickText(A, /^Start game$/);
// Both humans bid the lowest legal number until play starts.
await waitFor(async () => {
  const r = await room(A);
  if (r?.status === 'playing') return true;
  for (const p of [A, B]) await p.evaluate(() => { const b = [...document.querySelectorAll('button.chip')].filter((x) => !x.disabled && /^\d+$/.test(x.textContent.trim())).sort((a, b) => +a.textContent - +b.textContent)[0]; b && b.click(); });
  await sleep(400);
  return false;
}, 60000);
await sleep(2500);

// 1. B types in the chat hub; A sees dots on B's tile.
await B.click('button[aria-label="Chat"]');
await B.waitForSelector('input[aria-label="Chat message"]');
await B.type('input[aria-label="Chat message"]', 'are you seriously');
await sleep(1200);
await shot(A, '1-typing-tile', 560);
// 2. A opens the hub and sees the typing line too.
await A.click('button[aria-label="Chat"]');
await A.waitForSelector('input[aria-label="Chat message"]');
await sleep(800);
await shot(A, '2-typing-in-hub', 844);
await A.keyboard.press('Escape');
// B sends; A's felt shows it; A reacts from the hub.
await B.keyboard.press('Enter');
await sleep(800);
await A.click('button[aria-label="Chat"]');
await sleep(600);
await A.evaluate(() => { const row = [...document.querySelectorAll('[role="dialog"] [role="button"]')].find((x) => /are you seriously/.test(x.textContent)); row.click(); });
await sleep(500);
await shot(A, '3-react-picker', 844);
await A.evaluate(() => [...document.querySelectorAll('button[aria-label="React 😂"]')][0].click());
await sleep(600);
await shot(A, '4-reacted-in-hub', 844);
await A.keyboard.press('Escape');
await sleep(400);
await shot(B, '5-reaction-on-felt', 560);
// 6. Leave game from the ☰ sheet.
await A.click('button[aria-label="Scores"]');
await sleep(500);
await clickText(A, /^Leave game$/);
await sleep(400);
await shot(A, '6-leave-confirm', 640);
await A.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Leave game' && b.className.includes('btn-danger')).click());
await waitFor(() => A.evaluate(() => location.pathname === '/'));
await sleep(1200);
await shot(B, '7-after-leave-felt', 560);
await browser.close();
