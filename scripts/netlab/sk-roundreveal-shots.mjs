// The round-results reveal on the scorekeeper: seeds a four-player test
// game (?test: nothing is saved to History) sitting on round 4's results,
// then shoots the screen at set moments of the reveal.
//   (lives in wizard-multiplayer: the scorekeeper repo has no puppeteer)
//   node scripts/netlab/sk-roundreveal-shots.mjs <outdir> [baseUrl=http://localhost:5180]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const OUT = process.argv[2];
const BASE = process.argv[3] || 'http://localhost:5180';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const names = ['Jorge', 'Nico', 'Avi', 'Mona'];
const players = names.map((name, i) => ({ id: `t${i + 1}`, name, addedInRound: 1, startingPoints: 0 }));
// [bid, won] per player per round; scores follow the Wizard rule.
const plays = [
  [[0, 0], [1, 1], [0, 0], [0, 0]],
  [[0, 0], [2, 1], [0, 1], [0, 1]],
  [[1, 1], [2, 1], [0, 0], [0, 0]],
  [[3, 2], [0, 1], [4, 4], [1, 1]],
];
const score = ([b, w]) => (b === w ? 20 + 10 * b : -10 * Math.abs(b - w));
const rounds = plays.map((row, r) => ({
  roundNumber: r + 1, cardsDealt: r + 1, dealerIndex: r % 4, trumpSuit: 'hearts',
  bids: Object.fromEntries(row.map((x, i) => [players[i].id, x[0]])),
  tricks: Object.fromEntries(row.map((x, i) => [players[i].id, x[1]])),
  scores: Object.fromEntries(row.map((x, i) => [players[i].id, score(x)])),
}));
const state = { players, settings: { firstDealerIndex: 0, canadianRule: true }, currentRound: 3, currentPhase: 'scored', isLastRound: false, lastRoundTrumpChoice: null, shamePoints: {}, nextRoundSetup: null, rounds, maxRounds: 15 };

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
for (let i = 0; i < 30; i++) { try { await page.goto(`${BASE}/?test`, { waitUntil: 'networkidle2' }); break; } catch { await sleep(500); } }
await page.evaluate((s) => localStorage.setItem('wizard-scorekeeper-state-test', JSON.stringify(s)), state);
await page.reload({ waitUntil: 'domcontentloaded' });
const t0w = Date.now();
while (!(await page.evaluate(() => !!document.querySelector('.standing-row'))) && Date.now() - t0w < 15000) await sleep(30);
const t0 = Date.now();
const snap = async (label) => {
  const info = await page.evaluate(() => ({ rows: [...document.querySelectorAll('.standing-row')].map((r) => r.innerText.replace(/\s+/g, ' ').trim()), quips: [...document.querySelectorAll('.round-quip')].map((q) => ({ t: q.innerText.replace(/\s+/g, ' ').trim(), shown: getComputedStyle(q).opacity !== '0' })) }));
  await page.screenshot({ path: path.join(OUT, `${label}.png`), clip: { x: 0, y: 0, width: 390, height: 560 } });
  console.log(`${label} @${Date.now() - t0}ms`, JSON.stringify(info.rows), JSON.stringify(info.quips));
};
await snap('k1-before');
await sleep(Math.max(0, 950 - (Date.now() - t0))); await snap('k2-points');
await sleep(Math.max(0, 1800 - (Date.now() - t0))); await snap('k3-moving');
await sleep(Math.max(0, 4300 - (Date.now() - t0))); await snap('k5-settled');
await page.reload({ waitUntil: 'networkidle2' });
await sleep(600); await snap('k6-after-reload');
await browser.close();
