// The menu's game log and the shame vote, three signed-in phones (netA,
// netB, netC) on the dev server: plays round 1 and part of round 2, then
// A opens the log, starts a shame vote on B, C votes yes, everyone boos.
//   node scripts/netlab/shame-shots.mjs <outdir> [baseUrl]
// Run against a local server: wrangler dev --port 8788 --var SESSION_SECRET:x
// and vite with VITE_GAME_SERVER=http://localhost:8788 on 5181.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2];
const BASE = process.argv[3] || 'http://localhost:5181';
fs.mkdirSync(OUT, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
let fails = 0;
const ok = (c, m) => { console.log(c ? '  ok ' : '  FAIL', m); if (!c) fails++; };

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
  page.on('pageerror', (e) => { console.log('  PAGE ERROR', name, e.message); fails++; });
  return page;
}
async function waitFor(fn, ms = 30000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(150); } throw new Error('timeout'); }
async function clickText(page, re) { await waitFor(() => page.evaluate((src) => { const b = [...document.querySelectorAll('button')].find((x) => new RegExp(src).test(x.textContent.trim()) && !x.disabled); if (b) { b.click(); return true; } return false; }, re.source)); }
const room = (page) => page.evaluate(() => { const r = window.__wizardRoom; return r && { status: r.status, round: r.currentRound, trick: r.currentTrick, turn: r.playerOrder[r.currentPlayerIndex], order: r.playerOrder, ps: r.pendingShame ?? null, shames: r.log.filter((e) => e.t === 'shame').length }; });
const shot = async (page, label) => { await page.screenshot({ path: path.join(OUT, `${label}.png`) }); console.log('wrote', label); };
const text = (page) => page.evaluate(() => document.body.innerText);

const A = await phone('netA');
await clickText(A, /^Create room$/);
await waitFor(() => A.evaluate(() => /\/room\//.test(location.pathname) && !!window.__wizardRoom));
const code = await A.evaluate(() => location.pathname.split('/').pop());
const B = await phone('netB');
await B.goto(`${BASE}/room/${code}`, { waitUntil: 'networkidle2' });
await waitFor(() => A.evaluate(() => window.__wizardRoom.playerOrder.includes('netB')));
const C = await phone('netC');
await C.goto(`${BASE}/room/${code}`, { waitUntil: 'networkidle2' });
await waitFor(() => A.evaluate(() => window.__wizardRoom.playerOrder.includes('netC')));
await clickText(A, /^Start game$/);
const phones = { netA: A, netB: B, netC: C };

// Drive the table until `until(room)` is true: lowest bids, the legal card.
async function drive(until, ms = 120000) {
  await waitFor(async () => {
    const r = await room(A);
    if (r && until(r)) return true;
    if (r?.status === 'dealing') for (const p of [A, B, C]) await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /Hearts/.test(x.textContent)); b && b.click(); });
    if (r?.status === 'bidding') { const p = phones[r.turn]; await p?.evaluate(() => { const b = [...document.querySelectorAll('button.chip')].filter((x) => !x.disabled && /^\d+$/.test(x.textContent.trim())).sort((a, b) => +a.textContent - +b.textContent)[0]; b && b.click(); }); }
    if (r?.status === 'playing') { const p = phones[r.turn]; const el = await p?.$('.animate-legal-glow'); const bb = el && await el.boundingBox(); if (bb) await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); }
    if (r?.status === 'scoring') for (const p of [A, B, C]) await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /^Next round/.test(x.textContent.trim()) && !x.disabled); b && b.click(); });
    await sleep(500);
    return false;
  }, ms);
}
await drive((r) => r.round === 3 && r.status === "playing" && r.trick === 3);
await sleep(2200);

console.log('menu + game log');
await A.click('button[aria-label="Scores"]');
await sleep(400);
await shot(A, 's1-menu');
ok(/Game log/.test(await text(A)) && /Shame a player/.test(await text(A)), 'menu has Game log and Shame a player');
await clickText(A, /^Game log$/);
await waitFor(async () => /Round 1/i.test(await text(A)));
await sleep(500);
await shot(A, 's2-log');
const logText = await text(A);
ok(/Round 2/i.test(logText) && /Round 1/i.test(logText), 'both rounds listed');
ok(/Dealer/i.test(logText), 'dealer shown');
await A.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^Round 1/.test(b.textContent.trim())).click());
await sleep(300);
await shot(A, 's3-log-round1-open');
const fits = await A.evaluate(() => { const sheet = document.querySelector('.card-gold.fixed'); const r = sheet.getBoundingClientRect(); return { bottom: Math.round(r.bottom), vh: innerHeight, wide: document.documentElement.scrollWidth <= innerWidth }; });
ok(fits.bottom <= fits.vh && fits.wide, `log sheet stays on screen (${fits.bottom}/${fits.vh})`);

