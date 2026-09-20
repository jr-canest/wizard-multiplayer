// Bad-network test rig. Three real Chrome contexts (separate identities)
// play rounds of a real game against the live dev server while CDP throttles
// each one's network. Records, per play: time from the actor's tap to each
// other player's snapshot showing it, and bytes each player downloaded.
//
//   node scripts/netlab/run.mjs --profile slow3g --rounds 3 [--url http://localhost:5181] [--out results.json]
//   profiles: good | slow3g | awful | flaky
//
// Requires the dev server (window.__wizardRoom is exposed in DEV only).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] ?? true] : [])).filter((x) => x.length),
);
const PROFILE = args.profile ?? 'good';
const ROUNDS = Number(args.rounds ?? 3);
const BASE_URL = args.url ?? 'http://localhost:5181';
const OUT = args.out ?? `scripts/netlab/results-${PROFILE}-${Date.now()}.json`;
const LABEL = args.label ?? 'current';
const MODE = args.mode ?? 'app'; // app = the real Firestore app, do = netlab-do prototype
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const NAMES = ['netA', 'netB', 'netC'];
const PIN = '4242';

// down/up in KB/s, delay = one-way ms (RTT is double). Shaped at the TCP
// level by shaper.mjs, one instance per player, so it applies to Firestore's
// stream and to WebSockets alike (Chrome's own emulation does not).
const PROFILES = {
  good: null,
  slow3g: { down: 50, up: 50, delay: 200 },
  awful: { down: 12, up: 6, delay: 400 },
  // slow3g plus one player (netB) losing the connection for 8 s every 40 s.
  flaky: { down: 50, up: 50, delay: 200, drops: { who: 1, everyMs: 40_000, forMs: 8_000 } },
};
const profile = PROFILES[PROFILE];
if (profile === undefined) throw new Error(`unknown profile ${PROFILE}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();

const shapers = [];
function startShaper(i) {
  if (!profile) return null;
  // Port base unique per run (from the PID) so back-to-back runs never
  // collide with a previous run's shapers that are still shutting down.
  const base = Number(args.portbase ?? 9100 + (process.pid % 80) * 40) + i * 10;
  const common = ['--down', String(profile.down), '--up', String(profile.up), '--delay', String(profile.delay), '--ctl', String(base + 1)];
  // A local (http) prototype is reached through a TCP forwarder so its
  // page and WebSocket both ride the shaped link; anything https (the real
  // app, or the prototype on the real edge) goes through the CONNECT proxy.
  const forward = MODE === 'do' && BASE_URL.startsWith('http:');
  const argv = forward
    ? ['--mode', 'forward', '--listen', String(base), '--target', new URL(BASE_URL).host, ...common]
    : ['--mode', 'proxy', '--listen', String(base), ...common];
  const child = spawn('node', [path.join(HERE, 'shaper.mjs'), ...argv], { stdio: 'ignore' });
  shapers.push(child);
  return { port: base, ctl: base + 1, forward };
}
// A shaper that failed to bind (port still held by the previous run) must
// fail the run loudly rather than let the browser talk to a dead port.
async function waitForShaper(sh) {
  for (let i = 0; i < 25; i++) {
    const ok = await fetch(`http://127.0.0.1:${sh.ctl}/`).then((r) => r.ok).catch(() => false);
    if (ok) return;
    await sleep(200);
  }
  throw new Error(`shaper on port ${sh.port} did not come up`);
}
async function setOffline(sh, on) {
  await fetch(`http://127.0.0.1:${sh.ctl}/offline?on=${on ? 1 : 0}`).catch(() => {});
}
/** Bytes the shaper has carried toward this player (wire truth). */
async function wireDown(sh) {
  if (!sh) return null;
  return fetch(`http://127.0.0.1:${sh.ctl}/`).then((r) => r.json()).then((j) => j.wireDown ?? null).catch(() => null);
}

