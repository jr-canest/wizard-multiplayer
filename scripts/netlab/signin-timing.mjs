import puppeteer from 'puppeteer-core';
const URL = process.argv[2] || 'https://wizard-multiplayer.web.app/';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
for (const label of ['cold', 'warm']) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const reqs = [];
  const t0 = Date.now();
  page.on('requestfinished', (r) => { const u = r.url(); if (/firestore|identitytoolkit|securetoken|workers\.dev|session/.test(u)) reqs.push({ at: Date.now() - t0, u: u.replace(/\?.*/, '').slice(0, 90), m: r.method() }); });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  const loaded = Date.now() - t0;
  await page.waitForSelector('input[placeholder="Jorge"]');
  await page.type('input[placeholder="Jorge"]', 'netA');
  await page.type('input[placeholder="• • • •"]', '4242');
  const tClick = Date.now();
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Continue').click());
  await page.waitForFunction(() => !document.querySelector('input[placeholder="Jorge"]'), { timeout: 60000 });
  console.log(`${label}: page ready ${loaded} ms, Continue → signed in ${Date.now() - tClick} ms`);
  for (const r of reqs.filter((r) => r.at >= tClick - t0 - 50)) console.log(`   +${r.at - (tClick - t0)} ms ${r.m} ${r.u}`);
  await ctx.close();
}
await browser.close();
