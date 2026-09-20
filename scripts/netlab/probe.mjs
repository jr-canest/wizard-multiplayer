// Does Chrome's network emulation actually limit throughput here, and do
// our byte counters agree with reality? Fetch a known-size asset under the
// slow3g profile and time it.
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const url = process.argv[2];
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
const cdp = await page.createCDPSession();
await cdp.send('Network.enable');
let counted = 0, finished = 0;
cdp.on('Network.dataReceived', (e) => { counted += e.encodedDataLength || 0; });
cdp.on('Network.loadingFinished', (e) => { finished += e.encodedDataLength || 0; });
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 400 * 1000 / 8, uploadThroughput: 400 * 1000 / 8 });
await page.goto(new URL(url).origin + '/', { waitUntil: 'domcontentloaded' }); counted = 0; finished = 0;
const t0 = Date.now();
const size = await page.evaluate(async (u) => { const r = await fetch(u, { cache: 'no-store' }); const b = await r.arrayBuffer(); return b.byteLength; }, url);
const ms = Date.now() - t0;
console.log(JSON.stringify({ url, bodyBytes: size, ms, kBps: Math.round(size / ms), countedDataReceived: counted, countedLoadingFinished: finished }));
await browser.close();
