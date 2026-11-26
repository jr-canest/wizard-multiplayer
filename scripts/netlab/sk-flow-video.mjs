// The SCOREKEEPER's walkthrough VIDEO WITH SOUND (lives here because the
// scorekeeper repo has no puppeteer): a seeded four-player ?test game
// (nothing is saved to History) is scored by hand through two rounds, with
// a shame point on the way, so the round-results reveal, its commentary
// and every sound can be watched in flow. Sound and sync work as in
// flow-video.mjs: the app logs each sound (run() in its sounds.js, emit()
// in revealSounds.ts), the script rebuilds the track offline, and two white
// flashes line it up with the picture.
//   node scripts/netlab/sk-flow-video.mjs <outdir> [baseUrl=http://localhost:5180]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const OUT = process.argv[2];
const BASE = process.argv[3] || 'http://localhost:5180';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const names = ['Jorge', 'Nico', 'Avi', 'Mona'];
const players = names.map((name, i) => ({ id: `t${i + 1}`, name, addedInRound: 1, startingPoints: 0 }));
const done = [
  [[0, 0], [1, 1], [0, 0], [0, 0]],
  [[0, 0], [2, 1], [0, 1], [1, 1]],
];
const score = ([b, w]) => (b === w ? 20 + 10 * b : -10 * Math.abs(b - w));
const rounds = done.map((row, r) => ({
  roundNumber: r + 1, cardsDealt: r + 1, dealerIndex: r % 4, trumpSuit: 'hearts',
  bids: Object.fromEntries(row.map((x, i) => [players[i].id, x[0]])),
  tricks: Object.fromEntries(row.map((x, i) => [players[i].id, x[1]])),
  scores: Object.fromEntries(row.map((x, i) => [players[i].id, score(x)])),
}));
rounds.push({ roundNumber: 3, cardsDealt: 3, dealerIndex: 2, trumpSuit: 'hearts', bids: {}, tricks: {}, scores: {} });
const state = { players, settings: { firstDealerIndex: 0, canadianRule: true }, currentRound: 2, currentPhase: 'bidding', isLastRound: false, lastRoundTrumpChoice: null, shamePoints: {}, nextRoundSetup: null, rounds, maxRounds: 15 };

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-first-run', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const A = page;
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
await page.evaluateOnNewDocument(() => {
  // Each logged sound gets the name of the play* function that asked for it.
  const log = [];
  const push = log.push.bind(log);
  log.push = (e) => { e.name = (new Error().stack || '').match(/at (play\w+)/)?.[1] || '?'; return push(e); };
  window.__wizardSoundLog = log;
  // A full-screen white flash the script later finds in the recording.
  window.__flash = () => new Promise((res) => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff'; document.body.appendChild(d); const at = performance.now(); setTimeout(() => { d.remove(); res(at); }, 160); });
});
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
for (let i = 0; i < 30; i++) { try { await page.goto(`${BASE}/?test`, { waitUntil: 'networkidle2' }); break; } catch { await sleep(500); } }
await page.evaluate((s) => localStorage.setItem('wizard-scorekeeper-state-test', JSON.stringify(s)), state);
await page.reload({ waitUntil: 'networkidle2' });
await page.waitForSelector('button.chip');

async function waitFor(fn, ms = 15000, every = 100) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(every); } throw new Error('timeout'); }
/** A real touch on the element, scrolled into view first like a thumb would. */
async function tapEl(handle) {
  await handle.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  await sleep(380);
  const bb = await handle.boundingBox();
  await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
}
async function tapText(re) {
  const h = await waitFor(async () => {
    for (const b of await page.$$('button')) {
      if (await b.evaluate((el, src) => new RegExp(src).test(el.textContent.trim()) && !el.disabled, re.source)) return b;
    }
    return null;
  });
  await tapEl(h);
}
/** One number per player block, top to bottom (a locked chip takes the next one up). */
async function enter(values, beat = 520) {
  for (let i = 0; i < values.length; i++) {
    const h = await page.evaluateHandle((idx, want) => {
      const groups = [...new Set([...document.querySelectorAll('button.chip')].map((b) => b.parentElement))];
      const chips = [...groups[idx].querySelectorAll('button.chip')];
      return chips.find((c) => +c.textContent === want && !c.disabled) ?? chips.find((c) => +c.textContent === want + 1 && !c.disabled) ?? chips.find((c) => !c.disabled);
    }, i, values[i]);
    await tapEl(h.asElement());
    await sleep(beat);
  }
}
const results = async (hold) => {
  await waitFor(() => page.evaluate(() => !!document.querySelector('.standing-row')));
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await sleep(hold);
};
/** A new round may ask for the trump first. */
async function intoBidding() {
  await waitFor(async () => {
    if (await page.$('button.chip')) return true;
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /Hearts/.test(x.textContent)); if (b) b.click(); });
    return false;
  }, 15000, 400);
  await sleep(700);
}

// ── record ────────────────────────────────────────────────────────────
const recorder = await page.screencast({ path: path.join(OUT, 'flow.webm') });
const recT0 = await page.evaluate(() => performance.now());
await sleep(700);
const flash1 = await page.evaluate(() => window.__flash());
await sleep(1100);

// Round 3: bids, then the tricks with a shame point on the way.
await enter([1, 0, 2, 1]);
await sleep(500);
await tapText(/^Confirm bids/);
await page.waitForSelector('button[title="Shame point"]');
await sleep(900);
await enter([1, 1]);
await tapEl((await page.$$('button[title="Shame point"]'))[1]);
await sleep(1100);
await tapText(/^BOOO!$/);
await sleep(2400);
await enter([1, 1, 1, 0]);
await sleep(600);
await tapText(/^Score round/);
await results(5600);

