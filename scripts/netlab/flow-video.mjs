// A walkthrough VIDEO WITH SOUND of a few quick rounds: three signed-in
// phones (netA, netB, netC) on the dev server; netA's screen is recorded
// through three rounds that show the round-results reveal + commentary, a
// reaction each way, a shame vote with its boo, and the game log.
// Headless Chrome records no audio, so the soundtrack is rebuilt: the app
// logs every sound it triggers (window.__wizardSoundLog, see play() in
// sounds.ts and emit() in revealSounds.ts), each one is rendered offline
// at its timestamp, and ffmpeg lays the mix under the picture.
//   node scripts/netlab/flow-video.mjs <outdir> [baseUrl]
// Needs wrangler dev --port 8788 --var SESSION_SECRET:x, vite on 5181 with
// VITE_GAME_SERVER=http://localhost:8788, and ffmpeg on the PATH.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const OUT = process.argv[2];
const BASE = process.argv[3] || 'http://localhost:5181';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-first-run', '--autoplay-policy=no-user-gesture-required'] });
async function waitFor(fn, ms = 30000, every = 120) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(every); } throw new Error('timeout'); }
async function clickText(page, re) { await waitFor(() => page.evaluate((src) => { const b = [...document.querySelectorAll('button')].find((x) => new RegExp(src).test(x.textContent.trim()) && !x.disabled); if (b) { b.click(); return true; } return false; }, re.source)); }
async function phone(name, record = false) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  if (record) await page.evaluateOnNewDocument(() => { window.__wizardSoundLog = []; });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[placeholder="Jorge"]');
  await page.type('input[placeholder="Jorge"]', name);
  await page.type('input[placeholder="• • • •"]', '4242');
  await clickText(page, /^Continue$/);
  await waitFor(() => page.evaluate(() => !document.querySelector('input[placeholder="Jorge"]')));
  page.on('pageerror', (e) => console.log('PAGE ERROR', name, e.message));
  return page;
}
const A = await phone('netA', true);
await clickText(A, /^Create room$/);
await waitFor(() => A.evaluate(() => /\/room\//.test(location.pathname) && !!window.__wizardRoom));
const code = await A.evaluate(() => location.pathname.split('/').pop());
const B = await phone('netB'); await B.goto(`${BASE}/room/${code}`, { waitUntil: 'networkidle2' });
await waitFor(() => A.evaluate(() => window.__wizardRoom.playerOrder.includes('netB')));
const C = await phone('netC'); await C.goto(`${BASE}/room/${code}`, { waitUntil: 'networkidle2' });
await waitFor(() => A.evaluate(() => window.__wizardRoom.playerOrder.includes('netC')));
const phones = { netA: A, netB: B, netC: C };
const room = () => A.evaluate(() => { const r = window.__wizardRoom; return r && { status: r.status, round: r.currentRound, trick: r.currentTrick, inTrick: r.trickInProgress.length, turn: r.playerOrder[r.currentPlayerIndex] }; });
const bidPick = { netA: 'low', netB: 'high', netC: 'mid' };
async function step(r) {
  if (r.status === 'dealing') for (const p of [A, B, C]) await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /Hearts/.test(x.textContent)); b && b.click(); });
  if (r.status === 'bidding') await phones[r.turn]?.evaluate((pick) => { const bs = [...document.querySelectorAll('button.chip')].filter((x) => !x.disabled && /^\d+$/.test(x.textContent.trim())).sort((a, b) => +a.textContent - +b.textContent); const b = pick === 'low' ? bs[0] : pick === 'high' ? bs[Math.min(bs.length - 1, 1)] : bs[Math.floor(bs.length / 2)]; b && b.click(); }, bidPick[r.turn]);
  if (r.status === 'playing') { const p = phones[r.turn]; const el = await p?.$('.animate-legal-glow'); const bb = el && await el.boundingBox(); if (bb) await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); }
}
/** Play on until `until(room)`; a human-ish beat between moves. */
async function playUntil(until, beat = 850) { await waitFor(async () => { const r = await room(); if (until(r)) return true; await step(r); await sleep(beat); return false; }, 180000, 10); }
const nextRound = async () => { for (const p of [A, B, C]) await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /^Next round/.test(x.textContent.trim()) && !x.disabled); b && b.click(); }); };
const results = async (hold) => { await waitFor(() => A.evaluate(() => !!document.querySelector('.standing-row')), 15000, 40); await sleep(hold); };
const tapTile = async (page, who) => { const bb = await (await page.$(`[aria-label="React to ${who}"]`)).boundingBox(); await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); };
const tapSel = async (page, sel) => { const el = await page.waitForSelector(sel); const bb = await el.boundingBox(); await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); };
const cheer = (page, to, emoji) => page.evaluate(async (t, e) => { const { connectionFor } = await import('/src/lib/socket.ts'); connectionFor(window.__wizardRoom.code).cheer(t, e); }, to, emoji);