async function main() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
  const players = [];
  for (let i = 0; i < NAMES.length; i++) {
    const shaper = startShaper(i);
    // In app mode every remote connection (Firestore, Auth) goes through the
    // player's own shaped CONNECT proxy; localhost (the static preview) is
    // exempt because page load is not what is under test.
    if (shaper) await waitForShaper(shaper);
    const ctx = await browser.createBrowserContext(
      shaper && !shaper.forward ? { proxyServer: `http://127.0.0.1:${shaper.port}`, proxyBypassList: ['localhost', '127.0.0.1'] } : undefined,
    );
    const page = await ctx.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');
    const bytes = { firestore: 0, ws: 0, other: 0 };
    const urls = new Map();
    cdp.on('Network.requestWillBeSent', (e) => urls.set(e.requestId, e.request.url));
    cdp.on('Network.dataReceived', (e) => {
      const u = urls.get(e.requestId) ?? '';
      const n = e.encodedDataLength || e.dataLength || 0;
      if (/firestore\.googleapis\.com|firestore\.clients6/.test(u)) bytes.firestore += n;
      else bytes.other += n;
    });
    cdp.on('Network.webSocketFrameReceived', (e) => { bytes.ws += (e.response?.payloadData?.length ?? 0); });
    page.setDefaultNavigationTimeout(180_000);
    page.on('pageerror', (err) => console.error(`[${NAMES[i]}] pageerror`, err.message));
    page.on('error', (err) => console.error(`[${NAMES[i]}] PAGE CRASHED`, err.message));
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log(`[${NAMES[i]}] navigated ${f.url()}`); });
    page.on('framedetached', (f) => console.log(`[${NAMES[i]}] frame detached ${f.url()} main=${f === page.mainFrame()}`));
    page.on('close', () => console.log(`[${NAMES[i]}] PAGE CLOSED`));
    page.on('response', (r) => { const st = r.status(); if (st >= 400 && !/favicon/.test(r.url())) console.log(`[${NAMES[i]}] http ${st} ${r.url().slice(0, 90)}`); });
    if (MODE === 'do' && args.trace) page.on('console', (m) => console.log(`[${NAMES[i]}] ${m.text()}`));
    // In prototype mode the player's page itself is served through its own
    // shaped forwarder, so the WebSocket rides the shaped link too.
    const url = shaper?.forward ? `http://127.0.0.1:${shaper.port}` : BASE_URL;
    players.push({ name: NAMES[i], page, cdp, bytes, ctx, shaper, url });
  }

  // Sign in + create/join.
  const host = players[0];
  let code;
  if (MODE === 'do') {
    code = 'T' + Math.random().toString(36).slice(2, 5).toUpperCase();
    await sleep(500); // shapers up
    for (const p of players) await p.page.goto(`${p.url}/?room=${code}&name=${p.name}`, { waitUntil: 'domcontentloaded' });
    console.log(`room ${code} (do)`);
  } else {
    await host.page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
    await identify(host.page, host.name);
    await clickText(host.page, 'button', 'Create room');
    await host.page.waitForFunction(() => /\/room\/[A-Z0-9]{4}/.test(location.pathname), { timeout: 120_000 });
    code = host.page.url().match(/\/room\/([A-Z0-9]{4})/)[1];
    console.log(`room ${code}`);
    for (const p of players.slice(1)) {
      await p.page.goto(`${BASE_URL}/room/${code}`, { waitUntil: 'domcontentloaded' });
      await identify(p.page, p.name);
    }
  }
  // Everyone in the lobby. A first connection occasionally never lands (seen
  // once on the prototype: the page loaded, the socket never joined), so a
  // player still missing after 25 s gets their page reloaded, up to 3 times.
  for (let attempt = 0; attempt < 4; attempt++) {
    const joined = await host.page.waitForFunction((n) => window.__wizardRoom?.playerOrder?.length === n, { timeout: 25_000 }, players.length).then(() => true).catch(() => false);
    if (joined) break;
    const present = await host.page.evaluate(() => window.__wizardRoom?.playerOrder ?? []);
    const missing = players.filter((p) => !present.includes(p.name));
    if (attempt === 3) throw new Error(`players never joined: ${missing.map((p) => p.name).join(', ')}`);
    console.log(`  (missing ${missing.map((p) => p.name).join(', ')} after ${attempt + 1} tries, reloading)`);
    for (const p of missing) await p.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  }
  for (const p of players) await p.page.waitForFunction((n) => window.__wizardRoom?.playerOrder?.length === n, { timeout: 180_000 }, players.length);
  // Optional short game: the lobby's Rounds select (app mode only).
  if (args.totalRounds && MODE !== 'do') {
    // The select writes chosenTotalRounds through a transaction that can
    // lose a race with the joins; keep re-selecting until the room shows it.
    const n = Number(args.totalRounds);
    for (let i = 0; i < 10; i++) {
      await host.page.evaluate((n) => {
        const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === String(n)));
        if (!sel) return;
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(sel, String(n));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }, n);
      const ok = await host.page.waitForFunction((n) => window.__wizardRoom?.chosenTotalRounds === n, { timeout: 4_000, polling: 100 }, n).then(() => true).catch(() => false);
      if (ok) break;
      if (i === 9) throw new Error('could not set total rounds');
    }
    await sleep(500);
  }
  await clickText(host.page, 'button', 'Start game');

  const samples = []; // { round, trick, actor, observer, ms }
  const recoveries = []; // flaky: { ms }
  const bytesBefore = players.map((p) => ({ ...p.bytes }));
  const roundBytes = [];
  let plays = 0;
  let stop = false;

  // Flaky profile: drop one player's link periodically and measure recovery.
  let dropper = null;
  if (profile?.drops) {
    const victim = players[profile.drops.who];
    dropper = (async () => {
      while (!stop) {
        await sleep(profile.drops.everyMs);
        if (stop) break;
        await setOffline(victim.shaper, true);
        await sleep(profile.drops.forMs);
        const backAt = now();
        await setOffline(victim.shaper, false);
        // Recovery = how long after the link returns the cut-off phone can
        // act and be seen again: the victim keeps sending a tiny message
        // (a reaction in the app, a poke on the prototype) until the host
        // receives one sent after the link came back.
        const at = Date.now();
        const poked = await pokeUntilSeen(victim, host, at, 120_000);
        if (poked === null) { recoveries.push({ ms: null, note: 'no probe possible' }); console.log('  recovery: no probe possible (not in a phase with reactions)'); }
        else if (poked === false) { recoveries.push({ ms: null }); console.log('  recovery TIMEOUT'); }
        else { recoveries.push({ ms: poked }); console.log(`  recovery ${poked} ms`); }
      }
    })();
  }

  const deadline = now() + 25 * 60_000;
  let consecutiveErrors = 0;
  while (!stop && now() < deadline) {
   try {
    const state = await host.page.evaluate(() => {
      const r = window.__wizardRoom;
      return r && { status: r.status, round: r.currentRound, trick: r.currentTrick, turn: r.playerOrder[r.currentPlayerIndex], dealer: r.playerOrder[r.dealerIndex], awaitingTrump: r.awaitingTrumpChoice, bids: Object.keys(r.bids).length, trickLen: r.trickInProgress.length, logLen: r.log.length, votes: (r.nextRoundVotes || []).length };
    });
    if (!state) { await sleep(200); continue; }
    if (state.round > ROUNDS || state.status === 'finished') break;

    if (state.status === 'dealing' && state.awaitingTrump) {
      const dealer = players.find((p) => p.name === state.dealer);
      // The app's suit buttons carry a glyph before the word.
      await clickText(dealer.page, 'button', /Hearts/, 10_000).catch(() => {});
      await sleep(300);
      continue;
    }
    if (state.status === 'bidding') {
      const who = players.find((p) => p.name === state.turn);
      const clicked = await clickBid(who.page);
      if (!clicked) await sleep(150);
      continue;
    }
    if (state.status === 'playing') {
      const who = players.find((p) => p.name === state.turn);
      // Actor's own view must agree it's their turn (throttled clients lag)
      // and the hand must be interactive (it is pointer-events-none while
      // the deal animation runs, so a tap then is a miss).
      const ready = await who.page.evaluate((n) => {
        const r = window.__wizardRoom;
        const card = document.querySelector('.animate-legal-glow');
        if (!card) return false;
        const hand = card.closest('[data-player]');
        if (hand && getComputedStyle(hand).pointerEvents === 'none') return false;
        return r.status === 'playing' && r.playerOrder[r.currentPlayerIndex] === n;
      }, who.name);
      if (!ready) { await sleep(100); continue; }
      const before = { logLen: state.logLen };
      const bytesAtTap = players.map((p) => p.bytes.firestore + p.bytes.ws);
      const wireAtTap = await Promise.all(players.map((p) => wireDown(p.shaper)));
      const t0 = now();
      const ok = await tapLegalCard(who.page);
      if (!ok) { await sleep(150); continue; }
      // Did the tap register? The actor's own log grows (Firestore echoes
      // the local write at once; the prototype echoes the event). If not
      // within 3 s it was a missed click: do not count it, do not wait.
      const registered = await who.page.waitForFunction((n) => window.__wizardRoom.log.length > n, { timeout: 3_000, polling: 20 }, before.logLen).then(() => true).catch(() => false);
      if (!registered) { console.log('  (tap missed, retrying)'); await sleep(200); continue; }
      plays++;
      // Each observer: time until their snapshot's log grows past `before`,
      // and the bytes they downloaded to get there.
      await Promise.all(players.map(async (obs, oi) => {
        if (obs === who) return;
        try {
          await obs.page.waitForFunction((n) => window.__wizardRoom.log.length > n, { timeout: 60_000, polling: 20 }, before.logLen);
          const ms = Math.round(now() - t0);
          const w = await wireDown(obs.shaper);
          samples.push({ round: state.round, trick: state.trick, actor: who.name, observer: obs.name, ms, bytes: obs.bytes.firestore + obs.bytes.ws - bytesAtTap[oi], wire: w !== null && wireAtTap[oi] !== null ? w - wireAtTap[oi] : null });
        } catch { samples.push({ round: state.round, trick: state.trick, actor: who.name, observer: obs.name, ms: null, bytes: null }); }
      }));
      // Let the host's own view move on before the next decision.
      await host.page.waitForFunction((n) => window.__wizardRoom.log.length > n, { timeout: 60_000, polling: 20 }, before.logLen).catch(() => {});
      continue;
    }
    if (state.status === 'scoring') {
      // Everyone taps Next round (unanimous). A click can miss when the
      // page re-renders under it (another vote landing), so keep tapping
      // for whoever has not been counted until the round moves on.
      if (!roundBytes.some((rb) => rb.round === state.round)) {
        roundBytes.push({ round: state.round, plays, perPlayer: players.map((p, i) => ({ name: p.name, firestore: p.bytes.firestore - bytesBefore[i].firestore, ws: p.bytes.ws - bytesBefore[i].ws })) });
      }
      const voted = await host.page.evaluate(() => window.__wizardRoom.nextRoundVotes || []);
      for (const p of players) {
        if (voted.includes(p.name)) continue;
        await clickText(p.page, 'button', /^(Next round|Finish game)/, 5_000).catch(() => {});
      }
      await host.page.waitForFunction((r, n) => window.__wizardRoom.currentRound > r || window.__wizardRoom.status === 'finished' || (window.__wizardRoom.nextRoundVotes || []).length >= n, { timeout: 15_000 }, state.round, players.length).catch(() => {});
      await sleep(300);
      continue;
    }
    await sleep(150);
    consecutiveErrors = 0;
   } catch (err) {
    consecutiveErrors++;
    console.error(`  loop error (${consecutiveErrors}): ${err.message.split('\n')[0]}`);
    if (consecutiveErrors >= 20) throw err;
    await sleep(1000);
   }
  }
  stop = true;
  if (dropper) await Promise.race([dropper, sleep(1000)]);
  let finalCheck = null;
  const finished = await host.page.evaluate(() => window.__wizardRoom?.status === 'finished').catch(() => false);
  if (finished && MODE !== 'do') {
    // The final scoreboard stitches archived rounds back together; every
    // played round must show up as a row of the round-by-round table.
    await sleep(4000);
    finalCheck = await host.page.evaluate(() => {
      const label = [...document.querySelectorAll('p')].find((p) => /Round-by-round/i.test(p.textContent || ''));
      const table = label?.parentElement?.querySelector('table');
      return { rows: table ? table.querySelectorAll('tbody tr').length : 0, totalRounds: window.__wizardRoom.totalRounds, logLen: window.__wizardRoom.log.length };
    }).catch(() => null);
    console.log('final round-by-round rows:', JSON.stringify(finalCheck));
  }

  const wireTotals = await Promise.all(players.map((p) => wireDown(p.shaper)));
  const result = { label: LABEL, profile: PROFILE, profileSpec: profile, room: code, rounds: ROUNDS, plays, samples, recoveries, roundBytes, finalCheck, wireTotals, totalBytes: players.map((p, i) => ({ name: p.name, firestore: p.bytes.firestore - bytesBefore[i].firestore, ws: p.bytes.ws - bytesBefore[i].ws })), at: new Date().toISOString() };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  summarize(result);
  await browser.close();
  for (const c of shapers) c.kill();
}
process.on('exit', () => { for (const c of shapers) c.kill(); });