// Round 4.
await tapText(/^Start round/);
await intoBidding();
await enter([2, 2, 0, 1]);
await sleep(500);
await tapText(/^Confirm bids/);
await page.waitForSelector('button[title="Shame point"]');
await sleep(900);
await enter([2, 1, 0, 1]);
await sleep(600);
await tapText(/^Score round/);
await results(6000);
const flash2 = await page.evaluate(() => window.__flash());
await sleep(500);
await recorder.stop();

// ── soundtrack ────────────────────────────────────────────────────────
const SR = 32000;
const wavB64 = await page.evaluate(async (t0, SR) => {
  const log = (window.__wizardSoundLog || []).filter((e) => e.at >= t0);
  const end = Math.max(1, ...log.map((e) => (e.at - t0) / 1000)) + 3.5;
  const mix = new Float32Array(Math.ceil(end * SR));
  for (const e of log) {
    const oc = new OfflineAudioContext(1, SR * 3, SR);
    try { e.voice(oc, oc.destination, 0); } catch { continue; }
    const data = (await oc.startRendering()).getChannelData(0);
    const off = Math.floor(((e.at - t0) / 1000) * SR);
    for (let i = 0; i < data.length && off + i < mix.length; i++) mix[off + i] += data[i];
  }
  const pcm = new Int16Array(mix.length);
  for (let i = 0; i < mix.length; i++) pcm[i] = Math.max(-1, Math.min(1, mix[i])) * 32767;
  const head = new DataView(new ArrayBuffer(44));
  const w = (o, s) => [...s].forEach((c, i) => head.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); head.setUint32(4, 36 + pcm.byteLength, true); w(8, 'WAVEfmt '); head.setUint32(16, 16, true); head.setUint16(20, 1, true); head.setUint16(22, 1, true);
  head.setUint32(24, SR, true); head.setUint32(28, SR * 2, true); head.setUint16(32, 2, true); head.setUint16(34, 16, true); w(36, 'data'); head.setUint32(40, pcm.byteLength, true);
  const bytes = new Uint8Array(44 + pcm.byteLength);
  bytes.set(new Uint8Array(head.buffer), 0); bytes.set(new Uint8Array(pcm.buffer), 44);
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { b64: btoa(bin), sounds: log.length, seconds: end, timeline: log.map((e) => [Math.round(e.at - t0), e.name]) };
}, recT0, SR);
fs.writeFileSync(path.join(OUT, 'flow.wav'), Buffer.from(wavB64.b64, 'base64'));
fs.writeFileSync(path.join(OUT, 'sounds.json'), JSON.stringify(wavB64.timeline));
console.log('sounds in the mix:', wavB64.sounds, 'length', wavB64.seconds.toFixed(1), 's');
await browser.close();

// ── line the soundtrack up with the picture ───────────────────────────
// Find the two white flashes in the recording (mean brightness per frame).
const probe = execFileSync('ffprobe', ['-v', 'error', '-f', 'lavfi', '-i', `movie=${path.join(OUT, 'flow.webm').replace(/([:\\' ])/g, '\\$1')},signalstats`, '-show_entries', 'frame=pts_time:frame_tags=lavfi.signalstats.YAVG', '-of', 'csv=p=0'], { maxBuffer: 1 << 28 }).toString();
const bright = probe.trim().split('\n').map((l) => l.split(',').map(Number)).filter(([, y]) => y > 200).map(([t]) => t);
const videoFlash1 = bright.find((t) => t < 10);
const videoFlash2 = bright.filter((t) => t > 10)[0];
const pageFlash1 = (flash1 - recT0) / 1000;
const pageFlash2 = (flash2 - recT0) / 1000;
const offset = videoFlash1 - pageFlash1;                 // + = the picture runs behind the page clock
const drift = (videoFlash2 - videoFlash1) - (pageFlash2 - pageFlash1);
console.log(`flash 1: page ${pageFlash1.toFixed(2)} s, video ${videoFlash1?.toFixed(2)} s · flash 2: page ${pageFlash2.toFixed(2)} s, video ${videoFlash2?.toFixed(2)} s`);
console.log(`sound offset ${offset.toFixed(3)} s, drift over the take ${drift.toFixed(3)} s`);
fs.writeFileSync(path.join(OUT, 'sync.json'), JSON.stringify({ offset, drift, videoFlash1, videoFlash2, pageFlash1, pageFlash2 }));
// Stretch the picture's clock to the page's (drift), shift the sound by the
// offset, and cut from just after the first flash to just before the last.
const rate = (pageFlash2 - pageFlash1) / (videoFlash2 - videoFlash1);
const start = pageFlash1 + 0.35;
const dur = pageFlash2 - 0.1 - start;
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(OUT, 'flow.webm'), '-i', path.join(OUT, 'flow.wav'),
  '-filter_complex', `[0:v]setpts=(PTS-${videoFlash1}/TB)*${rate}+${pageFlash1}/TB,trim=start=${start}:duration=${dur},setpts=PTS-STARTPTS,scale=780:-2[v];[1:a]atrim=start=${start}:duration=${dur},asetpts=PTS-STARTPTS[a]`,
  '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '128k', path.join(OUT, 'flow.mp4')]);
console.log('wrote', path.join(OUT, 'flow.mp4'));
