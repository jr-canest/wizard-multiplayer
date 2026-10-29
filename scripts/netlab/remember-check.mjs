// Live check of the remember cookie (2026-10-29): sign in, wipe the page's
// own storage the way Safari does after 7 days, reload, and see whether
// the app signs itself back in from the server-set cookie. Then "switch"
// (sign out) must clear the cookie too.
//   node scripts/netlab/remember-check.mjs [baseUrl]
import puppeteer from 'puppeteer-core';
const BASE = process.argv[2] || 'https://wizard-multiplayer.web.app';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
let fails = 0;
const ok = (c, m) => { console.log(c ? '  ok ' : '  FAIL', m); if (!c) fails++; };
const signedIn = () => page.evaluate(() => !document.querySelector('input[placeholder="Jorge"]') && !/Signing you in/.test(document.body.innerText));
const formShown = () => page.waitForSelector('input[placeholder="Jorge"]', { timeout: 20000 }).then(() => true, () => false);

await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
ok(await formShown(), 'fresh phone: sign-in form');
await page.type('input[placeholder="Jorge"]', 'netA');
await page.type('input[placeholder="• • • •"]', '4242');
const t = Date.now();
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Continue').click());
await page.waitForFunction(() => !document.querySelector('input[placeholder="Jorge"]'), { timeout: 30000 });
console.log(`  sign-in took ${Date.now() - t} ms`);
await new Promise((r) => setTimeout(r, 2500)); // cookie write is fire-and-forget
const cookies = await page.cookies();
ok(cookies.some((c) => c.name === '__session' && c.httpOnly), 'server set an HttpOnly __session cookie');

// Safari's 7-day wipe: script storage gone, server cookies kept.
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
const t2 = Date.now();
await page.reload({ waitUntil: 'networkidle2' });
await page.waitForFunction(() => !/Signing you in/.test(document.body.innerText), { timeout: 15000 }).catch(() => {});
ok(await signedIn(), `signed back in from the cookie after storage wipe (${Date.now() - t2} ms incl. page load)`);
ok(await page.evaluate(() => !!localStorage.getItem('wizard-multiplayer.session')), 'local copy restored');

// Switch player = sign out everywhere.
const sw = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => /switch|sign out/i.test(b.textContent)));
if (sw.asElement()) {
  await sw.asElement().click();
  await new Promise((r) => setTimeout(r, 2500));
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' });
  ok(await formShown(), 'after switch + wipe: form again (cookie cleared)');
} else console.log('  (no switch button on home, skipped)');
console.log(fails ? `${fails} FAILED` : 'ALL CHECKS PASSED');
await browser.close();
process.exit(fails ? 1 : 0);
