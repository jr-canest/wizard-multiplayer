// Sharp (3x) close-ups of small controls on a phone-size dev page: the
// Rounds dropdown in the lobby and the header buttons in a game.
//   node scripts/netlab/closeups.mjs <outdir>
import puppeteer from 'puppeteer-core';
import path from 'node:path';
const OUT = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
async function waitFor(fn, ms = 40000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(150); } throw new Error('timeout'); }
async function clickText(re) { await waitFor(() => page.evaluate((src) => { const b = [...document.querySelectorAll('button')].find((x) => new RegExp(src).test(x.textContent.trim()) && !x.disabled); if (b) { b.click(); return true; } return false; }, re.source)); }
const shotEl = async (sel, name, pad = 10) => { const b = await (await page.$(sel)).boundingBox(); await page.screenshot({ path: path.join(OUT, name), clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 } }); };
await page.goto('http://localhost:5181/?test', { waitUntil: 'networkidle2' });
await page.waitForSelector('input[placeholder="Jorge"]');
await page.type('input[placeholder="Jorge"]', 'netA');
await page.type('input[placeholder="• • • •"]', '4242');
await clickText(/^Continue$/);
await waitFor(() => page.evaluate(() => !document.querySelector('input[placeholder="Jorge"]')));
await clickText(/^Create room$/);
await page.waitForSelector('#rounds');
await sleep(600);
await shotEl('#rounds', 'close-dropdown.png', 14);
await clickText(/^Start game$/);
await page.waitForSelector('button[aria-label="Scores"]');
await sleep(1500);
const hb = await page.evaluate(() => { const a = document.querySelector('button[aria-label="Chat"]').getBoundingClientRect(); const b = document.querySelector('button[aria-label="Scores"]').getBoundingClientRect(); const s = document.querySelector('button[aria-label="Scores"] svg').getBoundingClientRect(); return { a: { x: a.x, y: a.y, w: a.width, h: a.height }, b: { x: b.x, y: b.y, w: b.width, h: b.height }, off: { dx: (s.x + s.width / 2) - (b.x + b.width / 2), dy: (s.y + s.height / 2) - (b.y + b.height / 2) } }; });
console.log('menu icon offset from button centre (px):', hb.off);
await page.screenshot({ path: path.join(OUT, 'close-menu.png'), clip: { x: hb.b.x - 90, y: hb.b.y - 10, width: hb.b.w + 100, height: hb.b.h + 20 } });
await browser.close();