function summarize(r) {
  const ms = r.samples.map((s) => s.ms).filter((x) => x !== null).sort((a, b) => a - b);
  const q = (p) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(p * ms.length))] : null);
  const timeouts = r.samples.filter((s) => s.ms === null).length;
  const by = r.samples.map((s) => s.bytes).filter((x) => x !== null).sort((a, b) => a - b);
  const qb = (p) => (by.length ? by[Math.min(by.length - 1, Math.floor(p * by.length))] : null);
  console.log(`\n${r.label} / ${r.profile}: ${r.plays} plays, ${r.samples.length} observations`);
  console.log(`  propagation ms  p50 ${q(0.5)}  p90 ${q(0.9)}  max ${ms[ms.length - 1] ?? null}  timeouts ${timeouts}`);
  console.log(`  bytes downloaded per observed play  p50 ${qb(0.5)}  p90 ${qb(0.9)}  max ${by[by.length - 1] ?? null}`);
  const wi = r.samples.map((s) => s.wire).filter((x) => x !== null && x !== undefined).sort((a, b) => a - b);
  if (wi.length) console.log(`  wire bytes per observed play (shaper)  p50 ${wi[Math.floor(wi.length / 2)]}  p90 ${wi[Math.floor(wi.length * 0.9)]}  max ${wi[wi.length - 1]}`);
  if (r.recoveries.length) console.log(`  recoveries ms: ${r.recoveries.map((x) => x.ms).join(', ')}`);
}

