// Aggregate netlab results into one table per metric.
//   node scripts/netlab/report.mjs <dir-with-results-json> [--md out.md]
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
const mdOut = process.argv.includes('--md') ? process.argv[process.argv.indexOf('--md') + 1] : null;
const files = fs.readdirSync(dir).filter((f) => /^(current|slim|prototype)-(slow3g|awful|flaky)\.json$/.test(f) || f === 'slim-finish.json');
const runs = files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
const VARIANTS = ['current', 'slim', 'prototype'];
const PROFILES = ['slow3g', 'awful', 'flaky'];
const q = (arr, p) => { const a = arr.filter((x) => x !== null && x !== undefined).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : null; };
const fmt = (v, unit = '') => (v === null || v === undefined ? '–' : `${Math.round(v).toLocaleString('en-CA')}${unit}`);
const kb = (v) => (v === null || v === undefined ? '–' : v < 1024 ? `${Math.round(v)} B` : `${(v / 1024).toFixed(v < 10240 ? 1 : 0)} KB`);

function get(variant, profile) { return runs.find((r) => r.label === variant && r.profile === profile); }
const lines = [];
const out = (s = '') => { lines.push(s); console.log(s); };

out(`# Wizard multiplayer on bad networks: test results`);
out(`Three real Chrome sessions per run, 6 rounds of a 3-player game, every connection shaped at the TCP level (bandwidth cap + one-way delay); flaky = slow3g with one player cut off for 8 s every 40 s.`);
out();
out(`| profile | link |`);
out(`|---|---|`);
out(`| slow3g | 50 KB/s each way, 400 ms round trip |`);
out(`| awful | 12 KB/s down, 6 KB/s up, 800 ms round trip |`);
out(`| flaky | slow3g, plus one phone offline 8 s of every 40 s |`);
out();
for (const [title, pick, f] of [
  ['Time from a tap to the other players seeing it, median', (r) => q(r.samples.map((s) => s.ms), 0.5), (v) => fmt(v, ' ms')],
  ['Same, 90th percentile', (r) => q(r.samples.map((s) => s.ms), 0.9), (v) => fmt(v, ' ms')],
  ['Same, worst', (r) => q(r.samples.map((s) => s.ms), 1), (v) => fmt(v, ' ms')],
  ['Bytes a player downloads per play, median', (r) => q(r.samples.map((s) => s.bytes), 0.5), kb],
  ['Bytes per play in round 6 (the biggest round played), median', (r) => q(r.samples.filter((s) => s.round === 6).map((s) => s.bytes), 0.5), kb],
  ['Wire bytes per play (shaper count, TLS included), median', (r) => q(r.samples.map((s) => s.wire), 0.5), kb],
  ['Wire bytes per play in round 6, median', (r) => q(r.samples.filter((s) => s.round === 6).map((s) => s.wire), 0.5), kb],
  ['Total downloaded per player over the 6 rounds', (r) => { const t = r.totalBytes.map((b) => b.firestore + b.ws); return t.reduce((a, b) => a + b, 0) / t.length; }, kb],
  ['Total wire bytes per player over the run (shaper)', (r) => { const t = (r.wireTotals || []).filter((x) => x !== null); return t.length ? t.reduce((a, b) => a + b, 0) / t.length : null; }, kb],
  ['Plays that never arrived within 60 s', (r) => r.samples.filter((s) => s.ms === null).length, (v) => fmt(v)],
]) {
  out(`## ${title}`);
  out(`| | ${PROFILES.join(' | ')} |`);
  out(`|---|${PROFILES.map(() => '---').join('|')}|`);
  for (const v of VARIANTS) {
    const row = PROFILES.map((p) => { const r = get(v, p); return r ? f(pick(r)) : '–'; });
    if (row.some((c) => c !== '–')) out(`| ${v} | ${row.join(' | ')} |`);
  }
  out();
}
out(`## Recovery after an 8 s dropout (flaky profile): time until the cut-off phone is caught up`);
out(`| | recoveries (ms) |`);
out(`|---|---|`);
for (const v of VARIANTS) { const r = get(v, 'flaky'); if (r) out(`| ${v} | ${r.recoveries.map((x) => (x.ms === null ? (x.note ? 'no probe (round-end screen)' : 'timed out') : x.ms)).join(', ') || '–'} |`); }
out();
out(`## Per-round growth: median bytes per play by round`);
out(`| variant / profile | ${[1,2,3,4,5,6].map((r) => 'r' + r).join(' | ')} |`);
out(`|---|---|---|---|---|---|---|`);
for (const v of VARIANTS) for (const p of PROFILES) { const r = get(v, p); if (!r) continue; out(`| ${v} / ${p} | ${[1,2,3,4,5,6].map((rd) => kb(q(r.samples.filter((s) => s.round === rd).map((s) => s.bytes), 0.5))).join(' | ')} |`); }
out();
for (const r of runs) if (r.finalCheck) out(`- ${r.label}/${r.profile}: final round-by-round table rows ${r.finalCheck.rows} of ${r.finalCheck.totalRounds} rounds`);
if (mdOut) fs.writeFileSync(mdOut, lines.join('\n') + '\n');