console.log('tap a tile: reactions');
await A.click('button[aria-label="Close"]');
await sleep(300);
const tapTile = async (page, who) => { const bb = await (await page.$(`[aria-label="React to ${who}"]`)).boundingBox(); await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); };
await tapTile(C, 'netA');
await C.waitForSelector('[role="menu"]');
await sleep(350);
await shot(C, 't1-picker');
const pk = await C.evaluate(() => { const r = document.querySelector('[role="menu"]').getBoundingClientRect(); return { l: r.left, r: r.right, n: document.querySelectorAll('[role="menu"] button').length, vw: innerWidth }; });
ok(pk.l >= 0 && pk.r <= pk.vw && pk.n === 3, `picker on screen with clap, shock and skull (${pk.n} buttons)`);
await C.evaluate(() => document.querySelector('[role="menu"] button').click());
await waitFor(() => A.evaluate(() => !!document.querySelector('.tile-cheer')));
await sleep(350);
await shot(A, 't2-clap-lands-on-me');
await shot(B, 't3-clap-on-tile');
ok(await B.evaluate(() => !!document.querySelector('[aria-label="React to netA"] .tile-cheer')), 'B sees the clap on netA\'s tile');
ok(await C.evaluate(() => !document.querySelector('[role="menu"]')), 'picker closed after sending');
await sleep(3000);
ok(await B.evaluate(() => !document.querySelector('.tile-cheer')), 'reaction clears itself');
await tapTile(B, 'netC');
await B.waitForSelector('[role="menu"]');
await B.evaluate(() => document.querySelector('[role="menu"] button[aria-label^="Shame vote"]').click());
await waitFor(async () => (await room(A))?.ps?.target === 'netC');
await sleep(400);
await shot(A, 't4-skull-opens-vote');
ok(/Shame vote/i.test(await text(A)), 'the skull opens the shame vote');
await clickText(B, /^Never mind$/);
await waitFor(async () => !(await room(A))?.ps);
await A.click('button[aria-label="Scores"]');
await sleep(400);
await clickText(A, /^Game log$/);
await sleep(500);

console.log('shame vote');
await clickText(A, /^Game log$/); // back
await clickText(A, /^Shame a player$/);
await sleep(300);
await shot(A, 's4-pick');
await clickText(A, /^netB$/);
await waitFor(async () => (await room(A))?.ps);
await sleep(500);
await shot(A, 's5-vote-opener');
await shot(C, 's6-vote-voter');
await shot(B, 's7-target-sees-table');
ok(/Shame vote/i.test(await text(C)) && /Shame vote/i.test(await text(A)), 'A and C see the vote');
ok(!/Shame vote/i.test(await text(B)), 'the target does not');
await clickText(C, /^Shame$/);
await waitFor(async () => (await room(A))?.shames === 1);
await sleep(600);
await shot(B, 's8-boo-on-target');
ok(/NETB/.test(await text(B)), 'boo names netB on every phone');
await sleep(2600);
await shot(B, 's9-after-boo-felt');
ok(!/Shame vote/i.test(await text(A)) && !(await room(A)).ps, 'vote closed');
await A.click('button[aria-label="Scores"]');
await sleep(400);
await shot(A, 's10-menu-chip');
ok(await A.evaluate(() => !!document.querySelector('.card-gold.fixed .shame-chip')), 'shame chip next to netB in the scores');
await clickText(A, /^Game log$/);
await sleep(700);
await shot(A, 's11-log-with-shame');
ok(/called by you/i.test(await text(A)), 'log records who called it');
await A.click('button[aria-label="Close"]');

console.log('play to the end: point reaches the final screen');
await drive((r) => r.status === "scoring" && r.round === 3);
await clickText(A, /end game now/);
for (const p of [B, C]) await clickText(p, /^Yes$/).catch(() => {});
await waitFor(async () => (await room(A))?.status === 'finished', 20000);
await sleep(6500);
await A.evaluate(() => document.querySelector('.shame-chip')?.scrollIntoView({ block: 'center' }));
await sleep(500);
await shot(A, 's12-final');
ok(await A.evaluate(() => !!document.querySelector('.shame-chip')), 'shame chip on the final standings');
console.log(fails ? `\n${fails} FAILED` : '\nALL CHECKS PASSED');
await browser.close();
process.exit(fails ? 1 : 0);