// ── record ────────────────────────────────────────────────────────────
await A.bringToFront();
const recorder = await A.screencast({ path: path.join(OUT, 'flow.webm') });
const recT0 = await A.evaluate(() => performance.now());
await sleep(1200);
await clickText(A, /^Start game$/);

// Round 1: one card each, then the first results (no places to swap yet).
await playUntil((r) => r.round === 1 && r.status === 'scoring');
await results(5200);
await nextRound();

// Round 2: reactions both ways, then a shame vote and its boo.
await playUntil((r) => r.round === 2 && r.status === 'playing', 800);
await sleep(700);
await cheer(B, 'netA', '👏');            // lands on netA, by the hand
await sleep(2200);
await tapTile(A, 'netC');                // netA taps netC's tile
await sleep(1000);
await tapSel(A, '[role="menu"] button:nth-of-type(2)'); // 😱
await sleep(2400);
await playUntil((r) => r.round === 2 && (r.trick === 2 || r.status === 'scoring') && r.inTrick === 0, 850);
if ((await room()).status === 'playing') {
  await sleep(1900);                     // let the won-trick banner clear
  await tapTile(A, 'netB');
  await sleep(1000);
  await tapSel(A, '[role="menu"] button[aria-label^="Shame vote"]');
  await sleep(2000);                     // the vote, as the one who called it
  await clickText(C, /^Shame$/);
  await sleep(3400);                     // BOO
}
await playUntil((r) => r.round === 2 && r.status === 'scoring');
await results(5600);
await nextRound();

// Round 3: a look at the game log mid-round, then the last results.
await playUntil((r) => r.round === 3 && r.status === 'playing' && r.trick === 2 && r.inTrick === 0, 800);
await sleep(1900);
await tapSel(A, 'button[aria-label="Scores"]');
await sleep(1300);
await clickText(A, /^Game log$/);
await sleep(4200);
await tapSel(A, 'button[aria-label="Close"]');
await sleep(600);
await playUntil((r) => r.round === 3 && r.status === 'scoring');
await results(6000);
await recorder.stop();

// ── soundtrack ────────────────────────────────────────────────────────
const SR = 32000;
const wavB64 = await A.evaluate(async (t0, SR) => {
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
  return { b64: btoa(bin), sounds: log.length, seconds: end };
}, recT0, SR);
fs.writeFileSync(path.join(OUT, 'flow.wav'), Buffer.from(wavB64.b64, 'base64'));
console.log('sounds in the mix:', wavB64.sounds, 'length', wavB64.seconds.toFixed(1), 's');
await browser.close();
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(OUT, 'flow.webm'), '-i', path.join(OUT, 'flow.wav'), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-vf', 'scale=780:-2', '-c:a', 'aac', '-b:a', '128k', '-shortest', path.join(OUT, 'flow.mp4')]);
console.log('wrote', path.join(OUT, 'flow.mp4'));