// Victim sends a probe every 1.5 s until the host sees one stamped after
// `at`; returns ms since `at`, false on timeout, null when no probe exists.
async function pokeUntilSeen(victim, host, at, timeout) {
  const t0 = now();
  let attempts = 0;
  while (now() - t0 < timeout) {
    let sent = false;
    if (MODE === 'do') {
      sent = await victim.page.evaluate((a) => { if (typeof window.__poke === 'function') { window.__poke(a); return true; } return false; }, at).catch(() => false);
    } else {
      sent = await victim.page.evaluate(async () => {
        const btn = document.querySelector('button[aria-label="Send a reaction"]');
        if (!btn) return false;
        btn.click();
        await new Promise((r) => setTimeout(r, 150));
        const phrase = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'ouch');
        if (!phrase) return false;
        phrase.click();
        return true;
      }).catch(() => false);
    }
    if (!sent && attempts === 0) {
      // Not in a phase with a probe (round-end screen has no reactions).
      const phase = await host.page.evaluate(() => window.__wizardRoom?.status).catch(() => null);
      if (MODE !== 'do' && phase !== 'playing' && phase !== 'bidding') return null;
    }
    attempts++;
    const seen = await host.page.waitForFunction((v, a, mode) => {
      const r = window.__wizardRoom; if (!r) return false;
      if (mode === 'do') return !!(r.lastPoke && r.lastPoke.by === v && r.lastPoke.at >= a);
      return !!(r.lastReaction && r.lastReaction.player === v && r.lastReaction.ts >= a);
    }, { timeout: 1_500, polling: 25 }, victim.name, at, MODE).then(() => true).catch(() => false);
    if (seen) return Math.round(Date.now() - at);
  }
  return false;
}

