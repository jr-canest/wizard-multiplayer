// Two scripted phones (netA host, netB) that keep a table going so a third
// player can be driven by hand, e.g. netC in the iOS Simulator at
// http://localhost:5181. They bid the lowest number, play the legal card
// and tick Next round by themselves. Commands are read from <dir>/cmd
// (one line, the file is deleted once read):
//   cheer <from A|B> <to name> <emoji>   send a tile reaction
//   shame <from A|B> <target name>       open a shame vote
//   vote <A|B> yes|no                    answer the open shame vote
//   say <A|B> <text>                     chat line
//   pause | resume                       stop / restart the autoplay
//   quit
// The room code is written to <dir>/code.
//   node scripts/netlab/sim-table.mjs <dir> [baseUrl]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const DIR = process.argv[2];
const BASE = process.argv[3] || 'http://localhost:5181';
fs.mkdirSync(DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-first-run'] });
async function waitFor(fn, ms = 30000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(150); } throw new Error('timeout'); }
async function clickText(page, re) { await waitFor(() => page.evaluate((src) => { const b = [...document.querySelectorAll('button')].find((x) => new RegExp(src).test(x.textContent.trim()) && !x.disabled); if (b) { b.click(); return true; } return false; }, re.source)); }
async function phone(name) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[placeholder="Jorge"]');
  await page.type('input[placeholder="Jorge"]', name);
  await page.type('input[placeholder="• • • •"]', '4242');
  await clickText(page, /^Continue$/);
  await waitFor(() => page.evaluate(() => !document.querySelector('input[placeholder="Jorge"]')));
  return page;
}
const A = await phone('netA');
await clickText(A, /^Create room$/);
await waitFor(() => A.evaluate(() => /\/room\//.test(location.pathname) && !!window.__wizardRoom));
const code = await A.evaluate(() => location.pathname.split('/').pop());
fs.writeFileSync(path.join(DIR, 'code'), code);
console.log('room', code);
const B = await phone('netB');
await B.goto(`${BASE}/room/${code}`, { waitUntil: 'networkidle2' });
const P = { A, B, netA: A, netB: B };
console.log('waiting for a third player');
await waitFor(() => A.evaluate(() => window.__wizardRoom.playerOrder.length >= 3), 600000);
await sleep(800);
await clickText(A, /^Start game$/);
console.log('started');
let paused = false;
const room = () => A.evaluate(() => { const r = window.__wizardRoom; return r && { status: r.status, turn: r.playerOrder[r.currentPlayerIndex], dealer: r.playerOrder[r.dealerIndex], await: r.awaitingTrumpChoice }; });
for (;;) {
  const cmdFile = path.join(DIR, 'cmd');
  if (fs.existsSync(cmdFile)) {
    const line = fs.readFileSync(cmdFile, 'utf8').trim(); fs.unlinkSync(cmdFile);
    const [c, a, b, ...rest] = line.split(' ');
    console.log('cmd', line);
    try {
      if (c === 'quit') break;
      if (c === 'pause') paused = true;
      if (c === 'resume') paused = false;
      if (c === 'cheer') await P[a].evaluate(async (to, e) => { const { connectionFor } = await import('/src/lib/socket.ts'); connectionFor(window.__wizardRoom.code).cheer(to, e); }, b, rest[0]);
      if (c === 'shame') await P[a].evaluate(async (t) => { const { openShameVote } = await import('/src/lib/gameFlow.ts'); await openShameVote(window.__wizardRoom.code, t); }, b);
      if (c === 'vote') await P[a].evaluate(async (y) => { const { castShameVote } = await import('/src/lib/gameFlow.ts'); await castShameVote(window.__wizardRoom.code, y); }, b === 'yes');
      if (c === 'say') await P[a].evaluate(async (t) => { const { sendChat } = await import('/src/lib/chat.ts'); await sendChat(window.__wizardRoom.code, '', t); }, [b, ...rest].join(' '));
    } catch (e) { console.log('cmd failed', e.message); }
  }
  if (!paused) {
    const r = await room().catch(() => null);
    if (r?.await && P[r.dealer]) await P[r.dealer].evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /Hearts/.test(x.textContent)); b && b.click(); });
    else if (r?.status === 'bidding' && P[r.turn]) await P[r.turn].evaluate(() => { const b = [...document.querySelectorAll('button.chip')].filter((x) => !x.disabled && /^\d+$/.test(x.textContent.trim())).sort((a, b) => +a.textContent - +b.textContent)[0]; b && b.click(); });
    else if (r?.status === 'playing' && P[r.turn]) { const el = await P[r.turn].$('.animate-legal-glow'); const bb = el && await el.boundingBox(); if (bb) await P[r.turn].touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); }
    else if (r?.status === 'scoring') for (const p of [A, B]) await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /^Next round/.test(x.textContent.trim()) && !x.disabled); b && b.click(); });
  }
  await sleep(700);
}
await browser.close();
