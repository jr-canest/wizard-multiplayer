// Logs every tone the page plays (oscillator start frequency) next to what
// the table was doing, in a solo game vs 3 computers on the dev server.
// The phone sits untouched for IDLE ms on each of its bid turns, like a
// player reading their hand, then bids.
//   node scripts/netlab/sound-log.mjs [rounds] [idleMs]
import puppeteer from 'puppeteer-core';

const ROUNDS = process.argv[2] || '3';
const IDLE = Number(process.argv[3] || 7000);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await page.evaluateOnNewDocument(() => {
  window.__tones = [];
  const t0 = Date.now();
  // Tones set their pitch with setValueAtTime just before start(), so
  // .value still reads the 440 default: catch the scheduled value instead.
  const create = BaseAudioContext.prototype.createOscillator;
  BaseAudioContext.prototype.createOscillator = function () {
    const osc = create.call(this);
    const set = osc.frequency.setValueAtTime.bind(osc.frequency);
    osc.frequency.setValueAtTime = (v, t) => { osc.__hz = v; return set(v, t); };
    return osc;
  };
  const orig = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (...a) {
    const r = window.__wizardRoom;
    window.__tones.push({ ms: Date.now() - t0, hz: Math.round(this.__hz ?? this.frequency.value), status: r?.status, turn: r && r.playerOrder[r.currentPlayerIndex], round: r?.currentRound });
    return orig.apply(this, a);
  };
});
async function waitFor(fn, ms = 40000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(120); } throw new Error('timeout'); }
async function clickText(re) { await waitFor(() => page.evaluate((src) => { const b = [...document.querySelectorAll('button')].find((x) => new RegExp(src).test(x.textContent.trim()) && !x.disabled); if (b) { b.click(); return true; } return false; }, re.source)); }
const st = () => page.evaluate(() => { const r = window.__wizardRoom; return r && { status: r.status, turn: r.playerOrder[r.currentPlayerIndex], round: r.currentRound, bid: r.bids.netA }; });
const mark = (label) => page.evaluate((l) => window.__tones.push({ mark: l }), label);

await page.goto('http://localhost:5181/?test', { waitUntil: 'networkidle2' });
await page.waitForSelector('input[placeholder="Jorge"]');
await page.type('input[placeholder="Jorge"]', 'netA');
await page.type('input[placeholder="• • • •"]', '4242');
await clickText(/^Continue$/);
await waitFor(() => page.evaluate(() => !document.querySelector('input[placeholder="Jorge"]')));
await clickText(/^Create room$/);
await waitFor(() => page.evaluate(() => /\/room\//.test(location.pathname) && [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Start game')));
await page.evaluate((n) => { const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => /Auto/.test(o.text))); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(sel, n); sel.dispatchEvent(new Event('change', { bubbles: true })); }, ROUNDS);
await sleep(500);
await page.touchscreen.tap(5, 5); // unlock audio like a first tap
await clickText(/^Start game$/);

let lastRound = 0;
const t0 = Date.now();
while (Date.now() - t0 < 240000) {
  const r = await st();
  if (r.status === 'finished') break;
  if (r.status === 'bidding' && r.turn === 'netA' && r.bid === undefined && r.round !== lastRound) {
    lastRound = r.round;
    await mark(`round ${r.round}: my bid turn, hands off ${IDLE} ms`);
    await sleep(IDLE);
    await mark('tap bid');
    const b = await page.$$('button.chip');
    for (const x of b) { const ok = await x.evaluate((e) => !e.disabled && /^\d+$/.test(e.textContent.trim())); if (ok) { const bb = await x.boundingBox(); await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); break; } }
  } else if (r.status === 'playing' && r.turn === 'netA') {
    const el = await page.$('.animate-legal-glow');
    if (el) { const bb = await el.boundingBox(); if (bb) { await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(2200); } }
  } else if (r.status === 'scoring') {
    await mark('round end: wait 6 s on the scoreboard, then Next round');
    await sleep(6000);
    const nb = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((x) => /^Next round/.test(x.textContent.trim()) && !x.disabled));
    const bb = nb.asElement() && (await nb.asElement().boundingBox());
    if (bb) await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await sleep(1500);
  }
  await sleep(250);
}
// 784 + 659 also sit in the bids-in chord; the bell's own second note is 1175.
const NAMES = { 1175: 'YOUR-TURN BELL', 880: 'chat bloop (A5)' };
for (const t of await page.evaluate(() => window.__tones)) {
  if (t.mark) { console.log(`   --- ${t.mark}`); continue; }
  if (t.hz >= 1500) continue; // overtones / snaps
  console.log(`${String(t.ms).padStart(7)} ms  ${String(t.hz).padStart(5)} Hz  ${NAMES[t.hz] ?? ''}  [${t.status} r${t.round} turn=${t.turn}]`);
}
await browser.close();