async function identify(page, name) {
  await page.waitForSelector('input[placeholder="Jorge"]', { timeout: 180_000 });
  await page.type('input[placeholder="Jorge"]', name);
  await page.type('input[placeholder="• • • •"]', PIN);
  await clickText(page, 'button', 'Continue');
  await page.waitForFunction(() => !document.querySelector('input[placeholder="Jorge"]'), { timeout: 120_000 });
}

// Waits for an ENABLED element with that text (buttons stay disabled until
// anonymous auth resolves, and under throttling that takes a while).
async function clickText(page, tag, text, timeout = 120_000) {
  const src = text instanceof RegExp ? text.source : text;
  const isRe = text instanceof RegExp;
  const handle = await page.waitForFunction((tag, text, isRe) => {
    const re = isRe ? new RegExp(text) : null;
    return [...document.querySelectorAll(tag)].find((el) => (re ? re.test(el.textContent.trim()) : el.textContent.trim() === text) && !el.disabled) ?? null;
  }, { timeout, polling: 100 }, tag, src, isRe);
  const el = handle.asElement();
  if (!el) throw new Error(`no ${tag} "${text}"`);
  await el.click();
}

async function clickBid(page) {
  return page.evaluate(() => {
    const r = window.__wizardRoom;
    if (!r || r.status !== 'bidding') return false;
    const btns = [...document.querySelectorAll('button.chip')].filter((b) => !b.disabled && /^\d+$/.test(b.textContent.trim()));
    if (!btns.length) return false;
    // Bid 0 when allowed (Canadian rule may lock it), else the lowest open value.
    btns.sort((a, b) => Number(a.textContent) - Number(b.textContent));
    btns[0].click();
    return true;
  });
}

// Real input, not a synthetic PointerEvent: the hand calls
// setPointerCapture(e.pointerId), which throws for a made-up pointer id.
// The card is lifted above its fanned neighbours first so the click at its
// centre lands on it and not on the card overlapping it.
async function tapLegalCard(page) {
  const centre = await page.evaluate(() => {
    const el = document.querySelector('.animate-legal-glow');
    if (!el) return null;
    el.style.zIndex = '5000';
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (!centre) return false;
  await page.mouse.click(centre.x, centre.y);
  return true;
}

main().catch((e) => { console.error(e); process.exit(1); });
